import { CompactOperationDefinition, type CompactOperation } from './drawing/CompactOperationDefinition.js';
import { ColorOperationDefinition, type ColorOperation } from './drawing/ColorOperationDefinition.js';
import { LabelOperationDefinition, type LabelOperation } from './drawing/LabelOperationDefinition.js';
import { LayoutOperationDefinition, type LayoutOperation } from './drawing/LayoutOperationDefinition.js';
import { PlaceOperationDefinition, type PlaceOperation } from './drawing/PlaceOperationDefinition.js';
import { RouteOperationDefinition, type RouteOperation } from './drawing/RouteOperationDefinition.js';
import { SpaceOperationDefinition, type SpaceOperation } from './drawing/SpaceOperationDefinition.js';
import { TidyOperationDefinition, type TidyOperation } from './drawing/TidyOperationDefinition.js';
import type { OperationDefinition } from './fields/OperationDefinition.js';
import { AddOperationDefinition, type AddOperation } from './model/AddOperationDefinition.js';
import { ConnectOperationDefinition, type ConnectOperation } from './model/ConnectOperationDefinition.js';
import { ExtOperationDefinition, type ExtOperation } from './model/ExtOperationDefinition.js';
import { MoveOperationDefinition, type MoveOperation } from './model/MoveOperationDefinition.js';
import { OrderOperationDefinition, type OrderOperation } from './model/OrderOperationDefinition.js';
import { RemoveOperationDefinition, type RemoveOperation } from './model/RemoveOperationDefinition.js';
import { RetypeOperationDefinition, type RetypeOperation } from './model/RetypeOperationDefinition.js';
import { SetOperationDefinition, type SetOperation } from './model/SetOperationDefinition.js';
import { SplitOperationDefinition, type SplitOperation } from './model/SplitOperationDefinition.js';

export type ModelOperation = AddOperation | ConnectOperation | SetOperation | RemoveOperation | RetypeOperation | MoveOperation | OrderOperation | ExtOperation | SplitOperation;

export type DrawingOperation = LayoutOperation | TidyOperation | CompactOperation | PlaceOperation | ColorOperation | LabelOperation | RouteOperation | SpaceOperation;

export type Operation = ModelOperation | DrawingOperation;

export interface OperationInput {
  op: string;
  [field: string]: unknown;
}

export class OperationCatalog {
  static readonly MODEL: readonly OperationDefinition[] = [new AddOperationDefinition(), new ConnectOperationDefinition(), new SetOperationDefinition(), new RemoveOperationDefinition(), new RetypeOperationDefinition(), new MoveOperationDefinition(), new OrderOperationDefinition(), new ExtOperationDefinition(), new SplitOperationDefinition()];
  static readonly DRAWING: readonly OperationDefinition[] = [new LayoutOperationDefinition(), new TidyOperationDefinition(), new CompactOperationDefinition(), new PlaceOperationDefinition(), new ColorOperationDefinition(), new LabelOperationDefinition(), new RouteOperationDefinition(), new SpaceOperationDefinition()];
  static readonly ALL: readonly OperationDefinition[] = [...OperationCatalog.MODEL, ...OperationCatalog.DRAWING];

  static names(): string[] {
    return OperationCatalog.ALL.map((definition) => definition.name);
  }

  static find(name: string): OperationDefinition | undefined {
    return OperationCatalog.ALL.find((definition) => definition.name === name);
  }

  static isDrawing(operation: Operation): operation is DrawingOperation {
    return OperationCatalog.DRAWING.some((definition) => definition.name === operation.op);
  }
}
