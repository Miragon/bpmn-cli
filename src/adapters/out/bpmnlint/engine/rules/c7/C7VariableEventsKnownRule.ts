import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { SetCommand } from '../support/SetCommand.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

const VARIABLE_EVENTS = ['create', 'update', 'delete'];

/**
 * camunda:variableEvents of a conditional event that list an event other than create, update and
 * delete.
 * Camunda 7 deploys the file, but only create, update and delete trigger the condition.
 *
 * @example an unknown variable event
 * <bpmn:conditionalEventDefinition camunda:variableEvents="change" />  <!-- update -->
 */
class C7VariableEventsKnownRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:Event')) return;
    const prefix = C7Diagram.of(node).prefix;
    for (const { definition, index } of new C7EventDefinitions(node).indexedOfType('bpmn:ConditionalEventDefinition')) {
      const events = new CamundaAttributes(definition).defined('variableEvents');
      const unknown = (events ?? '').split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && !VARIABLE_EVENTS.includes(eventName));
      if (unknown.length) {
        this.report(node, `${prefix}:variableEvents="${events}" of ${ElementKinds.describe(node)} lists ${unknown.join(', ')}; only ${VARIABLE_EVENTS.join(', ')} trigger the condition`, { path: ['eventDefinitions', index, 'variableEvents'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: definition, property: 'variableEvents', hint: `${SetCommand.forDefinition(node, index).of(`${prefix}:variableEvents=create, update`)}.` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c7-variable-events-known', code: 'W_C7_BAD_VALUE', impact: 'runtime' }, C7VariableEventsKnownRule);
