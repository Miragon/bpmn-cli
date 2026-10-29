import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { FlowIndex } from './support/FlowIndex.js';

const GATEWAY_TRIGGERS = ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:ConditionalEventDefinition'];

/**
 * A branch of an event-based gateway that leads to anything but a message, timer, signal or
 * conditional intermediate catch event (a receive task is camunda-compat's
 * `event-based-gateway-target`).
 * Camunda 8 waits only for such events after the gateway and refuses the file.
 *
 * @example an event-based gateway that leads to a task
 * <bpmn:eventBasedGateway id="Wait" />
 * <bpmn:sequenceFlow sourceRef="Wait" targetRef="Ship" />  <!-- Ship is a service task -->
 */
class C8EventGatewayTargetAllowedRule extends C8Rule {
  private readonly flows = new FlowIndex();

  protected visit(gateway: ModdleElement): void {
    if (!is(gateway, 'bpmn:EventBasedGateway') || !EngineScope.C8.contains(gateway)) {
      return;
    }
    for (const flow of this.flows.outgoing(gateway)) {
      const target = flow.get('targetRef');
      if (!target || is(target, 'bpmn:ReceiveTask') || (is(target, 'bpmn:IntermediateCatchEvent') && GATEWAY_TRIGGERS.some((type) => C8EventDefinitions.onlyDefinition(target, type)))) {
        continue;
      }
      this.report(gateway, `Event-based gateway ${gateway.id} leads to ${ElementKinds.describe(target)}; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file`, { path: null, type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED, target, flow, hint: `Put a catch event in between: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${flow.id} --message <MessageName>\` (or retype ${target.id}).` });
    }
  }
}

export default defineRule({ ruleName: 'c8-event-gateway-target-allowed', code: 'W_C8_DEPLOY_EVENT_GATEWAY', impact: 'deploy' }, C8EventGatewayTargetAllowedRule);
