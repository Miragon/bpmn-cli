import type { Doc } from '../document/Doc.js';
import { EditSession, type BatchContext } from '../document/EditSession.js';
import { usageError } from '../document/utils/errors.js';
import type { Finding } from '../document/Finding.js';
import { enclosingProcess, is, type El } from '../document/utils/moddle.js';
import { ChangeSet } from '../document/ChangeSet.js';
import { AliasTable } from '../commands/AliasTable.js';
import { CommandAliases } from '../commands/CommandAliases.js';
import { isDiagramCommand } from '../commands/utils/command-names.js';
import type { EditCommand } from '../commands/types.js';
import type { BatchDrawing, DrawingSegment } from '../diagram/BatchDrawing.js';
import { ElementCreation } from '../editing/elements/ElementCreation.js';
import { Connections } from '../editing/connections/Connections.js';
import { Properties } from '../editing/properties/Properties.js';
import { ElementRemoval } from '../editing/elements/ElementRemoval.js';
import { ElementTypeChange } from '../editing/elements/ElementTypeChange.js';
import { ElementMove } from '../editing/elements/ElementMove.js';
import { ElementOrder } from '../editing/elements/ElementOrder.js';
import { ExtensionElements } from '../editing/extensions/ExtensionElements.js';
import { BranchSplit } from '../editing/connections/BranchSplit.js';
import { IdRename } from '../editing/ids/IdRename.js';
import { StaleFlowReport } from '../editing/connections/StaleFlowReport.js';

/** The merged changes, the ops with aliases resolved (for layout and format) and alias -> id. */
export interface BatchRun {
  changes: ChangeSet;
  commands: EditCommand[];
  aliases: Record<string, string>;
}

/** The state of the batch that runs. */
interface RunningBatch {
  commands: EditCommand[];
  all: ChangeSet;
  table: AliasTable;
  resolved: EditCommand[];
  /** diagram commands whose aliases are checked but not yet resolved */
  pending: number[];
  context: BatchContext;
}

/**
 * Dispatches ops: every CLI command and `apply` run through here, inside one edit session
 * handed to every editing class; without one given, a fresh one for the document.
 */
export class ModelCommands {
  private batch: RunningBatch | undefined;

  constructor(
    private readonly doc: Doc,
    private readonly edit: EditSession = new EditSession(doc),
  ) {}

  /** Runs one op on its own; stale flow ids and id prefixes are reported at its end. */
  runCommand(command: EditCommand): ChangeSet {
    this.edit.begin();
    const cs = this.step(command);
    new StaleFlowReport(this.edit).report(cs, this.edit.flowsBefore);
    new IdRename(this.edit).reportStalePrefixes(cs);
    return cs;
  }

  /**
   * Runs a batch in order. Aliases resolve to the current ids before each op; the diagram
   * commands get theirs once the model commands before them ran. Stale flow ids and id prefixes
   * are reported once, against the state before and after the whole batch.
   */
  runBatch(commands: EditCommand[]): BatchRun {
    this.beginBatch(commands);
    this.runCommands(0, commands.length);
    this.resolveDiagramCommands();
    return this.finishBatch();
  }

  /**
   * Runs a batch in order and draws in between: where a model command follows a diagram
   * command the drawing is brought up to date first, so every diagram command sees the
   * commands before it; `last` is then the segment the final layout still has to draw.
   */
  async runBatchDrawnBetween(commands: EditCommand[], drawing: BatchDrawing): Promise<{ batch: BatchRun; last?: DrawingSegment }> {
    const segments = ModelCommands.segmentsOf(commands);
    let last: DrawingSegment | undefined;
    this.beginBatch(commands);
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
  private static segmentsOf(commands: readonly EditCommand[]): Array<Omit<DrawingSegment, 'created'>> {
    const segments: Array<Omit<DrawingSegment, 'created'>> = [];
    let start = 0;
    const segment = (end: number) => ({ start, end, model: commands.slice(start, end).some((command) => !isDiagramCommand(command)) });
    commands.forEach((command, index) => {
      if (index === 0 || isDiagramCommand(command) || !isDiagramCommand(commands[index - 1]!)) return;
      segments.push(segment(index));
      start = index;
    });
    segments.push(segment(commands.length));
    return segments;
  }

  /**
   * Starts a batch that runCommands works off in steps, so the diagram can be drawn in between.
   * Its context records what the batch did so far, so E_NOT_FOUND can explain a missing id.
   */
  private beginBatch(commands: EditCommand[]): void {
    const table = new AliasTable(this.doc);
    const context: BatchContext = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => table.toRecord() };
    this.batch = { commands, all: new ChangeSet(), table, resolved: [...commands], pending: [], context };
    this.edit.begin();
  }

