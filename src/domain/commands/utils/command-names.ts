import { EditCommandDefinitions } from '../definitions/EditCommandDefinitions.js';
import type { DiagramCommand, EditCommand } from '../types.js';

export const COMMAND_NAMES = EditCommandDefinitions.all().map((definition) => definition.name) as Array<EditCommand['op']>;

/** The diagram-only ops (they run in batch order, after the layout of the model ops before them). */
export const DIAGRAM_COMMAND_NAMES = EditCommandDefinitions.all().filter((definition) => definition.diagramCommand).map((definition) => definition.name) as Array<DiagramCommand['op']>;

export function isDiagramCommand(command: EditCommand): command is DiagramCommand {
  return EditCommandDefinitions.find(command.op)?.diagramCommand ?? false;
}
