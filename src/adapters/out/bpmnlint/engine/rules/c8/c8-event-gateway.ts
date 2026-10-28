import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8EventPosition } from './events/C8EventPosition.js';
import { FlowIndex } from './events/FlowIndex.js';

const GATEWAY_TRIGGERS = [
  'bpmn:MessageEventDefinition',
  'bpmn:TimerEventDefinition',
  'bpmn:SignalEventDefinition',
  'bpmn:ConditionalEventDefinition',
];

/**
 * Reports an event-based gateway Camunda 8 refuses to deploy: one with fewer than two outgoing
 * flows (as the engine counts them, from the gateway's `<bpmn:outgoing>` entries), or one leading
 * to anything but a message, timer, signal or conditional intermediate catch event.
 */
class C8EventGateway extends C8Rule {
  private readonly flows = new FlowIndex();

  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:EventBasedGateway') || !C8EventPosition.isExecutable(node)) {
      return;
    }

    const flows = this.flows.outgoing(node);
    this.checkBranchCount(node, flows, reporter);
    for (const flow of flows) {
      this.checkTarget(node, flow, reporter);
    }
  }

  private checkBranchCount(node: ModdleElement, flows: ModdleElement[], reporter: Reporter) {
    const listed = (node.get('outgoing') ?? []).filter(
      (flow: ModdleElement) => flow.get('sourceRef') === node,
    );
    if (flows.length < 2) {
      this.reportBranchCount(
        node,
        `Event-based gateway ${node.id} has ${flows.length} outgoing flow${flows.length === 1 ? '' : 's'}; Camunda 8 needs at least two and refuses the file`,
        `Add a branch: \`bpmn add <file> intermediateCatchEvent:timer "<Timeout>" --after ${node.id} --timer PT1H\`.`,
        reporter,
      );
    } else if (listed.length < 2) {
      const missing = flows.filter((flow) => !listed.includes(flow)).map((flow) => flow.id);
      this.reportBranchCount(
        node,
        `Event-based gateway ${node.id} has ${flows.length} outgoing flows, but the file lists ${listed.length} of them as its <bpmn:outgoing> entries; Camunda 8 counts the listed ones and refuses the file`,
        `Add the missing <bpmn:outgoing>${missing.join('</bpmn:outgoing>, <bpmn:outgoing>')}</bpmn:outgoing> entries to ${node.id} in the XML (Camunda Modeler writes them; this file leaves the lists out, and \`bpmn\` keeps a file's style).`,
        reporter,
      );
    }
  }

  private reportBranchCount(node: ModdleElement, message: string, hint: string, reporter: Reporter) {
    reportErrors(node, reporter, {
      message,
      path: ['outgoing'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node,
        parentNode: null,
        requiredProperty: 'outgoing',
        hint,
      },
    });
  }

  /** A receive task after the gateway is camunda-compat's `event-based-gateway-target`. */
  private checkTarget(node: ModdleElement, flow: ModdleElement, reporter: Reporter): void {
    const target = flow.get('targetRef');
    if (!target || is(target, 'bpmn:ReceiveTask') || this.isGatewayTrigger(target)) {
      return;
    }
    reportErrors(node, reporter, {
      message: `Event-based gateway ${node.id} leads to ${describeElement(target)}; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file`,
      path: null,
      data: {
        type: ERROR_TYPES.EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED,
        node,
        parentNode: null,
        target,
        flow,
        hint: `Put a catch event in between: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${flow.id} --message <MessageName>\` (or retype ${target.id}).`,
      },
    });
  }

  private isGatewayTrigger(target: ModdleElement): boolean {
    if (!is(target, 'bpmn:IntermediateCatchEvent')) {
      return false;
    }
    const definitions = target.get('eventDefinitions');
    return definitions.length === 1 && GATEWAY_TRIGGERS.some((type) => is(definitions[0], type));
  }
}

export default defineRule(
  { ruleName: 'c8-event-gateway', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-event-gateway': ['W_C8_DEPLOY_EVENT_GATEWAY', 'deploy'] } },
  C8EventGateway,
);
