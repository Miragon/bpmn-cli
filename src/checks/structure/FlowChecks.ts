import { type BpmnDocument, type BpmnElement, BpmnError, ElementText, Triggers } from '../../model/index.js';
import type { StructureFindings } from './StructureFindings.js';

export class FlowChecks {
  constructor(
    private readonly document: BpmnDocument,
    private readonly findings: StructureFindings,
  ) {}

  checkSequenceFlow(flow: BpmnElement, scope: BpmnElement): void {
    const source = flow.peek<BpmnElement>('sourceRef');
    const target = flow.peek<BpmnElement>('targetRef');
    if (!source || !target) {
      return;
    }
    try {
      this.document.flowRules.assertEndpoints(source, target, flow);
    } catch (err) {
      if (!(err instanceof BpmnError)) {
        throw err;
      }
      if (this.leavesTheReportToAnotherIncoming(flow, source, target)) {
        return;
      }
      this.findings.error(err.code, err.message, ElementText.shownId(flow), { related: [ElementText.shownId(source), ElementText.shownId(target)], hint: err.details['hint'] as string | undefined });
      return;
    }
    if (source.is('bpmn:BoundaryEvent') && Triggers.of(source) === 'compensate') {
      this.findings.error('E_INVALID_SOURCE', `Compensate boundary event ${ElementText.shownId(source)} cannot have outgoing sequence flows (${ElementText.shownId(flow)} -> ${ElementText.shownId(target)})`, ElementText.shownId(flow), { related: [ElementText.shownId(source), ElementText.shownId(target)], hint: `The compensation handler is linked by an association, not a sequence flow: \`bpmn remove <file> ${ElementText.shownId(flow)}\`, then \`bpmn connect <file> ${ElementText.shownId(source)} ${ElementText.shownId(target)}\`.` });
    }
    const ends: Array<[BpmnElement, string, string]> = [
      [source, 'E_INVALID_SOURCE', 'source'],
      [target, 'E_INVALID_TARGET', 'target'],
    ];
    for (const [end, code, role] of ends) {
      if (end.peek<boolean>('isForCompensation') !== true) {
        continue;
      }
      this.findings.error(code, `Compensation handler ${this.findings.describe(end)} cannot be the ${role} of a sequence flow (${ElementText.shownId(flow)})`, ElementText.shownId(flow), { related: [ElementText.shownId(source), ElementText.shownId(target)], hint: `A compensation handler hangs off a compensate boundary event by association only: \`bpmn remove <file> ${ElementText.shownId(flow)}\`, or make it a normal activity with \`bpmn set <file> ${ElementText.shownId(end)} isForCompensation=false\`.` });
    }
    const endpointScope = this.document.scopes.scopeOf(source);
    if (endpointScope && endpointScope !== scope) {
      this.findings.error('E_CROSS_SCOPE', `${this.findings.describe(flow)} is declared in ${ElementText.shownId(scope)} but connects nodes of ${ElementText.shownId(endpointScope)}`, ElementText.shownId(flow), { related: [ElementText.shownId(source), ElementText.shownId(target)], hint: `Remove the flow with \`bpmn remove <file> ${ElementText.shownId(flow)}\` and re-create it with \`bpmn connect <file> ${ElementText.shownId(source)} ${ElementText.shownId(target)}\`.` });
    }
  }

  checkFlowLinks(node: BpmnElement): void {
    for (const flow of node.list('incoming')) {
      if (flow.is('bpmn:SequenceFlow') && flow.peek<BpmnElement>('targetRef') !== node) {
        this.findings.error('E_FLOW_LINKS', `${this.findings.describe(node)} lists ${ElementText.shownId(flow)} as incoming, but the flow targets ${ElementText.shownId(flow.peek<BpmnElement>('targetRef'))}`, ElementText.shownId(node), { related: [ElementText.shownId(flow)], hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:incoming>${ElementText.shownId(flow)}</bpmn:incoming> entry from ${ElementText.shownId(node)} in the XML (missing entries are added automatically).` });
      }
    }
    for (const flow of node.list('outgoing')) {
      if (flow.is('bpmn:SequenceFlow') && flow.peek<BpmnElement>('sourceRef') !== node) {
        this.findings.error('E_FLOW_LINKS', `${this.findings.describe(node)} lists ${ElementText.shownId(flow)} as outgoing, but the flow starts at ${ElementText.shownId(flow.peek<BpmnElement>('sourceRef'))}`, ElementText.shownId(node), { related: [ElementText.shownId(flow)], hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:outgoing>${ElementText.shownId(flow)}</bpmn:outgoing> entry from ${ElementText.shownId(node)} in the XML (missing entries are added automatically).` });
      }
    }
  }

  checkDefaultFlow(node: BpmnElement): void {
    const def = node.peek<BpmnElement>('default');
    if (!def || node.list('outgoing').includes(def)) {
      return;
    }
    this.findings.error('E_INVALID_DEFAULT', `Default flow ${ElementText.shownId(def)} of ${this.findings.describe(node)} is not one of its outgoing flows`, ElementText.shownId(node), { related: [ElementText.shownId(def)], hint: `Mark one of the outgoing flows instead: \`bpmn set <file> <flowId> default=true\`.` });
  }

  checkMessageFlows(): void {
    for (const mf of this.document.flows.messageFlows()) {
      const source = mf.peek<BpmnElement>('sourceRef');
      const target = mf.peek<BpmnElement>('targetRef');
      if (!source || !target) {
        continue;
      }
      let bad = false;
      for (const end of [source, target]) {
        if (!end.is('bpmn:InteractionNode')) {
          bad = true;
          this.findings.error('E_INVALID_MESSAGE_FLOW', `Message flow ${ElementText.shownId(mf)} ends at ${this.findings.describe(end)}, which cannot send or receive messages`, ElementText.shownId(mf), { related: [ElementText.shownId(end)], hint: 'Message flows connect participants, tasks, events, sub-processes and call activities (not gateways or data).' });
        }
      }
      if (bad) {
        continue;
      }
      const sPool = this.poolOf(source);
      const tPool = this.poolOf(target);
      if (sPool && tPool && sPool === tPool) {
        this.findings.error('E_MESSAGE_FLOW_SAME_POOL', `Message flow ${ElementText.shownId(mf)} connects ${ElementText.shownId(source)} and ${ElementText.shownId(target)} inside the same pool ${ElementText.shownId(sPool)}`, ElementText.shownId(mf), { related: [ElementText.shownId(source), ElementText.shownId(target)], hint: `Inside a pool use a sequence flow: \`bpmn remove <file> ${ElementText.shownId(mf)}\` then \`bpmn connect <file> ${ElementText.shownId(source)} ${ElementText.shownId(target)}\`.` });
      }
    }
  }

  private leavesTheReportToAnotherIncoming(flow: BpmnElement, source: BpmnElement, target: BpmnElement): boolean {
    if (!source.is('bpmn:EventBasedGateway')) {
      return false;
    }
    return this.document.flows.incoming(target).some((other) => other !== flow && !other.get<BpmnElement>('sourceRef').is('bpmn:EventBasedGateway'));
  }

  private poolOf(el: BpmnElement): BpmnElement | undefined {
    if (el.is('bpmn:Participant')) {
      return el;
    }
    const process = this.document.scopes.processOf(el);
    return process ? this.document.flows.participantOf(process) : undefined;
  }
}
