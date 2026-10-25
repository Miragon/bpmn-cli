import type { Doc } from '../model/Doc.js';
import { EditContext, type BatchContext } from '../model/EditContext.js';
import { usageError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { is, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { AliasTable } from './AliasTable.js';
import { OpAliases } from './OpAliases.js';
import { ExtensionEditor } from './ExtensionEditor.js';
import { Reordering } from './Reordering.js';
import { isFormatOp } from './utils/op-names.js';
import type { Op } from './types.js';
import { IdRenamer } from './IdRenamer.js';
import { StaleFlowReport } from './StaleFlowReport.js';
import { ElementRemover } from './ElementRemover.js';
import { ElementRetyper } from './ElementRetyper.js';
import { ElementAdder } from './ElementAdder.js';
import { ElementConnector } from './ElementConnector.js';
import { FlowSplitter } from './FlowSplitter.js';
import { NodeMover } from './NodeMover.js';
import { PropertySetter } from './PropertySetter.js';

/** The merged changes, the ops with aliases resolved (for layout and format) and alias -> id. */
export interface BatchRun {
  changes: ChangeSet;
  ops: Op[];
  aliases: Record<string, string>;
}

/**
 * Dispatches ops: every CLI command and `apply` run through here, inside one edit context
 * that is the document's while they run.
 */
export class OpRunner {
  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext = new EditContext(doc),
  ) {}

  /** Runs one op on its own; stale flow ids and id prefixes are reported at its end. */
  runOp(op: Op): ChangeSet {
    return this.within(() => {
      this.edit.begin();
      const cs = this.step(op);
      new StaleFlowReport(this.doc).report(cs, this.edit.flowsBefore);
      new IdRenamer(this.doc).reportStalePrefixes(cs);
      return cs;
    });
  }

  /**
   * Runs a batch in order. Aliases resolve to the current ids before each op; format ops run
   * after the layout and get the ids at the end of the batch. Stale flow ids and id prefixes
   * are reported once, against the state before and after the whole batch.
   */
  runBatch(ops: Op[]): BatchRun {
    return this.within(() => {
      const all = new ChangeSet();
      const table = new AliasTable(this.doc);
      const resolved: Op[] = [];
      const deferred: number[] = [];
      // what the batch did so far, so E_NOT_FOUND can explain a missing id
      const context: BatchContext = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => table.toRecord() };
      this.edit.begin();
      this.edit.batch = context;
      try {
        ops.forEach((op, i) =>
          this.atOp(i, () => {
            if (isFormatOp(op)) {
              // checked now (an alias defined later is an error), resolved at the end
              for (const { key, alias } of new OpAliases(op).references()) table.idOf(alias, i, op, key);
              resolved.push(op);
              deferred.push(i);
              return;
            }
            const ready = new OpAliases(op).resolve(table, i);
            resolved.push(ready);
            const cs = this.step(ready);
            all.merge(cs);
            for (const r of cs.replaced) table.rebind(r.from, r.to);
            for (const b of cs.bindings) table.define(b.alias, b.el, i);
            context.created.push(...cs.created.map((c) => c.id));
            for (const r of cs.renames) {
              for (const [old, now] of context.renamed) if (now === r.from) context.renamed.set(old, r.to);
              context.renamed.set(r.from, r.to);
              // created and retyped in the batch: E_NOT_FOUND lists it under its new id
              if (!r.regenerated) continue;
              if (!r.was) context.retyped!.add(r.from);
              context.created = context.created.map((c) => (c === r.from ? r.to : c));
            }
          }),
        );
        for (const i of deferred) {
          this.atOp(i, () => {
            const ready = (resolved[i] = new OpAliases(ops[i]!).resolve(table, i));
            // the format phase runs outside the batch: E_NOT_FOUND can explain a lost id only now
            for (const id of new OpAliases(ready).referencedIds()) if (!this.doc.get(id)) this.doc.require(id);
          });
        }
      } finally {
        this.edit.batch = undefined;
      }
      all.bindings = [];
      all.replaced = [];
      // model-state warnings describe the final state (a lane added before its pool)
      all.warnings = all.warnings.filter((w) => this.stillHolds(w));
      new StaleFlowReport(this.doc).report(all, this.edit.flowsBefore);
      new IdRenamer(this.doc).reportStalePrefixes(all);
      return { changes: all, ops: resolved, aliases: table.toRecord() };
    });
  }

  private within<T>(run: () => T): T {
    const outer = this.doc.edit;
    this.doc.edit = this.edit;
    try {
      return run();
    } finally {
      this.doc.edit = outer;
    }
  }

  /** Every entry names its final id; merge applies renames to earlier ops too. */
  private step(op: Op): ChangeSet {
    const cs = this.dispatch(op);
    this.edit.allocator.reportSuffixed(cs);
    cs.rename(this.edit.takeRenames());
    return cs;
  }

  private dispatch(op: Op): ChangeSet {
    const doc = this.doc;
    switch (op.op) {
      case 'add':
        return new ElementAdder(doc).add(op);
      case 'connect':
        return new ElementConnector(doc).connect(op);
      case 'set':
        return new PropertySetter(doc).set(op);
      case 'remove':
        return new ElementRemover(doc).remove(op);
      case 'retype':
        return new ElementRetyper(doc).retype(op);
      case 'move':
        return new NodeMover(doc).move(op);
      case 'order':
        return new Reordering(doc, op).apply();
      case 'ext':
        return new ExtensionEditor(doc).apply(op);
      case 'split':
        return new FlowSplitter(doc).split(op);
      case 'place':
      case 'align':
      case 'color':
      case 'label':
      case 'route':
      case 'space':
      case 'tidy':
      case 'compact':
        // diagram only: they run after the layout
        return new ChangeSet();
      default:
        throw usageError(`Unknown operation "${String((op as { op?: unknown }).op)}"`);
    }
  }

  /** A later op may have added the pool or put a gateway in between. */
  private stillHolds(w: Warning): boolean {
    const doc = this.doc;
    const el = w.element ? doc.get(w.element) : undefined;
    switch (w.code) {
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
  private atOp(i: number, fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      if (err && typeof err === 'object' && 'details' in err) {
        (err as { details: Record<string, unknown> }).details['op'] = i;
      }
      throw err;
    }
  }
}
