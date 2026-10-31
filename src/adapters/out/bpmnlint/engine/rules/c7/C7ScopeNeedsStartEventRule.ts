import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement, type ReportData } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7MissingStartEventRule } from './C7MissingStartEventRule.js';

/**
 * A process or sub-process without start event, an empty one too; an event sub-process without one
 * is left to other rules, a transaction to the transaction rule.
 * Camunda 7 refuses to deploy the file (`process must define a startEvent element`).
 *
 * @example a process without start event
 * <bpmn:process id="Order" isExecutable="true"><bpmn:task id="Check" /></bpmn:process>
 */
class C7ScopeNeedsStartEventRule extends C7MissingStartEventRule {
  protected checkScope(scope: ModdleElement, what: string, data: ReportData): void {
    if (is(scope, 'bpmn:Transaction') || EngineScope.isEventSubProcess(scope)) {
      return;
    }
    const isProcess = is(scope, 'bpmn:Process');
    this.report(scope, `${isProcess ? 'Process' : 'Sub-process'} ${scope.id} ${what}; the engines refuse the file (${isProcess ? 'process' : 'subProcess'} must define a startEvent element)`, data);
  }
}

export default defineRule({ ruleName: 'c7-scope-needs-start-event', code: 'W_C7_DEPLOY_START_EVENT', impact: 'deploy' }, C7ScopeNeedsStartEventRule);
