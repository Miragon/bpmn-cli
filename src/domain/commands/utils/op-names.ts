import type { DiagramCommand, EditCommand } from '../types.js';

/** The diagram-only ops (they run in batch order, after the layout of the model ops before them). */
export const FORMAT_OP_NAMES: Array<DiagramCommand['op']> = ['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact'];

export const OP_NAMES: Array<EditCommand['op']> = ['add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'ext', 'split', ...FORMAT_OP_NAMES];

export function isDiagramCommand(op: EditCommand): op is DiagramCommand {
  return (FORMAT_OP_NAMES as string[]).includes(op.op);
}