  /**
   * Runs the model commands from `from` to before `to`; a diagram command only has its aliases checked (one defined later is an error).
   * An element created and then retyped in the batch is listed by E_NOT_FOUND under its new id.
   */
  private runCommands(from: number, to: number): void {
    const batch = this.openBatch();
    this.inBatch(() => {
      for (let commandIndex = from; commandIndex < to; commandIndex++) {
        const command = batch.commands[commandIndex]!;
        this.atCommand(commandIndex, () => {
          if (isDiagramCommand(command)) {
            for (const { key, alias } of new CommandAliases(command).references()) batch.table.idOf(alias, commandIndex, command, key);
            batch.pending.push(commandIndex);
            return;
          }
          const ready = new CommandAliases(command).resolve(batch.table, commandIndex);
          batch.resolved[commandIndex] = ready;
          const cs = this.step(ready);
          batch.all.merge(cs);
          for (const replacement of cs.replaced) batch.table.rebind(replacement.from, replacement.to);
          for (const binding of cs.bindings) batch.table.define(binding.alias, binding.el, commandIndex);
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
        this.atCommand(pendingIndex, () => {
          const ready = (batch.resolved[pendingIndex] = new CommandAliases(batch.commands[pendingIndex]!).resolve(batch.table, pendingIndex));
          for (const id of new CommandAliases(ready).referencedIds()) if (!this.doc.get(id)) this.edit.require(id);
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
    new StaleFlowReport(this.edit).report(all, this.edit.flowsBefore);
    new IdRename(this.edit).reportStalePrefixes(all);
    return { changes: all, commands: batch.resolved, aliases: batch.table.toRecord() };
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
  private step(command: EditCommand): ChangeSet {
    const cs = this.dispatch(command);
    this.edit.allocator.reportSuffixed(cs);
    cs.rename(this.edit.takeRenames());
    return cs;
  }

  /** Diagram-only commands change nothing here: DiagramCommands runs them once the drawing is up to date. */
  private dispatch(command: EditCommand): ChangeSet {
    if (isDiagramCommand(command)) return new ChangeSet();
    switch (command.op) {
      case 'add':
        return new ElementCreation(this.edit).add(command);
      case 'connect':
        return new Connections(this.edit).connect(command);
      case 'set':
        return new Properties(this.edit).set(command);
      case 'remove':
        return new ElementRemoval(this.edit).remove(command);
      case 'retype':
        return new ElementTypeChange(this.edit).retype(command);
      case 'move':
        return new ElementMove(this.edit).move(command);
      case 'order':
        return new ElementOrder(this.edit).reorder(command);
      case 'ext':
        return new ExtensionElements(this.edit).apply(command);
      case 'split':
        return new BranchSplit(this.edit).split(command);
      default:
        throw usageError(`Unknown operation "${String((command as { op?: unknown }).op)}"`);
    }
  }

  /** A later op may have added the pool or put a gateway in between. */
  private stillHolds(warning: Finding): boolean {
    const doc = this.doc;
    const el = warning.element ? doc.get(warning.element) : undefined;
    switch (warning.code) {
      case 'W_LANES_WITHOUT_POOL': {
        const process = enclosingProcess(el?.$parent as El | undefined);
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
  private atCommand(commandIndex: number, fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      if (err && typeof err === 'object' && 'details' in err) {
        (err as { details: Record<string, unknown> }).details['op'] = commandIndex;
      }
      throw err;
    }
  }
}
