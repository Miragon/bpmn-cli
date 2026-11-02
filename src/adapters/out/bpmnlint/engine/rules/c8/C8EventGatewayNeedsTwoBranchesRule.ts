import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { FlowIndex } from './support/FlowIndex.js';

/**
 * An event-based gateway with fewer than two outgoing flows.
 * Camunda 8 needs at least two events to wait for and refuses the file.
 *
 * @example an event-based gateway with one branch
 * <bpmn:eventBasedGateway id="Wait" />
 * <bpmn:sequenceFlow sourceRef="Wait" targetRef="PaymentReceived" />  <!-- the only branch -->
 */
class C8EventGatewayNeedsTwoBranchesRule extends C8Rule {
  private readonly flows = new FlowIndex();

  protected visit(gateway: ModdleElement): void {
    if (!is(gateway, 'bpmn:EventBasedGateway') || !EngineScope.C8.contains(gateway)) {
      return;
    }
    const flows = this.flows.outgoing(gateway);
    if (flows.length >= 2) return;
    this.report(gateway, `Event-based gateway ${gateway.id} has ${flows.length} outgoing flow${flows.length === 1 ? '' : 's'}; Camunda 8 needs at least two and refuses the file`, { path: ['outgoing'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'outgoing', hint: `Add a branch: \`bpmn add <file> intermediateCatchEvent:timer "<Timeout>" --after ${gateway.id} --timer PT1H\`.` });
  }
}

export default defineRule({ ruleName: 'c8-event-gateway-needs-two-branches', code: 'W_C8_DEPLOY_EVENT_GATEWAY', impact: 'deploy' }, C8EventGatewayNeedsTwoBranchesRule);
