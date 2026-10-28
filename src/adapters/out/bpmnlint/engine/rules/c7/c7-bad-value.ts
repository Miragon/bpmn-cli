import { is } from 'bpmnlint-utils';
import { defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { ImplementationHost } from './implementation/ImplementationHost.js';
import { ReferenceBinding } from './implementation/ReferenceBinding.js';
import { SetCommand } from './implementation/SetCommand.js';
import { isExpression, isInteger } from './implementation/utils/values.js';
import { C7Diagram } from './C7Diagram.js';

const VARIABLE_EVENTS = ['create', 'update', 'delete'];

/**
 * Reports a value Camunda 7 deploys but cannot use when the process runs: an empty external task
 * topic or called element, an unknown binding, a user task priority that is not a number or
 * expression, or a variable event that never triggers a condition.
 */
class C7BadValue extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    this.checkTopics(node, reporter);
    if (is(node, 'bpmn:CallActivity')) {
      this.checkCalledElement(node, reporter);
    }
    this.checkBindings(node, reporter);
    if (is(node, 'bpmn:UserTask')) {
      this.checkPriority(node, reporter);
    }
    if (is(node, 'bpmn:Event')) {
      this.checkVariableEvents(node, reporter);
    }
  }

  private checkTopics(node: ModdleElement, reporter: Reporter): void {
    for (const host of ImplementationHost.forElement(node)) {
      if (!host.isExternal || host.attributes.defined('topic') !== '') {
        continue;
      }
      reportErrors(node, reporter, {
        message: `${host.label} is an external task with an empty ${host.prefix}:topic; no worker can fetch it`,
        path: host.pathTo('topic'),
        data: {
          type: ERROR_TYPES.PROPERTY_VALUE_REQUIRED,
          node: host.element,
          parentNode: host.parentNode,
          property: 'topic',
          hint: `${host.command.of(`${host.prefix}:topic=<topic>`)}.`,
        },
      });
    }
  }

  private checkCalledElement(node: ModdleElement, reporter: Reporter): void {
    if (
      node.get('calledElement') !== '' ||
      new CamundaAttributes(node).defined('caseRef') !== undefined
    ) {
      return;
    }
    reportErrors(node, reporter, {
      message: `Call activity ${node.id} has an empty calledElement; it fails when it runs`,
      path: ['calledElement'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_REQUIRED,
        node,
        parentNode: null,
        property: 'calledElement',
        hint: `${new SetCommand(node.id).of('calledElement=<processId>')}.`,
      },
    });
  }

  private checkBindings(node: ModdleElement, reporter: Reporter): void {
    const prefix = C7Diagram.of(node).prefix;
    for (const binding of ReferenceBinding.forElement(node)) {
      if (binding.problem !== 'value') {
        continue;
      }
      reportErrors(node, reporter, {
        message: `${prefix}:${binding.binding}="${binding.value}" on ${describeElement(node)} is not one of ${binding.allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`,
        path: [binding.binding],
        data: {
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          node,
          parentNode: null,
          property: binding.binding,
          hint: `${new SetCommand(node.id).of(`${prefix}:${binding.binding}=latest`)}.`,
        },
      });
    }
  }

  private checkPriority(node: ModdleElement, reporter: Reporter): void {
    const priority = new CamundaAttributes(node).defined('priority');
    if (priority === undefined || isInteger(priority) || isExpression(priority)) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    reportErrors(node, reporter, {
      message: `${prefix}:priority="${priority}" on ${describeElement(node)} is not a number or expression; creating the task fails`,
      path: ['priority'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node,
        parentNode: null,
        property: 'priority',
        hint: `${new SetCommand(node.id).of(`${prefix}:priority=50`)}.`,
      },
    });
  }

  private checkVariableEvents(node: ModdleElement, reporter: Reporter): void {
    const prefix = C7Diagram.of(node).prefix;
    const conditions = new C7EventDefinitions(node).indexedOfType('bpmn:ConditionalEventDefinition');
    for (const { definition, index } of conditions) {
      const events = new CamundaAttributes(definition).defined('variableEvents');
      const unknown = (events ?? '')
        .split(',')
        .map((eventName) => eventName.trim())
        .filter((eventName) => eventName && !VARIABLE_EVENTS.includes(eventName));
      if (!unknown.length) {
        continue;
      }
      reportErrors(node, reporter, {
        message: `${prefix}:variableEvents="${events}" of ${describeElement(node)} lists ${unknown.join(', ')}; only ${VARIABLE_EVENTS.join(', ')} trigger the condition`,
        path: ['eventDefinitions', index, 'variableEvents'],
        data: {
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          node: definition,
          parentNode: node,
          property: 'variableEvents',
          hint: `${SetCommand.forDefinition(node, index).of(`${prefix}:variableEvents=create, update`)}.`,
        },
      });
    }
  }
}

export default defineRule(
  { ruleName: 'c7-bad-value', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7BadValue,
);
