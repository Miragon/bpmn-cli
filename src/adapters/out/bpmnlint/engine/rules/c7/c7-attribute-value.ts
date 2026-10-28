import { is, isAny } from 'bpmnlint-utils';
import { defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter, type ReportPath } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { ImplementationHost } from './implementation/ImplementationHost.js';
import { SetCommand } from './implementation/SetCommand.js';
import { isExpression, isInteger } from './implementation/utils/values.js';
import { C7Diagram } from './C7Diagram.js';

const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];
const JOB_PRIORITIZED = ['bpmn:Activity', 'bpmn:Gateway', 'bpmn:Event'];

/**
 * Reports a job or external task priority that is neither a number nor an expression, and a
 * `camunda:mapDecisionResult` the engines do not know: Camunda 7 refuses the file.
 */
class C7AttributeValue extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    const command = new SetCommand(node.id);
    if (is(node, 'bpmn:Process')) {
      this.checkPriority(node, node, [], command, 'jobPriority', reporter);
      this.checkPriority(node, node, [], command, 'taskPriority', reporter);
    }
    if (isAny(node, JOB_PRIORITIZED) && !is(node, 'bpmn:AdHocSubProcess')) {
      this.checkPriority(node, node, [], command, 'jobPriority', reporter);
      this.checkLoopPriority(node, reporter);
    }
    for (const host of ImplementationHost.forElement(node)) {
      if (host.isExternal) {
        this.checkPriority(host.element, node, host.path, host.command, 'taskPriority', reporter);
      }
    }
    if (is(node, 'bpmn:BusinessRuleTask')) {
      this.checkDecisionMapper(node, reporter);
    }
  }

  private checkLoopPriority(activity: ModdleElement, reporter: Reporter): void {
    const loop = activity.get('loopCharacteristics');
    if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      const command = new SetCommand(activity.id, 'loop.');
      this.checkPriority(loop, activity, ['loopCharacteristics'], command, 'jobPriority', reporter);
    }
  }

  /** `element` carries the priority; `reported` is the element it sits on, or the element itself. */
  private checkPriority(
    element: ModdleElement,
    reported: ModdleElement,
    path: ReportPath,
    command: SetCommand,
    name: string,
    reporter: Reporter,
  ): void {
    const value = new CamundaAttributes(element).defined(name);
    if (value === undefined || isInteger(value) || isExpression(value)) {
      return;
    }
    const owner = element === reported ? undefined : reported;
    const prefix = C7Diagram.of(reported).prefix;
    reportErrors(reported, reporter, {
      message: `${prefix}:${name}="${value}" on ${describeElement(element, owner)} is not a number or expression; the engines refuse it`,
      path: [...path, name],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node: element,
        parentNode: owner ?? null,
        property: name,
        hint: reported.id
          ? `${command.of(`${prefix}:${name}=50`)} (an integer or \${...}).`
          : 'Use an integer.',
      },
    });
  }

  private checkDecisionMapper(node: ModdleElement, reporter: Reporter): void {
    const attributes = new CamundaAttributes(node);
    const mapper = attributes.defined('mapDecisionResult');
    if (
      attributes.defined('decisionRef') === undefined ||
      mapper === undefined ||
      DECISION_MAPPERS.includes(mapper)
    ) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    reportErrors(node, reporter, {
      message: `${prefix}:mapDecisionResult="${mapper}" on ${describeElement(node)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`,
      path: ['mapDecisionResult'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node,
        parentNode: null,
        property: 'mapDecisionResult',
        hint: `${new SetCommand(node.id).of(`${prefix}:mapDecisionResult=singleEntry`)} (or another of the four).`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-attribute-value', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7AttributeValue,
);
