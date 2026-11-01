import { OperationDefinition, type OperationOf } from '../fields/index.js';

export type LayoutOperation = OperationOf<LayoutOperationDefinition>;

export class LayoutOperationDefinition extends OperationDefinition {
  readonly name = 'layout';
  readonly description = 'Diagram only: redraw the whole diagram in full (= `bpmn layout`).';
  readonly fields = {};
}
