import { is, isAny } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement, type ReportPath } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { SetCommand } from '../support/SetCommand.js';
import { Values } from '../support/Values.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';
import { ImplementationHost } from './support/ImplementationHost.js';

const JOB_PRIORITIZED = ['bpmn:Activity', 'bpmn:Gateway', 'bpmn:Event'];

/**
 * A camunda:jobPriority or external task camunda:taskPriority that is neither an integer nor an
 * expression: of a process, an activity, gateway or event, a multi-instance loop, or an external
 * task.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a priority in words
 * <bpmn:serviceTask id="Charge" camunda:asyncBefore="true" camunda:jobPriority="high" />  <!-- 50 -->
 */
class C7JobPriorityValidRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const prefix = C7Diagram.of(node).prefix;
    const command = new SetCommand(node.id);
    if (is(node, 'bpmn:Process')) {
      for (const name of ['jobPriority', 'taskPriority']) {
        this.checkPriority(node, node, [], command, name, prefix);
      }
    }
    if (isAny(node, JOB_PRIORITIZED) && !is(node, 'bpmn:AdHocSubProcess')) {
      this.checkPriority(node, node, [], command, 'jobPriority', prefix);
      const loop = node.get('loopCharacteristics');
      if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
        this.checkPriority(loop, node, ['loopCharacteristics'], new SetCommand(node.id, 'loop.'), 'jobPriority', prefix);
      }
    }
    for (const host of ImplementationHost.forElement(node)) {
      if (host.isExternal) {
        this.checkPriority(host.element, node, host.path, host.command, 'taskPriority', prefix);
      }
    }
  }

  /** `element` carries the priority; `reported` is the element it sits on, or the element itself. */
  private checkPriority(element: ModdleElement, reported: ModdleElement, path: ReportPath, command: SetCommand, name: string, prefix: string): void {
    const value = new CamundaAttributes(element).defined(name);
    if (value === undefined || Values.isPriority(value)) return;
    this.report(reported, `${prefix}:${name}="${value}" on ${ElementKinds.describe(element, element === reported ? undefined : reported)} is not a number or expression; the engines refuse it`, { path: [...path, name], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: name, hint: reported.id ? `${command.of(`${prefix}:${name}=50`)} (an integer or \${...}).` : 'Use an integer.' });
  }
}

export default defineRule({ ruleName: 'c7-job-priority-valid', code: 'W_C7_DEPLOY_BAD_VALUE', impact: 'deploy' }, C7JobPriorityValidRule);
