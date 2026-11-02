import { FieldSets, FieldValues, OperationDefinition, OperationField, RefusalWording, type OperationCheck, type OperationOf } from '../fields/index.js';

export type SetOperation = OperationOf<SetOperationDefinition>;

export class SetOperationDefinition extends OperationDefinition {
  readonly name = 'set';
  readonly description = 'Set or remove properties of an element.';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Element id.'),
    set: OperationField.optional(FieldValues.keys, 'Properties to set (`bpmn guide set-keys` lists the keys per element family).'),
    unset: FieldSets.unset,
    refAs: FieldSets.refAs,
  };
  override readonly referenceKeys = ['id'];
  override readonly schemaRules = [{ anyOf: [{ required: ['set'], properties: { set: { minProperties: 1 } } }, { required: ['unset'] }] }];

  protected override check(operation: OperationCheck): void {
    const keys = (operation.fields['set'] as object | undefined) ?? {};
    if (!Object.keys(keys).length && operation.fields['unset'] === undefined) {
      throw operation.fail((key) => `nothing to do: give ${key('set')} or ${key('unset')}`, RefusalWording.onlyInBatch('Example: {"op":"set","id":"task_x","set":{"name":"New name"}} or {"op":"set","id":"task_x","unset":["name"]}.'));
    }
  }
}
