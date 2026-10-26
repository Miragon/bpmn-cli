import type { Doc } from '../document/Doc.js';
import { EditContext, type BatchContext } from '../document/EditContext.js';
import { usageError } from '../document/utils/errors.js';
import { type Warning } from '../document/CliError.js';
import { is, type El } from '../document/utils/moddle.js';
import { ChangeSet } from '../document/ChangeSet.js';
import { AliasTable } from '../commands/AliasTable.js';
import { OpAliases } from '../commands/OpAliases.js';
import { isDiagramCommand } from '../commands/utils/op-names.js';
import type { EditCommand } from '../commands/types.js';
import { ElementCreationService } from '../editing/ElementCreationService.js';
import { ConnectionService } from '../editing/ConnectionService.js';
import { PropertyService } from '../editing/PropertyService.js';
import { ElementRemovalService } from '../editing/ElementRemovalService.js';
import { ElementTypeChangeService } from '../editing/ElementTypeChangeService.js';
import { ElementMoveService } from '../editing/ElementMoveService.js';
import { ElementOrderService } from '../editing/ElementOrderService.js';
import { ExtensionElementService } from '../editing/extensions/ExtensionElementService.js';
import { BranchSplitService } from '../editing/flows/BranchSplitService.js';
import { IdRenameService } from '../editing/IdRenameService.js';
import { StaleFlowReport } from '../editing/flows/StaleFlowReport.js';

/** The merged changes, the ops with aliases resolved (for layout and format) and alias -> id. */
export interface BatchRun {
  changes: ChangeSet;
  ops: EditCommand[];
  aliases: Record<string, string>;
}

/** The state of the batch that runs. */
interface RunningBatch {
  ops: EditCommand[];
  all: ChangeSet;
  table: AliasTable;
  resolved: EditCommand[];
  /** diagram commands whose aliases are checked but not yet resolved */
  pending: number[];
  context: BatchContext;
}

/**
 * Dispatches ops: every CLI command and `apply` run through here, inside one edit context
 * that is the document's while they run.
 */
