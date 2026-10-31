import { defineRule } from '../CamundaRule.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * An escalation intermediate throw or end event without escalation.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an escalation end event that names no escalation
 * <bpmn:endEvent id="Escalated"><bpmn:escalationEventDefinition /></bpmn:endEvent>  <!-- escalationRef -->
 */
class C7EscalationThrowNeedsEscalationRule extends C7EventReferenceRule {
  protected readonly kind = 'Escalation';
  protected readonly events = ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'];

  protected checkReference(reference: EventReference): void {
    if (!reference.referenced) {
      this.reportMissing(reference, 'throws no escalation (no escalationRef)', 'escalation=<Name> escalationCode=<CODE>');
    }
  }
}

export default defineRule({ ruleName: 'c7-escalation-throw-needs-escalation', code: 'W_C7_DEPLOY_ESCALATION', impact: 'deploy' }, C7EscalationThrowNeedsEscalationRule);
