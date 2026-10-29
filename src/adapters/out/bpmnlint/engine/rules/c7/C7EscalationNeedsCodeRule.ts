import { defineRule } from '../CamundaRule.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * An escalation without escalation code that an escalation intermediate throw or end event throws.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a thrown escalation without code
 * <bpmn:escalation id="Late" name="Late" />  <!-- escalationCode="LATE" -->
 */
class C7EscalationNeedsCodeRule extends C7EventReferenceRule {
  protected readonly kind = 'Escalation';
  protected readonly events = ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'];

  protected checkReference(reference: EventReference): void {
    this.reportUncoded(reference);
  }
}

export default defineRule({ ruleName: 'c7-escalation-needs-code', code: 'W_C7_DEPLOY_ESCALATION', impact: 'deploy' }, C7EscalationNeedsCodeRule);
