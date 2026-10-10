/**
 * Op dispatcher. Every CLI command and `apply` go through here.
 */
import type { Doc } from '../document.js';
import { usageError } from '../errors.js';
import { ChangeSet } from '../result.js';
import { addElement } from './add.js';
import { AliasTable, referencesOf, resolveOp } from './aliases.js';
import { connectElements } from './connect.js';
import { extensionOp } from './ext.js';
import { moveElements } from './move.js';
import { orderFlows } from './order.js';
import { removeElements } from './remove.js';
import { retypeElement } from './retype.js';
import { setProperties } from './set.js';
import { splitFlow } from './split.js';
import { isFormatOp, type Op } from './types.js';

export function runOp(doc: Doc, op: Op): ChangeSet {
  doc.takeSuffixed();
  doc.takeRenames();
  const cs = dispatch(doc, op);
  doc.reportSuffixed(cs);
  // a flow renamed after its new ends: every entry names its final id (merge applies it to earlier ops too)
  cs.rename(doc.takeRenames());
  return cs;
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
 * the layout) get the ids at the end of the batch.
 */
export function runBatch(doc: Doc, ops: Op[]): BatchRun {
  const all = new ChangeSet();
  const table = new AliasTable(doc);
  const resolved: Op[] = [];
  const deferred: number[] = [];
  ops.forEach((op, i) => {
    try {
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
    } catch (err) {
      if (err && typeof err === 'object' && 'details' in err) {
        (err as { details: Record<string, unknown> }).details['op'] = i;
      }
      throw err;
    }
  });
  for (const i of deferred) {
    try {
      resolved[i] = resolveOp(ops[i]!, table, i);
    } catch (err) {
      if (err && typeof err === 'object' && 'details' in err) (err as { details: Record<string, unknown> }).details['op'] = i;
      throw err;
    }
  }
  all.bindings = [];
  return { changes: all, ops: resolved, aliases: table.toRecord() };
}

/** Runs a batch (see runBatch) and returns what changed. */
export function runOps(doc: Doc, ops: Op[]): ChangeSet {
  return runBatch(doc, ops).changes;
}
