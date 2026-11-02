import { FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type ExtOperation = OperationOf<ExtOperationDefinition>;

export class ExtOperationDefinition extends OperationDefinition {
  readonly name = 'ext';
  readonly description = 'Add or remove vendor extension elements.';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Element id.'),
    action: OperationField.required(FieldValues.choice(['add', 'remove']), 'What to do with the extension elements.'),
    type: OperationField.optional(FieldValues.text, 'Prefixed element type or path (add: what to create, e.g. "zeebe:taskDefinition", "camunda:inputParameter" (filed into its container) or "camunda:connector/camunda:inputParameter"; remove: a selector such as "camunda:inputParameter[name=x]", every element of a bare type, or an index from `bpmn show <file> <id>` such as "2" or "loop.0"). A "definition." / "loop." / "condition." prefix addresses the nested element; one of several event definitions of an event: "definition[<n>]." (0-based) or "definition[<trigger>].".'),
    attrs: OperationField.optional(FieldValues.keys, 'add: attributes of the new element.'),
    body: OperationField.optional(FieldValues.text, 'add: text content of the new element.'),
    xml: OperationField.optional(FieldValues.text, 'add: raw XML snippet (may contain nested elements), parsed and appended instead of type/attrs/body.'),
    replace: OperationField.optional(FieldValues.flag, 'add: replace existing elements of the same type first.'),
    index: OperationField.batchOnly(FieldValues.index, 'remove: index within extensionElements (alternative to type; see `bpmn show <file> <id>`).'),
    slot: OperationField.batchOnly(FieldValues.choice(['definition', 'loop', 'condition']), 'A nested element of id instead of the element itself: the event definition, the loop characteristics or the condition expression (same as a "definition." / "loop." / "condition." prefix of type, e.g. "loop.camunda:failedJobRetryTimeCycle").'),
  };
  override readonly referenceKeys = ['id'];
  override readonly schemaRules = [
      { if: { properties: { action: { const: 'add' } } }, then: { anyOf: [{ required: ['type'] }, { required: ['xml'] }], not: { required: ['index'] } } },
      { if: { properties: { action: { const: 'remove' } } }, then: { oneOf: [{ required: ['type'] }, { required: ['index'] }], not: { anyOf: [{ required: ['attrs'] }, { required: ['body'] }, { required: ['xml'] }, { required: ['replace'] }] } } },
    ];

  protected override check(operation: OperationCheck): void {
    if (operation.fields['action'] === 'add') {
      this.checkAdd(operation);
    } else {
      this.checkRemove(operation);
    }
  }

  private checkAdd(operation: OperationCheck): void {
    const { type, xml, index, attrs, body } = operation.fields;
    if (type === undefined && xml === undefined) {
      throw operation.fail('ext add needs "type" (plus optional "attrs"/"body") or "xml"', 'Example: {"op":"ext","id":"serviceTask_x","action":"add","type":"zeebe:taskDefinition","attrs":{"type":"my-worker"}}.');
    }
    if (index !== undefined) {
      throw operation.fail('"index" only applies to action "remove"');
    }
    if (xml !== undefined && (attrs !== undefined || body !== undefined)) {
      throw operation.fail((key) => `${key('xml')} cannot be combined with ${key('attrs')} or ${key('body')}`, 'Put everything into the XML snippet, or use type + attrs + body.');
    }
  }

  private checkRemove(operation: OperationCheck): void {
    const addOnly = operation.present(['attrs', 'body', 'xml', 'replace']);
    if (addOnly.length) {
      throw operation.fail((key) => `${addOnly.map(key).join(', ')} only apply to action "add"`);
    }
    if ((operation.fields['type'] === undefined) === (operation.fields['index'] === undefined)) {
      throw operation.fail('ext remove needs exactly one of "type" or "index"', 'Run `bpmn show <file> <id>` to see types and indexes.');
    }
  }
}
