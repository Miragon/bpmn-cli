import { EditCommandDefinitions } from '../definitions/EditCommandDefinitions.js';
import type { DiagramCommand, EditCommand } from '../types.js';

export const OP_NAMES = EditCommandDefinitions.all().map((definition) => definition.name) as Array<EditCommand['op']>;

/** The diagram-only ops (they run in batch order, after the layout of the model ops before them). */
export const FORMAT_OP_NAMES = EditCommandDefinitions.all().filter((definition) => definition.diagramOnly).map((definition) => definition.name) as Array<DiagramCommand['op']>;

export function isDiagramCommand(op: EditCommand): op is DiagramCommand {
  return EditCommandDefinitions.find(op.op)?.diagramOnly ?? false;
}
