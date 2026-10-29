import { defineRule, type ModdleElement } from '../CamundaRule.js';
import { C8ListenerEventTypeRule } from './C8ListenerEventTypeRule.js';
import type { C8Host } from './support/C8Host.js';

const TASK_LISTENER_EVENT_CHOICE = '<creating|assigning|updating|completing|canceling>';
const TASK_LISTENER_EVENTS = ['creating', 'assigning', 'updating', 'completing', 'canceling', 'create', 'assignment', 'update', 'complete', 'cancel'];

/**
 * A task listener without event type, or with one Camunda 8 does not know.
 * Camunda 8 runs task listeners on creating, assigning, updating, completing and canceling only
 * and refuses the file.
 *
 * @example a task listener with a Camunda 7 event
 * <zeebe:taskListeners><zeebe:taskListener eventType="timeout" type="remind" /></zeebe:taskListeners>  <!-- not a Camunda 8 event -->
 */
class C8TaskListenerEventTypeValidRule extends C8ListenerEventTypeRule {
  protected readonly list = 'zeebe:taskListeners';

  protected checkListeners(host: C8Host, value: ModdleElement, index: number): void {
    (value.listeners ?? []).forEach((listener: ModdleElement, listenerIndex: number) => {
      const eventType: string | undefined = listener.eventType;
      const rebuild = this.rebuildListenerHint(host, 'taskListener', listenerIndex, 'Rebuild it', `eventType=${TASK_LISTENER_EVENT_CHOICE} type=${listener.type ?? '<jobType>'}`);
      const label = `Task listener ${listenerIndex + 1}${eventType?.trim() ? ` (${eventType})` : ''} of ${host.describe()}`;
      if (!eventType?.trim()) {
        this.reportEventType(host, listener, index, listenerIndex, `${label} has no eventType; Camunda 8 refuses the file`, rebuild, true);
      } else if (!TASK_LISTENER_EVENTS.includes(eventType)) {
        this.reportEventType(host, listener, index, listenerIndex, `${label}: eventType "${eventType}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`, rebuild);
      }
    });
  }
}

export default defineRule({ ruleName: 'c8-task-listener-event-type-valid', code: 'W_C8_DEPLOY_LISTENER', impact: 'deploy' }, C8TaskListenerEventTypeValidRule);
