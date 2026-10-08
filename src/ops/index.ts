/**
 * Op dispatcher. Every CLI command and `apply` go through here.
 */
import type { Doc } from '../document.js';
import { usageError } from '../errors.js';
import { ChangeSet } from '../result.js';
import { addElement } from './add.js';
import { connectElements } from './connect.js';
import { extensionOp } from './ext.js';
import { moveElements } from './move.js';
import { orderFlows } from './order.js';
import { removeElements } from './remove.js';
import { retypeElement } from './retype.js';
import { setProperties } from './set.js';
import { splitFlow } from './split.js';
import type { Op } from './types.js';

export function runOp(doc: Doc, op: Op): ChangeSet {
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

export function runOps(doc: Doc, ops: Op[]): ChangeSet {
  const all = new ChangeSet();
  ops.forEach((op, i) => {
    try {
      all.merge(runOp(doc, op));
    } catch (err) {
      if (err && typeof err === 'object' && 'details' in err) {
        (err as { details: Record<string, unknown> }).details['op'] = i;
      }
      throw err;
    }
  });
  return all;
}
