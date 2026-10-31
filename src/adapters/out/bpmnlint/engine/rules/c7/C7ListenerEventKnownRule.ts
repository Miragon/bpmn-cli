import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C7ListenerRule, type Listener } from './C7ListenerRule.js';

const EXECUTION_EVENTS = ['start', 'end'];
const TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];

/**
 * An execution or task listener without event, or with an event the engines do not know for it;
 * the listeners of a sequence flow take none.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a listener on an unknown event
 * <camunda:executionListener class="org.acme.Audit" event="begin" />  <!-- start or end -->
 */
class C7ListenerEventKnownRule extends C7ListenerRule {
  protected checkListener(listener: Listener): void {
    const { host, extension, event, label } = listener;
    if (is(host.node, 'bpmn:SequenceFlow')) return;
    const { local } = extension;
    const allowed = local === 'taskListener' ? TASK_EVENTS : EXECUTION_EVENTS;
    const rebuild = host.rebuild(extension, { event: `<${allowed.join('|')}>` });
    if (event === undefined) {
      this.reportListener(listener, `${label} has no event; the engines refuse the file`, ['event'], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: 'event', hint: `Set event to one of ${allowed.join(', ')}. ${rebuild}` });
    } else if (!allowed.includes(event)) {
      this.reportListener(listener, `${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`, ['event'], ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, { property: 'event', hint: `${event === 'take' && local === 'executionListener' ? 'take is only read on sequence flows. ' : ''}${rebuild}` });
    }
  }
}

export default defineRule({ ruleName: 'c7-listener-event-known', code: 'W_C7_DEPLOY_LISTENER', impact: 'deploy' }, C7ListenerEventKnownRule);