export class ModelCommandService {
  private batch: RunningBatch | undefined;

  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext = new EditContext(doc),
  ) {}

  /** Runs one op on its own; stale flow ids and id prefixes are reported at its end. */
  runOp(op: EditCommand): ChangeSet {
    return this.within(() => {
      this.edit.begin();
      const cs = this.step(op);
      new StaleFlowReport(this.doc).report(cs, this.edit.flowsBefore);
      new IdRenameService(this.doc).reportStalePrefixes(cs);
      return cs;
    });
  }

  /**
   * Runs a batch in order. Aliases resolve to the current ids before each op; the diagram
   * commands get theirs when resolveDiagramCommands runs. Stale flow ids and id prefixes
   * are reported once, against the state before and after the whole batch.
   */
  runBatch(ops: EditCommand[]): BatchRun {
    this.beginBatch(ops);
    this.runCommands(0, ops.length);
    this.resolveDiagramCommands();
    return this.finishBatch();
  }

  /** Starts a batch that runCommands works off in steps, so the diagram can be drawn in between. */
  beginBatch(ops: EditCommand[]): void {
    const table = new AliasTable(this.doc);
    // what the batch did so far, so E_NOT_FOUND can explain a missing id
    const context: BatchContext = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => table.toRecord() };
    this.batch = { ops, all: new ChangeSet(), table, resolved: [...ops], pending: [], context };
    this.within(() => this.edit.begin());
  }

  /** Runs the model commands from `from` to before `to`; a diagram command only has its aliases checked (one defined later is an error). */
  runCommands(from: number, to: number): void {
    const batch = this.openBatch();
    this.inBatch(() => {
      for (let opIndex = from; opIndex < to; opIndex++) {
        const op = batch.ops[opIndex]!;
        this.atOp(opIndex, () => {
          if (isDiagramCommand(op)) {
            for (const { key, alias } of new OpAliases(op).references()) batch.table.idOf(alias, opIndex, op, key);
            batch.pending.push(opIndex);
            return;
          }
          const ready = new OpAliases(op).resolve(batch.table, opIndex);
          batch.resolved[opIndex] = ready;
          const cs = this.step(ready);
          batch.all.merge(cs);
          for (const replacement of cs.replaced) batch.table.rebind(replacement.from, replacement.to);
          for (const binding of cs.bindings) batch.table.define(binding.alias, binding.el, opIndex);
          const context = batch.context;
          context.created.push(...cs.created.map((change) => change.id));
          for (const rename of cs.renames) {
            for (const [old, now] of context.renamed) if (now === rename.from) context.renamed.set(old, rename.to);
            context.renamed.set(rename.from, rename.to);
            // created and retyped in the batch: E_NOT_FOUND lists it under its new id
            if (!rename.regenerated) continue;
            if (!rename.was) context.retyped!.add(rename.from);
            context.created = context.created.map((createdId) => (createdId === rename.from ? rename.to : createdId));
          }
        });
      }
    });
  }

  /** The diagram commands runCommands passed since the last call, with their aliases resolved to the current ids. */
  resolveDiagramCommands(): EditCommand[] {
    const batch = this.openBatch();
    const pending = batch.pending.splice(0);
    this.inBatch(() => {
      for (const pendingIndex of pending) {
        this.atOp(pendingIndex, () => {
          const ready = (batch.resolved[pendingIndex] = new OpAliases(batch.ops[pendingIndex]!).resolve(batch.table, pendingIndex));
          // the diagram commands run outside the batch: E_NOT_FOUND can explain a lost id only now
          for (const id of new OpAliases(ready).referencedIds()) if (!this.doc.get(id)) this.doc.require(id);
        });
      }
    });
    return batch.resolved;
  }

  /** The merged changes; model-state warnings describe the final state (a lane added before its pool). */
  finishBatch(): BatchRun {
    const batch = this.openBatch();
    this.batch = undefined;
    return this.within(() => {
      const all = batch.all;
      all.bindings = [];
      all.replaced = [];
      all.warnings = all.warnings.filter((warning) => this.stillHolds(warning));
      new StaleFlowReport(this.doc).report(all, this.edit.flowsBefore);
      new IdRenameService(this.doc).reportStalePrefixes(all);
      return { changes: all, ops: batch.resolved, aliases: batch.table.toRecord() };
    });
  }

  /** The changes of the batch so far, e.g. the ids created since the drawing was last updated. */
  get changesSoFar(): ChangeSet {
    return this.openBatch().all;
  }

  private openBatch(): RunningBatch {
    if (!this.batch) throw new Error('no batch is running: call beginBatch first');
    return this.batch;
  }

  private inBatch(run: () => void): void {
    this.within(() => {
      this.edit.batch = this.openBatch().context;
      try {
        run();
      } finally {
        this.edit.batch = undefined;
      }
    });
  }

  private within<TResult>(run: () => TResult): TResult {
    const outer = this.doc.edit;
    this.doc.edit = this.edit;
    try {
      return run();
    } finally {
      this.doc.edit = outer;
    }
  }

  /** Every entry names its final id; merge applies renames to earlier ops too. */
  private step(op: EditCommand): ChangeSet {
    const cs = this.dispatch(op);
    this.edit.allocator.reportSuffixed(cs);
    cs.rename(this.edit.takeRenames());
    return cs;
  }

  private dispatch(op: EditCommand): ChangeSet {
    const doc = this.doc;
    switch (op.op) {
      case 'add':
        return new ElementCreationService(doc).add(op);
      case 'connect':
        return new ConnectionService(doc).connect(op);
      case 'set':
        return new PropertyService(doc).set(op);
      case 'remove':
        return new ElementRemovalService(doc).remove(op);
      case 'retype':
        return new ElementTypeChangeService(doc).retype(op);
      case 'move':
        return new ElementMoveService(doc).move(op);
      case 'order':
        return new ElementOrderService(doc, op).apply();
      case 'ext':
        return new ExtensionElementService(doc).apply(op);
      case 'split':
        return new BranchSplitService(doc).split(op);
      case 'place':
      case 'align':
      case 'color':
      case 'label':
      case 'route':
      case 'space':
      case 'tidy':
      case 'compact':
        // diagram only: DiagramCommandService runs them once the drawing is up to date
        return new ChangeSet();
      default:
        throw usageError(`Unknown operation "${String((op as { op?: unknown }).op)}"`);
    }
  }

  /** A later op may have added the pool or put a gateway in between. */
  private stillHolds(warning: Warning): boolean {
    const doc = this.doc;
    const el = warning.element ? doc.get(warning.element) : undefined;
    switch (warning.code) {
      case 'W_LANES_WITHOUT_POOL': {
        let process = el?.$parent as El | undefined;
        while (process && !is(process, 'bpmn:Process')) process = process.$parent as El | undefined;
        return !!process && !doc.participantOf(process);
      }
      case 'W_IMPLICIT_SPLIT':
        return !!el && !is(el, 'bpmn:Gateway') && doc.outgoing(el).length > 1;
      case 'W_IMPLICIT_JOIN':
        return !!el && doc.incoming(el).length > 1;
      default:
        return true;
    }
  }

  /** An error thrown by op `i` names the op. */
  private atOp(opIndex: number, fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      if (err && typeof err === 'object' && 'details' in err) {
        (err as { details: Record<string, unknown> }).details['op'] = opIndex;
      }
      throw err;
    }
  }
}
