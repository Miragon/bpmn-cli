import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { bool, map, ref, str, type FieldsOf } from '../utils/field-specs.js';
import type { EditExtensionElements } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class EditExtensionElementsDefinition extends EditCommandDefinition<EditExtensionElements> {
  readonly name = 'ext' as const;
  readonly description = 'Add or remove vendor extension elements (= `bpmn ext`).';
  readonly fields: FieldsOf<EditExtensionElements> = {
    id: ref('Element id.', { required: true }),
    action: str('What to do with the extension elements.', { required: true, values: ['add', 'remove'] }),
    type: str('Prefixed element type or path (add: what to create, e.g. "zeebe:taskDefinition", "camunda:inputParameter" (filed into its container) or "camunda:connector/camunda:inputParameter"; remove: a selector such as "camunda:inputParameter[name=x]", every element of a bare type, or an index from `ext list` such as "2" or "loop.0"). A "definition." / "loop." / "condition." prefix addresses the nested element; one of several event definitions of an event: "definition[<n>]." (0-based) or "definition[<trigger>].".'),
    attrs: map('add: attributes of the new element.'),
    body: str('add: text content of the new element.'),
    xml: str('add: raw XML snippet (may contain nested elements), parsed and appended instead of type/attrs/body.'),
    replace: bool('add: replace existing elements of the same type first.'),
    index: { type: 'integer', description: 'remove: index within extensionElements (alternative to type; see `ext list`).' },
    slot: str('A nested element of id instead of the element itself: the event definition, the loop characteristics or the condition expression (same as a "definition." / "loop." / "condition." prefix of type, e.g. "loop.camunda:failedJobRetryTimeCycle").', { values: ['definition', 'loop', 'condition'] }),
  };
  readonly referenceKeys = ['id'];

  override check(command: CommandFieldCheck): void {
    const obj = command.fields;
    const addOnly = ['attrs', 'body', 'xml', 'replace'];
    if (obj['action'] === 'add') {
      if (obj['type'] === undefined && obj['xml'] === undefined) throw command.fail('ext add needs "type" (plus optional "attrs"/"body") or "xml"', 'Example: {"op":"ext","id":"serviceTask_x","action":"add","type":"zeebe:taskDefinition","attrs":{"type":"my-worker"}}.');
      if (obj['index'] !== undefined) throw command.fail('"index" only applies to action "remove"');
      if (obj['xml'] !== undefined && (obj['attrs'] !== undefined || obj['body'] !== undefined)) throw command.fail('"xml" cannot be combined with "attrs" or "body"', 'Put everything into the XML snippet, or use type + attrs + body.');
    } else {
      const bad = command.present(addOnly);
      if (bad.length) throw command.fail(`${bad.map((badKey) => `"${badKey}"`).join(', ')} only apply to action "add"`);
      const hasType = obj['type'] !== undefined;
      const hasIndex = obj['index'] !== undefined;
      if (hasType === hasIndex) throw command.fail('ext remove needs exactly one of "type" or "index"', 'Run `bpmn ext list <file> <id>` to see types and indexes.');
    }
  }

  override schemaRules(): unknown[] {
    return [
      { if: { properties: { action: { const: 'add' } } }, then: { anyOf: [{ required: ['type'] }, { required: ['xml'] }], not: { required: ['index'] } } },
      { if: { properties: { action: { const: 'remove' } } }, then: { oneOf: [{ required: ['type'] }, { required: ['index'] }], not: { anyOf: [{ required: ['attrs'] }, { required: ['body'] }, { required: ['xml'] }, { required: ['replace'] }] } } },
    ];
  }
}
