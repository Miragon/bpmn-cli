import { FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type ConnectOperation = OperationOf<ConnectOperationDefinition>;

export class ConnectOperationDefinition extends OperationDefinition {
  readonly name = 'connect';
  readonly description = 'Connect two elements; the connection kind (sequence flow, message flow, association, data association) is inferred (= `bpmn connect`).';
  readonly fields = {
    source: OperationField.required(FieldValues.reference, 'Source element id.'),
    target: OperationField.required(FieldValues.reference, 'Target element id.'),
    id: OperationField.optional(FieldValues.reference, 'Explicit id of the connection.'),
    as: OperationField.alias('Batch alias of the new connection (with ifAbsent and an existing one: that one).'),
    refAs: OperationField.alias('Message flows: batch alias of the bpmn:Message it carries (created or found by the key `message` of `set`).'),
    ifAbsent: OperationField.optional(FieldValues.flag, 'Succeed without changes when an identical connection already exists.'),
    set: OperationField.optional(FieldValues.keys, 'What the connection holds: the keys of `bpmn set` on it: name, condition, language, default, message.'),
  };
  override readonly referenceKeys = ['source', 'target'];
  override readonly aliasKeyOfNewId = { id: 'as' };
  override readonly schemaRules = [{ properties: { set: { not: { required: ['default', 'condition'], properties: { default: { enum: [true, 'true'] } } } } } }];

  protected override check(operation: OperationCheck): void {
    operation.defaultFlow((operation.fields['set'] as Record<string, string> | undefined) ?? {});
  }
}
