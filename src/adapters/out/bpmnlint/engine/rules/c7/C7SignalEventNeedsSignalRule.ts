import { defineRule } from '../CamundaRule.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * A signal event without signal.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a signal event without signal
 * <bpmn:intermediateThrowEvent id="Alarm"><bpmn:signalEventDefinition /></bpmn:intermediateThrowEvent>  <!-- signalRef -->
 */
class C7SignalEventNeedsSignalRule extends C7EventReferenceRule {
  protected readonly kind = 'Signal';
  protected readonly events = ['bpmn:Event'];

  protected checkReference(reference: EventReference): void {
    if (!reference.referenced) {
      this.reportMissing(reference, 'has no signal', 'signal=<SignalName>');
    }
  }
}

export default defineRule({ ruleName: 'c7-signal-event-needs-signal', code: 'W_C7_DEPLOY_SIGNAL', impact: 'deploy' }, C7SignalEventNeedsSignalRule);
