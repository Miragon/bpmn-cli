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
import type { BatchDrawing, DrawingSegment } from '../diagram/BatchDrawing.js';
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
 * handed to every editing service; without one given, a fresh one for the document.
 */
export class ModelCommandService {
  private batch: RunningBatch | undefined;

  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext = new EditContext(doc),
  ) {}

  /** Runs one op on its own; stale flow ids and id prefixes are reported at its end. */
  runOp(op: EditCommand): ChangeSet {
    this.edit.begin();
    const cs = this.step(op);
    new StaleFlowReport(this.doc, this.edit).report(cs, this.edit.flowsBefore);
    new IdRenameService(this.doc, this.edit).reportStalePrefixes(cs);
    return cs;
  }

  /**
   * Runs a batch in order. Aliases resolve to the current ids before each op; the diagram
   * commands get theirs once the model commands before them ran. Stale flow ids and id prefixes
   * are reported once, against the state before and after the whole batch.
   */
  runBatch(ops: EditCommand[]): BatchRun {
    this.beginBatch(ops);
    this.runCommands(0, ops.length);
    this.resolveDiagramCommands();
    return this.finishBatch();
  }

  /**
   * Runs a batch in order and draws in between: where a model command follows a diagram
   * command the drawing is brought up to date first, so every diagram command sees the
   * commands before it; `last` is then the segment the final layout still has to draw.
   */
  async runBatchDrawnBetween(ops: EditCommand[], drawing: BatchDrawing): Promise<{ batch: BatchRun; last?: DrawingSegment }> {
    const segments = ModelCommandService.segmentsOf(ops);
    let last: DrawingSegment | undefined;
    this.beginBatch(ops);
    for (const [position, segment] of segments.entries()) {
      const before = new Set(this.changesSoFar.created.map((created) => this.doc.get(created.id)));
      this.runCommands(segment.start, segment.end);
      const created = this.changesSoFar.created.map((change) => change.id).filter((id) => !before.has(this.doc.get(id)));
      if (position === segments.length - 1) {
        if (segments.length > 1) last = { ...segment, created };
        break;
      }
      await drawing.drawBetween(this.edit, this.resolveDiagramCommands(), this.changesSoFar, { ...segment, created });
    }
    this.resolveDiagramCommands();
    const batch = this.finishBatch();
    return { batch, ...(last ? { last } : {}) };
  }

  /**
   * The batch cut where a model command follows a diagram command: the diagram commands
   * of a segment see the drawing of every command before them.
   */
  private static segmentsOf(ops: readonly EditCommand[]): Array<Omit<DrawingSegment, 'created'>> {
    const segments: Array<Omit<DrawingSegment, 'created'>> = [];
    let start = 0;
    const segment = (end: number) => ({ start, end, model: ops.slice(start, end).some((op) => !isDiagramCommand(op)) });
    ops.forEach((op, index) => {
      if (index === 0 || isDiagramCommand(op) || !isDiagramCommand(ops[index - 1]!)) return;
      segments.push(segment(index));
      start = index;
    });
    segments.push(segment(ops.length));
    return segments;
  }

  /**
   * Starts a batch that runCommands works off in steps, so the diagram can be drawn in between.
   * Its context records what the batch did so far, so E_NOT_FOUND can explain a missing id.
   */
  private beginBatch(ops: EditCommand[]): void {
    const table = new AliasTable(this.doc);
    const context: BatchContext = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => table.toRecord() };
    this.batch = { ops, all: new ChangeSet(), table, resolved: [...ops], pending: [], context };
    this.edit.begin();
  }

  /**
   * Runs the model commands from `from` to before `to`; a diagram command only has its aliases checked (one defined later is an error).
   * An element created and then retyped in the batch is listed by E_NOT_FOUND under its new id.
   */
  private runCommands(from: number, to: number): void {
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
            if (!rename.regenerated) continue;
            if (!rename.was) context.retyped!.add(rename.from);
            context.created = context.created.map((createdId) => (createdId === rename.from ? rename.to : createdId));
          }
        });
      }
    });
  }

  /**
   * The diagram commands runCommands passed since the last call, with their aliases resolved to the current ids.
   * They run outside the batch, so a lost id they reference is reported (E_NOT_FOUND) only here.
   */
  private resolveDiagramCommands(): EditCommand[] {
    const batch = this.openBatch();
    const pending = batch.pending.splice(0);
    this.inBatch(() => {
      for (const pendingIndex of pending) {
        this.atOp(pendingIndex, () => {
          const ready = (batch.resolved[pendingIndex] = new OpAliases(batch.ops[pendingIndex]!).resolve(batch.table, pendingIndex));
          for (const id of new OpAliases(ready).referencedIds()) if (!this.doc.get(id)) this.edit.require(id);
        });
      }
    });
    return batch.resolved;
  }

  /** The merged changes; model-state warnings describe the final state (a lane added before its pool). */
  private finishBatch(): BatchRun {
    const batch = this.openBatch();
    this.batch = undefined;
    const all = batch.all;
    all.bindings = [];
    all.replaced = [];
    all.warnings = all.warnings.filter((warning) => this.stillHolds(warning));
    new StaleFlowReport(this.doc, this.edit).report(all, this.edit.flowsBefore);
    new IdRenameService(this.doc, this.edit).reportStalePrefixes(all);
    return { changes: all, ops: batch.resolved, aliases: batch.table.toRecord() };
  }

  /** The changes of the batch so far, e.g. the ids created since the drawing was last updated. */
  private get changesSoFar(): ChangeSet {
    return this.openBatch().all;
  }

  private openBatch(): RunningBatch {
    if (!this.batch) throw new Error('no batch is running: call beginBatch first');
    return this.batch;
  }

  private inBatch(run: () => void): void {
    this.edit.batch = this.openBatch().context;
    try {
      run();
    } finally {
      this.edit.batch = undefined;
    }
  }

  /** Every entry names its final id; merge applies renames to earlier ops too. */
  private step(op: EditCommand): ChangeSet {
    const cs = this.dispatch(op);
    this.edit.allocator.reportSuffixed(cs);
    cs.rename(this.edit.takeRenames());
    return cs;
  }

  /** Diagram-only commands (tidy, compact) change nothing here: DiagramCommandService runs them once the drawing is up to date. */
  private dispatch(op: EditCommand): ChangeSet {
    const doc = this.doc;
    switch (op.op) {
      case 'add':
        return new ElementCreationService(doc, this.edit).add(op);
      case 'connect':
        return new ConnectionService(doc, this.edit).connect(op);
      case 'set':
        return new PropertyService(doc, this.edit).set(op);
      case 'remove':
        return new ElementRemovalService(doc, this.edit).remove(op);
      case 'retype':
        return new ElementTypeChangeService(doc, this.edit).retype(op);
      case 'move':
        return new ElementMoveService(doc, this.edit).move(op);
      case 'order':
        return new ElementOrderService(doc, this.edit, op).apply();
      case 'ext':
        return new ExtensionElementService(doc, this.edit).apply(op);
      case 'split':
        return new BranchSplitService(doc, this.edit).split(op);
      case 'place':
      case 'align':
      case 'color':
      case 'label':
      case 'route':
      case 'space':
      case 'tidy':
      case 'compact':
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
