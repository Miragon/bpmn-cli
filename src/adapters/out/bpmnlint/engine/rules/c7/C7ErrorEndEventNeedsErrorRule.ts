import { defineRule } from '../CamundaRule.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * An error end event without error.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an error end event that names no error
 * <bpmn:endEvent id="Failed">
 *   <bpmn:errorEventDefinition />  <!-- no errorRef -->
 * </bpmn:endEvent>
 */
class C7ErrorEndEventNeedsErrorRule extends C7EventReferenceRule {
  protected readonly kind = 'Error';
  protected readonly events = ['bpmn:EndEvent'];

  protected checkReference(reference: EventReference): void {
    if (!reference.referenced) {
      this.reportMissing(reference, 'throws no error (no errorRef)', 'error=<ErrorName> errorCode=<CODE>');
    }
  }
}

export default defineRule({ ruleName: 'c7-error-end-event-needs-error', code: 'W_C7_DEPLOY_ERROR', impact: 'deploy' }, C7ErrorEndEventNeedsErrorRule);
