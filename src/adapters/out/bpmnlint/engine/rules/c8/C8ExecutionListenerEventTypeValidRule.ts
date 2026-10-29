import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement } from '../CamundaRule.js';
import { C8ListenerEventTypeRule } from './C8ListenerEventTypeRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * An execution listener without event type, with one Camunda 8 does not know (beforeAll and cancel
 * from 8.10 on), a start listener on a start or boundary event, or an end listener on a gateway.
 * Camunda 8 refuses the file.
 *
 * @example a start listener on a start event
 * <bpmn:startEvent id="Received">
 *   <bpmn:extensionElements><zeebe:executionListeners><zeebe:executionListener eventType="start" type="audit" /></zeebe:executionListeners></bpmn:extensionElements>  <!-- end -->
 * </bpmn:startEvent>
 */
class C8ExecutionListenerEventTypeValidRule extends C8ListenerEventTypeRule {
  protected readonly list = 'zeebe:executionListeners';

  protected checkListeners(host: C8Host, value: ModdleElement, index: number): void {
    const allowedEvents = this.runsAtLeast(host.node, '8.10') ? ['start', 'end', 'beforeAll', 'cancel'] : ['start', 'end'];
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      const eventType: string | undefined = listener.eventType;
      const label = `Execution listener ${listenerIndex + 1}${eventType?.trim() ? ` (${eventType})` : ''} of ${host.describe()}`;
      const rebuild = (lead: string, eventTypeFix: string) => this.rebuildListenerHint(host, 'executionListener', listenerIndex, lead, `eventType=${eventTypeFix} type=${listener.type ?? '<jobType>'}`);
      const unsupported = (where: string, lead: string, fix: string) => this.reportEventType(host, listener, index, listenerIndex, `${label}: Camunda 8 does not support ${eventType} listeners on ${where} and refuses the file`, rebuild(lead, fix));
      if (!eventType?.trim()) {
        this.reportEventType(host, listener, index, listenerIndex, `${label} has no eventType; Camunda 8 refuses the file`, rebuild('Rebuild it', '<start|end>'), true);
      } else if (!allowedEvents.includes(eventType)) {
        this.reportEventType(host, listener, index, listenerIndex, `${label}: eventType "${eventType}" is not ${allowedEvents.length === 2 ? 'start or end' : `one of ${allowedEvents.join(', ')}`}; Camunda 8 refuses the file`, rebuild('Rebuild it', '<start|end>'));
      } else if (eventType === 'start' && is(host.node, 'bpmn:StartEvent')) {
        unsupported('start events', 'Make it an end listener or remove it', 'end');
      } else if (eventType === 'start' && is(host.node, 'bpmn:BoundaryEvent')) {
        unsupported('boundary events', 'Make it an end listener or remove it', 'end');
      } else if (eventType === 'end' && is(host.node, 'bpmn:Gateway')) {
        unsupported('gateways', 'Make it a start listener or remove it', 'start');
      }
    });
  }
}

export default defineRule({ ruleName: 'c8-execution-listener-event-type-valid', code: 'W_C8_DEPLOY_LISTENER', impact: 'deploy' }, C8ExecutionListenerEventTypeValidRule);
