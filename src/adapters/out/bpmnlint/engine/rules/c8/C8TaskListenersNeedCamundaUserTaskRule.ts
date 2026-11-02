import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * Task listeners on a job worker user task (one without zeebe:userTask).
 * Camunda 8 runs task listeners on Camunda user tasks only and refuses the file.
 *
 * @example task listeners on a job worker user task
 * <bpmn:userTask id="Review">
 *   <bpmn:extensionElements><zeebe:taskListeners>...</zeebe:taskListeners></bpmn:extensionElements>  <!-- no zeebe:userTask -->
 * </bpmn:userTask>
 */
class C8TaskListenersNeedCamundaUserTaskRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const values = host.zeebeValues();
    const hint = host.hint();
    for (const { type, placement } of values) {
      if (placement !== 'read' || type.name !== 'zeebe:taskListeners' || values.some((zeebeValue) => zeebeValue.type.name === 'zeebe:userTask')) {
        continue;
      }
      this.reportOn(host, `${host.describe()} has task listeners but is a job worker user task (no ${host.spell('zeebe:userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`, { path: host.path('extensionElements'), type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED, node: host.node, requiredExtensionElement: 'zeebe:UserTask', hint: hint ? `Make it a Camunda user task: ${hint.extAdd(hint.name('userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${hint.id} ${hint.name('taskListeners')}\`).` : 'Make it a Camunda user task in the XML (or remove the listeners).' });
    }
  }
}

export default defineRule({ ruleName: 'c8-task-listeners-need-camunda-user-task', code: 'W_C8_DEPLOY_LISTENER', impact: 'deploy' }, C8TaskListenersNeedCamundaUserTaskRule);
