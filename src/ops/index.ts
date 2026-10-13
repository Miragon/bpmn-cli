/**
 * Op dispatcher. Every CLI command and `apply` go through here.
 */
import type { BatchContext, Doc, FlowEnds } from '../document.js';
import { usageError, type Warning } from '../errors.js';
import { is, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { addElement } from './add.js';
import { AliasTable, referencedIds, referencesOf, resolveOp } from './aliases.js';
import { connectElements } from './connect.js';
import { extensionOp } from './ext.js';
import { reportStaleFlows } from './flows.js';
import { moveElements } from './move.js';
import { orderFlows } from './order.js';
import { removeElements } from './remove.js';
import { retypeElement } from './retype.js';
import { reportStaleIdPrefixes, setProperties } from './set.js';
import { splitFlow } from './split.js';
import { isFormatOp, type Op } from './types.js';

export function runOp(doc: Doc, op: Op): ChangeSet {
  // a flow id kept although its ends changed, an id whose prefix a retype left stale: a batch takes the flows before it
  // and reports both at its end (runBatch), an op on its own here
  const alone = !doc.batch;
  const outerFlows = doc.flowsBefore;
  let before: ReadonlyMap<El, FlowEnds> | undefined;
  if (alone) {
    readIdStyle(doc);
    doc.takeKeptFlows();
    doc.takeIdStates();
    doc.forgetGeneratedIds();
    doc.flowsBefore = before = flowsNow(doc);
  }
  try {
    doc.takeSuffixed();
    doc.takeRenames();
    const cs = dispatch(doc, op);
    doc.reportSuffixed(cs);
    // a flow renamed after its new ends: every entry names its final id (merge applies it to earlier ops too)
    cs.rename(doc.takeRenames());
    if (alone) {
      reportStaleFlows(doc, cs, before);
      reportStaleIdPrefixes(doc, cs);
    }
    return cs;
  } finally {
    doc.flowsBefore = outerFlows;
  }
}

/**
 * Learns the document's id style (Doc.idStyle, learned once) before an op
 * removes the elements it learns from: otherwise a batch whose first op
 * removes flows could read another style from what is left, name new
 * elements in it and miss a flow whose id names its old ends (no rename, no
 * W_FLOW_ID_STALE).
 */
function readIdStyle(doc: Doc): void {
  void doc.idStyle;
}

/**
 * With flow ids kept (Doc.followFlowEnds false): the sequence flows the
 * document has now, the only ones that keep their id (a flow the batch or op
 * creates follows its ends), with their ends now.
 */
function flowsNow(doc: Doc): ReadonlyMap<El, FlowEnds> | undefined {
  if (doc.followFlowEnds) return undefined;
  const flows = [...doc.byId().values()].filter((el) => is(el, 'bpmn:SequenceFlow'));
  return new Map(flows.map((f) => [f, [f.get<El | undefined>('sourceRef'), f.get<El | undefined>('targetRef')]] as const));
}

function dispatch(doc: Doc, op: Op): ChangeSet {
  switch (op.op) {
    case 'add':
      return addElement(doc, op);
    case 'connect':
      return connectElements(doc, op);
    case 'set':
      return setProperties(doc, op);
    case 'remove':
      return removeElements(doc, op);
    case 'retype':
      return retypeElement(doc, op);
    case 'move':
      return moveElements(doc, op);
    case 'order':
      return orderFlows(doc, op);
    case 'ext':
      return extensionOp(doc, op);
    case 'split':
      return splitFlow(doc, op);
    case 'place':
    case 'align':
    case 'color':
    case 'label':
    case 'route':
    case 'space':
    case 'tidy':
    case 'compact':
      // diagram only: they run after the layout (src/diagram/ops.ts, called by the pipeline)
      return new ChangeSet();
    default:
      throw usageError(`Unknown operation "${String((op as { op?: unknown }).op)}"`);
  }
}

/** What a batch did: the merged changes, the ops with their aliases resolved (what the layout and the format phase run), alias -> final id. */
export interface BatchRun {
  changes: ChangeSet;
  ops: Op[];
  aliases: Record<string, string>;
}

/**
 * Runs a batch in order. Batch aliases (ops/aliases.ts): an op's aliases
 * are replaced by the current ids of their elements before it runs, the
 * aliases it defines are bound afterwards; the format ops (which run after
 * the layout) get the ids at the end of the batch. With flow ids kept
 * (Doc.followFlowEnds false) the flows the document had keep their ids, and
 * each one whose id no longer names its ends at the end of the batch is a
 * W_FLOW_ID_STALE warning (one per flow, none for a flow a later op removed
 * or put back between its old ends, or that ends where it did when the batch
 * began: it was stale before). Likewise W_ID_PREFIX_STALE: one per element a
 * retype or a trigger change kept the id of, from its state before the
 * batch to its state after it; an element the batch created takes the
 * prefix of its new kind instead (ops/set.ts recordIdState).
 */
export function runBatch(doc: Doc, ops: Op[]): BatchRun {
  const all = new ChangeSet();
  const table = new AliasTable(doc);
  const resolved: Op[] = [];
  const deferred: number[] = [];
  // what the batch did so far, for E_NOT_FOUND (document.ts require / suggest)
  const context: BatchContext = { created: [], renamed: new Map(), retyped: new Set(), aliases: () => table.toRecord() };
  readIdStyle(doc);
  doc.takeKeptFlows();
  doc.takeIdStates();
  doc.forgetGeneratedIds();
  const outer = doc.batch;
  const outerFlows = doc.flowsBefore;
  const before = flowsNow(doc);
  doc.batch = context;
  doc.flowsBefore = before;
  try {
    ops.forEach((op, i) =>
      atOp(i, () => {
        if (isFormatOp(op)) {
          // checked now (an alias defined later is an error), resolved at the end
          for (const { key, alias } of referencesOf(op)) table.idOf(alias, i, op, key);
          resolved.push(op);
          deferred.push(i);
          return;
        }
        const ready = resolveOp(op, table, i);
        resolved.push(ready);
        const cs = runOp(doc, ready);
        all.merge(cs);
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
      atOp(i, () => {
        const ready = (resolved[i] = resolveOp(ops[i]!, table, i));
        // an id an op of the batch renamed or removed is reported now, while E_NOT_FOUND can say what happened to it
        // (the format phase runs after the layout, outside the batch); its kind is checked there
        for (const id of referencedIds(ready)) if (!doc.get(id)) doc.require(id);
      });
    }
  } finally {
    doc.batch = outer;
    doc.flowsBefore = outerFlows;
  }
  all.bindings = [];
  // a warning about the model's state is about the batch's final state (a lane added before the pool that wraps its process)
  all.warnings = all.warnings.filter((w) => stillHolds(doc, w));
  // a kept flow id is stale against the flow's final ends, a kept id's prefix against the element's final type and trigger
  reportStaleFlows(doc, all, before);
  reportStaleIdPrefixes(doc, all);
  return { changes: all, ops: resolved, aliases: table.toRecord() };
}

/**
 * Whether an op warning that describes a state of the model, not what the
 * op did, still holds after the batch: W_LANES_WITHOUT_POOL (a later op
 * added the participant), W_IMPLICIT_SPLIT / W_IMPLICIT_JOIN (a later op
 * put a gateway in between). Every other warning holds.
 */
function stillHolds(doc: Doc, w: Warning): boolean {
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
function atOp(i: number, fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    if (err && typeof err === 'object' && 'details' in err) {
      (err as { details: Record<string, unknown> }).details['op'] = i;
    }
    throw err;
  }
}

/** Runs a batch (see runBatch) and returns what changed. */
export function runOps(doc: Doc, ops: Op[]): ChangeSet {
  return runBatch(doc, ops).changes;
}
