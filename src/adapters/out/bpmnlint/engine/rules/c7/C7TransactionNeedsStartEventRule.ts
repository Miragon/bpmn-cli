import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement, type ReportData } from '../CamundaRule.js';
import { C7MissingStartEventRule } from './C7MissingStartEventRule.js';

/**
 * A transaction without start event, an empty one too.
 * Camunda 7 deploys the file, but every instance that reaches the transaction fails.
 *
 * @example a transaction without start event
 * <bpmn:transaction id="Booking"><bpmn:task id="Reserve" /></bpmn:transaction>
 */
class C7TransactionNeedsStartEventRule extends C7MissingStartEventRule {
  protected checkScope(scope: ModdleElement, what: string, data: ReportData): void {
    if (!is(scope, 'bpmn:Transaction')) return;
    this.report(scope, `Transaction ${scope.id} ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess ${scope.id}")`, data);
  }
}

export default defineRule({ ruleName: 'c7-transaction-needs-start-event', code: 'W_C7_TRANSACTION_NO_START', impact: 'runtime' }, C7TransactionNeedsStartEventRule);
