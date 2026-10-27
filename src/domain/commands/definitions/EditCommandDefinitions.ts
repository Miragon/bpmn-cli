import type { EditCommand } from '../types.js';
import { AddElementDefinition } from './AddElementDefinition.js';
import { AlignShapesDefinition } from './AlignShapesDefinition.js';
import { ChangeElementTypeDefinition } from './ChangeElementTypeDefinition.js';
import { ColorElementsDefinition } from './ColorElementsDefinition.js';
import { CompactDiagramDefinition } from './CompactDiagramDefinition.js';
import { ConnectElementsDefinition } from './ConnectElementsDefinition.js';
import type { EditCommandDefinition } from './EditCommandDefinition.js';
import { EditExtensionElementsDefinition } from './EditExtensionElementsDefinition.js';
import { InsertSpaceDefinition } from './InsertSpaceDefinition.js';
import { MoveElementsDefinition } from './MoveElementsDefinition.js';
import { PlaceLabelDefinition } from './PlaceLabelDefinition.js';
import { PlaceShapesDefinition } from './PlaceShapesDefinition.js';
import { RemoveElementsDefinition } from './RemoveElementsDefinition.js';
import { ReorderElementsDefinition } from './ReorderElementsDefinition.js';
import { RerouteFlowDefinition } from './RerouteFlowDefinition.js';
import { SetPropertiesDefinition } from './SetPropertiesDefinition.js';
import { SplitIntoBranchesDefinition } from './SplitIntoBranchesDefinition.js';
import { TidyShapesDefinition } from './TidyShapesDefinition.js';

type DefinitionByName = { [Name in EditCommand['op']]: EditCommandDefinition<Extract<EditCommand, { op: Name }>> };

const DEFINITIONS: DefinitionByName = {
  add: new AddElementDefinition(),
  connect: new ConnectElementsDefinition(),
  set: new SetPropertiesDefinition(),
  remove: new RemoveElementsDefinition(),
  retype: new ChangeElementTypeDefinition(),
  move: new MoveElementsDefinition(),
  order: new ReorderElementsDefinition(),
  ext: new EditExtensionElementsDefinition(),
  split: new SplitIntoBranchesDefinition(),
  place: new PlaceShapesDefinition(),
  align: new AlignShapesDefinition(),
  color: new ColorElementsDefinition(),
  label: new PlaceLabelDefinition(),
  route: new RerouteFlowDefinition(),
  space: new InsertSpaceDefinition(),
  tidy: new TidyShapesDefinition(),
  compact: new CompactDiagramDefinition(),
};

export class EditCommandDefinitions {
  static of(name: EditCommand['op']): EditCommandDefinition {
    return DEFINITIONS[name] as unknown as EditCommandDefinition;
  }

  static find(name: string): EditCommandDefinition | undefined {
    return Object.hasOwn(DEFINITIONS, name) ? EditCommandDefinitions.of(name as EditCommand['op']) : undefined;
  }

  static all(): EditCommandDefinition[] {
    return Object.values(DEFINITIONS) as unknown as EditCommandDefinition[];
  }
}
