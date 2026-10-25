import type { FormatOp, Op } from '../../types.js';

/** The diagram-only ops (they run after the semantic ops and the layout, in batch order). */
export const FORMAT_OP_NAMES: Array<FormatOp['op']> = ['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact'];

export const OP_NAMES: Array<Op['op']> = ['add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'ext', 'split', ...FORMAT_OP_NAMES];

export function isFormatOp(op: Op): op is FormatOp {
  return (FORMAT_OP_NAMES as string[]).includes(op.op);
}
