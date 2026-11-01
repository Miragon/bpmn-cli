import { type BatchContext, type BpmnDocument, BpmnError, ChangeSet, type Finding, type Platform } from '../model/index.js';
import { type DrawingOperation, type ModelOperation, type Operation, OperationAliases, type ParsedOperations } from '../operations/index.js';
import { BranchSplit } from './BranchSplit.js';
import { ElementCreation } from './ElementCreation.js';
import { ElementMove } from './ElementMove.js';
import { ElementOrder } from './ElementOrder.js';
import { ElementRemoval } from './ElementRemoval.js';
import { ElementTypeChange } from './ElementTypeChange.js';
import { ExtensionEditor } from './ExtensionEditor.js';
import { FlowConnector } from './FlowConnector.js';
import { IdRename } from './properties/IdRename.js';
import { PropertyEditor } from './PropertyEditor.js';
import { AliasTable } from './session/AliasTable.js';
import { EditSession } from './session/EditSession.js';

export interface OperationRunOptions {
  force?: boolean | undefined;
  platform?: Platform | undefined;
}

export interface OperationRun {
  changes: ChangeSet;
  model: ModelOperation[];
  drawing: DrawingOperation[];
  aliases: Record<string, string>;
}

export class ModelOperationRunner {
  private readonly edit: EditSession;
  private readonly table: AliasTable;
  private readonly context: BatchContext;

  constructor(
    private readonly document: BpmnDocument,
    private readonly options: OperationRunOptions = {},
  ) {
    this.edit = new EditSession(document, options.platform);
    this.table = new AliasTable(document);
    this.context = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => this.table.toRecord() };
  }

  private static named(index: number, run: () => void): void {
    try {
      run();
    } catch (error) {
      if (error instanceof BpmnError) {
        error.details.op = index;
      }
      throw error;
    }
  }

  run({ model, drawing }: ParsedOperations): OperationRun {
    const all = new ChangeSet();
    const resolved = [...model];
    this.edit.begin();
    this.inBatch(() => {
      model.forEach((operation, index) => {
        ModelOperationRunner.named(index, () => {
          resolved[index] = this.resolved(operation, index) as ModelOperation;
          this.record(this.step(resolved[index]), all, index);
        });
      });
    });
    const resolvedDrawing = this.resolveDrawing(drawing, model.length);
    all.bindings = [];
    all.replaced = [];
    all.warnings = all.warnings.filter((warning) => this.stillHolds(warning));
    new IdRename(this.edit).reportStalePrefixes(all);
    if (!this.options.force) {
      this.refuseDroppedContent();
    }
    return { changes: all, model: resolved, drawing: resolvedDrawing, aliases: this.table.toRecord() };
  }

  private resolved(operation: Operation, index: number): Operation {
    return new OperationAliases(operation).resolve((alias, key) => this.table.idOf(alias, index, operation, key));
  }

  private resolveDrawing(drawing: readonly DrawingOperation[], first: number): DrawingOperation[] {
    const resolved = [...drawing];
    this.inBatch(() => {
      drawing.forEach((operation, position) => {
        ModelOperationRunner.named(first + position, () => {
          resolved[position] = this.resolved(operation, first + position) as DrawingOperation;
          for (const id of new OperationAliases(resolved[position]).referencedIds()) {
            this.edit.require(id);
          }
        });
      });
    });
    return resolved;
  }

  private record(step: ChangeSet, all: ChangeSet, index: number): void {
    all.merge(step);
    for (const replacement of step.replaced) {
      this.table.rebind(replacement.from, replacement.to);
    }
    for (const binding of step.bindings) {
      this.table.define(binding.alias, binding.el, index);
    }
    this.context.created.push(...step.created.map((change) => change.id));
    for (const rename of step.renames) {
      for (const [old, now] of this.context.renamed) {
        if (now === rename.from) {
          this.context.renamed.set(old, rename.to);
        }
      }
      this.context.renamed.set(rename.from, rename.to);
      if (rename.regenerated) {
        if (!rename.was) {
          this.context.retyped?.add(rename.from);
        }
        this.context.created = this.context.created.map((id) => (id === rename.from ? rename.to : id));
      }
    }
  }

  private inBatch(run: () => void): void {
    this.edit.batch = this.context;
    try {
      run();
    } finally {
      this.edit.batch = undefined;
    }
  }

  private step(operation: ModelOperation): ChangeSet {
    const changes = this.dispatch(operation);
    this.edit.allocator.reportSuffixed(changes);
    changes.rename(this.edit.takeRenames());
    return changes;
  }

  private dispatch(operation: ModelOperation): ChangeSet {
    switch (operation.op) {
      case 'add':
        return new ElementCreation(this.edit).add(operation);
      case 'connect':
        return new FlowConnector(this.edit).connect(operation);
      case 'set':
        return new PropertyEditor(this.edit).set(operation);
      case 'remove':
        return new ElementRemoval(this.edit).remove(operation);
      case 'retype':
        return new ElementTypeChange(this.edit).retype(operation);
      case 'move':
        return new ElementMove(this.edit).move(operation);
      case 'order':
        return new ElementOrder(this.edit).reorder(operation);
      case 'ext':
        return new ExtensionEditor(this.edit).apply(operation);
      default:
        return new BranchSplit(this.edit).split(operation);
    }
  }

  private stillHolds(warning: Finding): boolean {
    const { document } = this;
    const element = warning.element ? document.tree.byId(warning.element) : undefined;
    switch (warning.code) {
      case 'W_LANES_WITHOUT_POOL': {
        const process = document.scopes.processOf(element?.parent);
        return !!process && !document.flows.participantOf(process);
      }
      case 'W_IMPLICIT_SPLIT':
        return !!element && !element.is('bpmn:Gateway') && document.flows.outgoing(element).length > 1;
      case 'W_IMPLICIT_JOIN':
        return !!element && document.flows.incoming(element).length > 1;
      default:
        return true;
    }
  }

  private refuseDroppedContent(): void {
    const drops = this.edit.droppedContent;
    const first = drops[0];
    if (!first) {
      return;
    }
    const removed = drops.flatMap((drop) => drop.removed);
    const shown = removed.slice(0, 8).join(', ') + (removed.length > 8 ? ` and ${removed.length - 8} more` : '');
    throw BpmnError.model('E_WOULD_DROP_CONTENT', `Retyping ${first.element} to ${first.kind} would delete its content (${shown}); nothing was written`, {
      element: first.element,
      related: removed,
      hint: `A ${first.kind} cannot hold it. Move what should stay out first (\`bpmn move <file> <ids> --in <scopeId>\`), or pass --force to retype anyway (the listed elements are deleted).`,
    });
  }
}
