import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ListenerRule, type Listener } from './C7ListenerRule.js';

/**
 * A timeout task listener without bpmn:timerEventDefinition or without id.
 * Camunda 7 needs both to schedule the timeout and refuses to deploy the file.
 *
 * @example a timeout listener without timer
 * <camunda:taskListener id="Remind" class="org.acme.Remind" event="timeout" />  <!-- <bpmn:timerEventDefinition> -->
 */
class C7TimeoutListenerNeedsTimerAndIdRule extends C7ListenerRule {
  protected checkListener(listener: Listener): void {
    const { host, extension, event, label } = listener;
    if (extension.local !== 'taskListener' || event !== 'timeout') return;
    const { value } = extension;
    if (!(value.get('eventDefinitions') ?? []).some((definition: ModdleElement) => is(definition, 'bpmn:TimerEventDefinition'))) {
      this.reportListener(listener, `${label} has no bpmn:timerEventDefinition; the engines refuse the file`, ['eventDefinitions'], ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED, { requiredType: 'bpmn:TimerEventDefinition', hint: host.rebuild(extension) });
    }
    if (value.get('id') === undefined) {
      this.reportListener(listener, `${label} has no id, which the engines require on timeout task listeners; they refuse the file`, ['id'], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: 'id', hint: host.rebuild(extension, { id: '<listenerId>' }) });
    }
  }
}

export default defineRule({ ruleName: 'c7-timeout-listener-needs-timer-and-id', code: 'W_C7_DEPLOY_LISTENER', impact: 'deploy' }, C7TimeoutListenerNeedsTimerAndIdRule);
