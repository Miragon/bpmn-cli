import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';

/**
 * A start event of an event sub-process without a trigger.
 * Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and
 * refuses the file.
 *
 * @example an event sub-process with a none start event
 * <bpmn:subProcess id="OnCancel" triggeredByEvent="true">
 *   <bpmn:startEvent id="Cancelled" />  <!-- no event definition -->
 * </bpmn:subProcess>
 */
class C8EventSubProcessStartNeedsTriggerRule extends C8Rule {
  protected visit(event: ModdleElement): void {
    if (!is(event, 'bpmn:StartEvent') || !EngineScope.C8.contains(event)) return;
    if ((event.get('eventDefinitions') ?? []).length || !EngineScope.isEventSubProcess(event.$parent)) {
      return;
    }
    this.report(event, `Start event ${event.id} of event sub-process ${event.$parent.id} has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, { path: ['eventDefinitions'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'eventDefinitions', hint: `\`bpmn set <file> ${event.id} trigger=message message=<MessageName>\` (or timer, error, signal, escalation, conditional).` });
  }
}

export default defineRule({ ruleName: 'c8-event-sub-process-start-needs-trigger', code: 'W_C8_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C8EventSubProcessStartNeedsTriggerRule);
