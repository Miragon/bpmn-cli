import { defineRule } from '../CamundaRule.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * An error without error code that an error end event throws.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a thrown error without code
 * <bpmn:error id="Rejected" name="Rejected" />  <!-- errorCode="REJECTED" -->
 */
class C7ErrorNeedsCodeRule extends C7EventReferenceRule {
  protected readonly kind = 'Error';
  protected readonly events = ['bpmn:EndEvent'];

  protected checkReference(reference: EventReference): void {
    this.reportUncoded(reference);
  }
}

export default defineRule({ ruleName: 'c7-error-needs-code', code: 'W_C7_DEPLOY_ERROR', impact: 'deploy' }, C7ErrorNeedsCodeRule);
