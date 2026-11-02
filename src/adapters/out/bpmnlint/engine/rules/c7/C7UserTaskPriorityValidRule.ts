import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { SetCommand } from '../support/SetCommand.js';
import { Values } from '../support/Values.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A camunda:priority of a user task that is neither a number nor an expression.
 * Camunda 7 deploys the file, but creating the task fails when the process reaches it.
 *
 * @example a task priority in words
 * <bpmn:userTask id="Review" camunda:priority="urgent" />  <!-- 50 -->
 */
class C7UserTaskPriorityValidRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const priority = is(node, 'bpmn:UserTask') ? new CamundaAttributes(node).defined('priority') : undefined;
    if (priority === undefined || Values.isPriority(priority)) return;
    const prefix = C7Diagram.of(node).prefix;
    this.report(node, `${prefix}:priority="${priority}" on ${ElementKinds.describe(node)} is not a number or expression; creating the task fails`, { path: ['priority'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'priority', hint: `${new SetCommand(node.id).of(`${prefix}:priority=50`)}.` });
  }
}

export default defineRule({ ruleName: 'c7-user-task-priority-valid', code: 'W_C7_BAD_VALUE', impact: 'runtime' }, C7UserTaskPriorityValidRule);
