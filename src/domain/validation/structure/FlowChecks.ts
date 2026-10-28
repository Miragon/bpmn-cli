import type { Doc } from '../../document/Doc.js';
import { isBpmnError } from '../../document/utils/errors.js';
import { triggerOf } from '../../document/Kinds.js';
import { is, type El, peek, list, shownId } from '../../document/utils/moddle.js';
import { FlowRules } from '../../document/FlowRules.js';
import type { StructureFindings } from './StructureFindings.js';

/**
 * Sequence flows (ends, mirror lists, default flow) and message flows.
 * A flow with a missing end is skipped here, as checkReferences reports it.
 */
export class FlowChecks {
  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {}

  checkSequenceFlow(flow: El, scope: El): void {
    const source = peek<El>(flow, 'sourceRef');
    const target = peek<El>(flow, 'targetRef');
    if (!source || !target) return;
    try {
      new FlowRules(this.doc).assertEndpoints(source, target);
    } catch (err) {
      if (!isBpmnError(err)) throw err;
      this.findings.error(err.code, err.message, shownId(flow), { related: [shownId(source), shownId(target)], hint: err.details.hint });
      return;
    }
    if (is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate') {
      this.findings.error('E_INVALID_SOURCE', `Compensate boundary event ${shownId(source)} cannot have outgoing sequence flows (${shownId(flow)} -> ${shownId(target)})`, shownId(flow), {
        related: [shownId(source), shownId(target)],
        hint: `The compensation handler is linked by an association, not a sequence flow: \`bpmn remove <file> ${shownId(flow)}\`, then \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
      });
    }
    const ends: Array<[El, string, string]> = [
      [source, 'E_INVALID_SOURCE', 'source'],
      [target, 'E_INVALID_TARGET', 'target'],
    ];
    for (const [end, code, role] of ends) {
      if (peek<boolean>(end, 'isForCompensation') !== true) continue;
      this.findings.error(code, `Compensation handler ${this.findings.describe(end)} cannot be the ${role} of a sequence flow (${shownId(flow)})`, shownId(flow), {
        related: [shownId(source), shownId(target)],
        hint: `A compensation handler hangs off a compensate boundary event by association only: \`bpmn remove <file> ${shownId(flow)}\`, or make it a normal activity with \`bpmn set <file> ${shownId(end)} isForCompensation=false\`.`,
      });
    }
    const endpointScope = this.doc.scopeOf(source);
    if (endpointScope && endpointScope !== scope) {
      this.findings.error('E_CROSS_SCOPE', `${this.findings.describe(flow)} is declared in ${shownId(scope)} but connects nodes of ${shownId(endpointScope)}`, shownId(flow), {
        related: [shownId(source), shownId(target)],
        hint: `Remove the flow with \`bpmn remove <file> ${shownId(flow)}\` and re-create it with \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
      });
    }
  }

  checkFlowLinks(node: El): void {
    for (const flow of this.incomingOf(node)) {
      if (is(flow, 'bpmn:SequenceFlow') && peek<El>(flow, 'targetRef') !== node) {
        this.findings.error('E_FLOW_LINKS', `${this.findings.describe(node)} lists ${shownId(flow)} as incoming, but the flow targets ${shownId(peek<El>(flow, 'targetRef'))}`, shownId(node), {
          related: [shownId(flow)],
          hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:incoming>${shownId(flow)}</bpmn:incoming> entry from ${shownId(node)} in the XML (missing entries are added automatically).`,
        });
      }
    }
    for (const flow of this.outgoingOf(node)) {
      if (is(flow, 'bpmn:SequenceFlow') && peek<El>(flow, 'sourceRef') !== node) {
        this.findings.error('E_FLOW_LINKS', `${this.findings.describe(node)} lists ${shownId(flow)} as outgoing, but the flow starts at ${shownId(peek<El>(flow, 'sourceRef'))}`, shownId(node), {
          related: [shownId(flow)],
          hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:outgoing>${shownId(flow)}</bpmn:outgoing> entry from ${shownId(node)} in the XML (missing entries are added automatically).`,
        });
      }
    }
  }

  /** Checks that a default flow leaves its node; only exclusive/inclusive/complex gateways and activities have a `default` property. */
  checkDefaultFlow(node: El): void {
    const def = peek<El>(node, 'default');
    if (!def || this.outgoingOf(node).includes(def)) return;
    this.findings.error('E_INVALID_DEFAULT', `Default flow ${shownId(def)} of ${this.findings.describe(node)} is not one of its outgoing flows`, shownId(node), {
      related: [shownId(def)],
      hint: `Mark one of the outgoing flows instead: \`bpmn set <file> <flowId> default=true\`.`,
    });
  }

  checkMessageFlows(): void {
    const { doc } = this;
    for (const mf of doc.messageFlows()) {
      const source = peek<El>(mf, 'sourceRef');
      const target = peek<El>(mf, 'targetRef');
      if (!source || !target) continue;
      let bad = false;
      for (const end of [source, target]) {
        if (!is(end, 'bpmn:InteractionNode')) {
          bad = true;
          this.findings.error('E_INVALID_MESSAGE_FLOW', `Message flow ${shownId(mf)} ends at ${this.findings.describe(end)}, which cannot send or receive messages`, shownId(mf), {
            related: [shownId(end)],
            hint: 'Message flows connect participants, tasks, events, sub-processes and call activities (not gateways or data).',
          });
        }
      }
      if (bad) continue;
      const sPool = this.poolOf(source);
      const tPool = this.poolOf(target);
      if (sPool && tPool && sPool === tPool) {
        this.findings.error('E_MESSAGE_FLOW_SAME_POOL', `Message flow ${shownId(mf)} connects ${shownId(source)} and ${shownId(target)} inside the same pool ${shownId(sPool)}`, shownId(mf), {
          related: [shownId(source), shownId(target)],
          hint: `Inside a pool use a sequence flow: \`bpmn remove <file> ${shownId(mf)}\` then \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
        });
      }
    }
  }

  private outgoingOf(node: El): El[] {
    return list(node, 'outgoing');
  }

  private incomingOf(node: El): El[] {
    return list(node, 'incoming');
  }

  private poolOf(el: El): El | undefined {
    if (is(el, 'bpmn:Participant')) return el;
    const process = this.doc.processOf(el);
    return process ? this.doc.participantOf(process) : undefined;
  }
}
