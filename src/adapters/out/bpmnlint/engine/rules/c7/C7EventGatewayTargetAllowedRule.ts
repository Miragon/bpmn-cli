import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7EventGateway } from './support/C7EventGateway.js';

/**
 * A branch of an event-based gateway that leads to anything but a message, timer, signal or
 * conditional intermediate catch event.
 * Camunda 7 refuses to deploy the file. The finding is on the branch, no property of the gateway:
 * the path is null.
 *
 * @example a task right after an event-based gateway
 * <bpmn:eventBasedGateway id="Wait" />
 * <bpmn:sequenceFlow sourceRef="Wait" targetRef="Ship" />  <!-- a catch event first -->
 */
class C7EventGatewayTargetAllowedRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:EventBasedGateway')) return;
    for (const { flow, target, definitions } of C7EventGateway.branches(node)) {
      const leadsTo = `Event-based gateway ${node.id} leads to ${ElementKinds.describe(target)}`;
      if (!definitions) {
        this.report(node, `${leadsTo}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`, { path: null, type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED, node: target, sequenceFlow: flow, hint: `Put a catch event in front of it: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${flow.id} --message <MessageName>\` (or :timer --timer PT1H).` });
      } else if (!C7EventGateway.waits(definitions)) {
        this.report(node, `${leadsTo}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`, { path: null, type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED, node: target, sequenceFlow: flow, hint: `\`bpmn set <file> ${target.id} trigger=message message=<MessageName>\` (or trigger=timer timer=PT1H).` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c7-event-gateway-target-allowed', code: 'W_C7_DEPLOY_EVENT_GATEWAY', impact: 'deploy' }, C7EventGatewayTargetAllowedRule);
