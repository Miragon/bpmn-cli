/**
 * Op dispatcher. Every CLI command and `apply` go through here.
 */
import type { Doc } from '../model/Doc.js';
import { EditContext, type BatchContext } from '../model/EditContext.js';
import { usageError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { is, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { AliasTable, referencedIds, referencesOf, resolveOp } from './aliases.js';
import { extensionOp } from './ext.js';
import { orderFlows } from './order.js';
import { setProperties } from './set.js';
import { IdRenamer } from './IdRenamer.js';
import { isFormatOp, type Op } from './types.js';
import { StaleFlowReport } from './StaleFlowReport.js';
import { ElementRemover } from './ElementRemover.js';
import { ElementRetyper } from './ElementRetyper.js';
import { ElementAdder } from './ElementAdder.js';
import { ElementConnector } from './ElementConnector.js';
import { FlowSplitter } from './FlowSplitter.js';
import { NodeMover } from './NodeMover.js';

/** What a batch did: the merged changes, the ops with their aliases resolved (what the layout and the format phase run), alias -> final id. */
export interface BatchRun {
  changes: ChangeSet;
  ops: Op[];
  aliases: Record<string, string>;
}

/**
 * Runs ops on a document in the edit `edit` (src/model/EditContext.ts; a
 * new one with the document's settings by default), which is the
 * document's (Doc.edit) while they run.
 */
export class OpRunner {
  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext = new EditContext(doc),
  ) {}

  /**
   * Runs one op on its own. A flow id kept although its ends changed, an id
   * whose prefix a retype left stale: reported at its end, like a batch
   * reports them at the end of the batch.
   */
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
   * Runs a batch in order. Batch aliases (ops/aliases.ts): an op's aliases
   * are replaced by the current ids of their elements before it runs, the
   * aliases it defines are bound afterwards; the format ops (which run after
   * the layout) get the ids at the end of the batch. With flow ids kept
   * (EditContext.followFlowEnds false) the flows the document had keep their
   * ids, and each one whose id no longer names its ends at the end of the
   * batch is a W_FLOW_ID_STALE warning (one per flow, none for a flow a later
   * op removed or put back between its old ends, or that ends where it did
   * when the batch began: it was stale before). Likewise W_ID_PREFIX_STALE:
   * one per element a retype or a trigger change kept the id of, from its
   * state before the batch to its state after it; an element the batch
   * created takes the prefix of its new kind instead (ops/set.ts
   * recordIdState).
   */
  runBatch(ops: Op[]): BatchRun {
    return this.within(() => {
      const all = new ChangeSet();
      const table = new AliasTable(this.doc);
      const resolved: Op[] = [];
      const deferred: number[] = [];
      // what the batch did so far, for E_NOT_FOUND (model/Doc.ts require / suggest)
      const context: BatchContext = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => table.toRecord() };
      this.edit.begin();
      this.edit.batch = context;
      try {
        ops.forEach((op, i) =>
          this.atOp(i, () => {
            if (isFormatOp(op)) {
              // checked now (an alias defined later is an error), resolved at the end
              for (const { key, alias } of referencesOf(op)) table.idOf(alias, i, op, key);
              resolved.push(op);
              deferred.push(i);
              return;
            }
            const ready = resolveOp(op, table, i);
            resolved.push(ready);
            const cs = this.step(ready);
            all.merge(cs);
            for (const r of cs.replaced) table.rebind(r.from, r.to);
            for (const b of cs.bindings) table.define(b.alias, b.el, i);
            context.created.push(...cs.created.map((c) => c.id));
            for (const r of cs.renames) {
              for (const [old, now] of context.renamed) if (now === r.from) context.renamed.set(old, r.to);
              context.renamed.set(r.from, r.to);
              // an element created and retyped in the batch (and a flow named after it): E_NOT_FOUND says why, and lists it under its new id
              if (!r.regenerated) continue;
              if (!r.was) context.retyped!.add(r.from);
              context.created = context.created.map((c) => (c === r.from ? r.to : c));
            }
          }),
        );
        for (const i of deferred) {
          this.atOp(i, () => {
            const ready = (resolved[i] = resolveOp(ops[i]!, table, i));
            // an id an op of the batch renamed or removed is reported now, while E_NOT_FOUND can say what happened to it
            // (the format phase runs after the layout, outside the batch); its kind is checked there
            for (const id of referencedIds(ready)) if (!this.doc.get(id)) this.doc.require(id);
          });
        }
      } finally {
        this.edit.batch = undefined;
      }
      all.bindings = [];
      all.replaced = [];
      // a warning about the model's state is about the batch's final state (a lane added before the pool that wraps its process)
      all.warnings = all.warnings.filter((w) => this.stillHolds(w));
      // a kept flow id is stale against the flow's final ends, a kept id's prefix against the element's final type and trigger
      new StaleFlowReport(this.doc).report(all, this.edit.flowsBefore);
      new IdRenamer(this.doc).reportStalePrefixes(all);
      return { changes: all, ops: resolved, aliases: table.toRecord() };
    });
  }

  /** Runs `run` with the edit as the document's (Doc.edit), the one before it back afterwards. */
  private within<T>(run: () => T): T {
    const outer = this.doc.edit;
    this.doc.edit = this.edit;
    try {
      return run();
    } finally {
      this.doc.edit = outer;
    }
  }

  /** Runs one op: W_ID_SUFFIXED for the ids it suffixed, and a flow renamed after its new ends: every entry names its final id (merge applies it to earlier ops too). */
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
        return setProperties(doc, op);
      case 'remove':
        return new ElementRemover(doc).remove(op);
      case 'retype':
        return new ElementRetyper(doc).retype(op);
      case 'move':
        return new NodeMover(doc).move(op);
      case 'order':
        return orderFlows(doc, op);
      case 'ext':
        return extensionOp(doc, op);
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
        // diagram only: they run after the layout (src/format/index.ts, called by the pipeline)
        return new ChangeSet();
      default:
        throw usageError(`Unknown operation "${String((op as { op?: unknown }).op)}"`);
    }
  }

  /**
   * Whether an op warning that describes a state of the model, not what the
   * op did, still holds after the batch: W_LANES_WITHOUT_POOL (a later op
   * added the participant), W_IMPLICIT_SPLIT / W_IMPLICIT_JOIN (a later op
   * put a gateway in between). Every other warning holds.
   */
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

  /** Runs one step of op `i`; an error it throws names the op. */
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
