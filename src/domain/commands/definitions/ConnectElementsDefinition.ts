import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { alias, bool, ref, str, type FieldsOf } from '../utils/field-specs.js';
import { defaultRule } from '../utils/schema-rules.js';
import type { ConnectElements } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class ConnectElementsDefinition extends EditCommandDefinition<ConnectElements> {
  readonly name = 'connect' as const;
  readonly description = 'Connect two elements; the connection kind (sequence flow, message flow, association, data association) is inferred (= `bpmn connect`).';
  readonly fields: FieldsOf<ConnectElements> = {
    source: ref('Source element id.', { required: true }),
    target: ref('Target element id.', { required: true }),
    name: str('Label of the connection (sequence flows only).'),
    id: ref('Explicit id of the connection.'),
    as: alias('Batch alias of the new connection (with ifAbsent and an existing one: that one).'),
    refAs: alias('Message flows: batch alias of the bpmn:Message it carries (created or found by `message`).'),
    condition: str('Condition expression (sequence flows only).'),
    language: str('Expression language of `condition`.'),
    default: bool('Make it the default flow of the source (sequence flows only).'),
    message: str('Message flows: name of the bpmn:Message (created when missing).'),
    ifAbsent: bool('Succeed without changes when an identical connection already exists.'),
  };
  readonly referenceKeys = ['source', 'target'];
  override readonly aliasKeyOfNewId = { id: 'as' };

  override check(command: CommandFieldCheck): void {
    command.flowOptions(false);
  }

  override schemaRules(): unknown[] {
    return [defaultRule()];
  }
}
