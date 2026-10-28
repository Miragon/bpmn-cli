import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7FlowGraph } from './flows/C7FlowGraph.js';
import { C7FlowRule } from './flows/C7FlowRule.js';
import { C7Diagram } from './C7Diagram.js';

/**
 * Reports an ad-hoc sub-process with a sequence flow, a boundary event or a multi-instance loop:
 * Camunda 7 does not run ad-hoc sub-processes and refuses the file. One that nothing connects
 * deploys and is skipped with its content; Operaton deploys one with a valid loop too.
 */
class C7AdHocSubProcess extends C7FlowRule {
  protected checkRunElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:AdHocSubProcess')) {
      return;
    }
    const graph = C7FlowGraph.forElement(node);
    const incoming = graph.incoming(node);
    const flows = [...incoming, ...graph.outgoing(node)];
    const boundaryEvents = graph.boundaryEvents(node);
    if (flows.length || boundaryEvents.length) {
      this.reportConnected(node, reporter, flows, incoming.length > 0, boundaryEvents);
    } else if (this.isMultiInstance(node) && !C7Diagram.of(node).operaton) {
      reportErrors(node, reporter, {
        message: `Ad-hoc sub-process ${node.id} has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)`,
        path: ['loopCharacteristics'],
        data: {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          parentNode: null,
          property: 'loopCharacteristics',
          hint: `${this.retypeHint(node)}, or drop the loop: \`bpmn set <file> ${node.id} loop=none\`.`,
        },
      });
    }
  }

  private reportConnected(
    node: ModdleElement,
    reporter: Reporter,
    flows: ModdleElement[],
    hasIncoming: boolean,
    boundaryEvents: ModdleElement[],
  ): void {
    const parts = [
      this.listed('sequence flow', flows),
      this.listed('boundary event', boundaryEvents),
    ].filter(Boolean);
    const refusal = flows.length
      ? `invalid ${hasIncoming ? 'destination' : 'source'} '${node.id}' of sequence flow ${flows[0].id}`
      : 'invalid reference in boundary event';
    reportErrors(node, reporter, {
      message: `Ad-hoc sub-process ${node.id} is connected (${parts.join(' and ')}); the engines do not run ad-hoc sub-processes and refuse the file (${refusal})`,
      path: null,
      data: {
        type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        node,
        parentNode: null,
        flows,
        boundaryEvents,
        hint: `${this.retypeHint(node)}.`,
      },
    });
  }

  private retypeHint(node: ModdleElement): string {
    return `Make it an embedded sub-process: \`bpmn retype <file> ${node.id} subProcess\`, then give its content a start event and flows (\`bpmn add <file> startEvent "<Name>" --in ${node.id}\`, \`bpmn connect <file> <fromId> <toId>\`)`;
  }

  private isMultiInstance(node: ModdleElement): boolean {
    const loop = node.loopCharacteristics;
    return !!loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics');
  }

  /** `sequence flows F1, F2`, or '' for none. */
  private listed(kind: string, elements: ModdleElement[]): string {
    if (!elements.length) {
      return '';
    }
    const ids = elements.map((element) => element.id).join(', ');
    return `${kind}${elements.length > 1 ? 's' : ''} ${ids}`;
  }
}

export default defineRule(
  { ruleName: 'c7-ad-hoc-sub-process', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7AdHocSubProcess,
);
