import type { Doc } from '../../document/Doc.js';
import { isEventSubProcess, isLinkCatch, kindLabel, triggerOf } from '../../document/utils/kinds.js';
import { is, walk, type El, peek, shownId } from '../../document/utils/moddle.js';
import type { FlowOrder } from '../FlowOrder.js';
import { linkNameOf } from '../utils/flow-nodes.js';
import { GatewayLint } from './GatewayLint.js';
import type { StructureFindings } from './StructureFindings.js';

/** Start and end events, reachability, dead ends, implicit splits / joins and duplicate names. */
export class ScopeLint {
  private readonly gatewayLint: GatewayLint;

  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {
    this.gatewayLint = new GatewayLint(doc, findings);
  }

  lintScope(scope: El, order: FlowOrder): void {
    const nodes = this.doc.flowNodes(scope);
    // an ad-hoc sub-process needs neither start/end events nor flows: its nodes run on their own
    const adHoc = is(scope, 'bpmn:AdHocSubProcess');
    if ((is(scope, 'bpmn:Process') || nodes.length) && !adHoc) this.lintStartAndEnd(scope, nodes);
    this.lintUnreachable(order);
    for (const node of nodes) this.lintNode(node, adHoc);
  }

  private lintStartAndEnd(scope: El, nodes: El[]): void {
    const isProcess = is(scope, 'bpmn:Process');
    if (!isEventSubProcess(scope) && !nodes.some((node) => is(node, 'bpmn:StartEvent'))) {
      this.findings.warning('W_NO_START', `${isProcess ? 'Process' : 'Sub-process'} ${shownId(scope)} has no start event`, shownId(scope), {
        hint: `Add one: \`bpmn add <file> startEvent "<Name>" --in ${shownId(scope)}\` (or --before <firstNodeId>).`,
      });
    }
    if (!nodes.some((node) => is(node, 'bpmn:EndEvent'))) {
      this.findings.warning('W_NO_END', `${isProcess ? 'Process' : 'Sub-process'} ${shownId(scope)} has no end event`, shownId(scope), {
        hint: `Add one after the last node: \`bpmn add <file> endEvent "<Name>" --after <nodeId>\`.`,
      });
    }
  }

  private lintUnreachable(order: FlowOrder): void {
    for (const node of order.unreachable) {
      const link = isLinkCatch(node) ? linkNameOf(node) : undefined;
      this.findings.warning('W_UNREACHABLE', `${this.findings.describe(node)} is not reachable from any start event${link ? ` (no throwing link event "${link}" pairs with it)` : ''}`, shownId(node), {
        hint: link
          ? `Link events pair by link name: add the throwing side with \`bpmn add <file> intermediateThrowEvent:link "<Name>" --after <nodeId> --link ${link}\`, or remove it.`
          : `Connect it (\`bpmn connect <file> <fromId> ${shownId(node)}\` or \`bpmn move <file> ${shownId(node)} --after <nodeId>\`) or remove it.`,
      });
    }
  }

  private lintNode(node: El, adHoc: boolean): void {
    const { doc } = this;
    const outgoing = doc.outgoing(node);
    const incoming = doc.incoming(node);
    if (!outgoing.length && !adHoc && !this.isDeadEndExempt(node)) {
      this.findings.warning('W_DEAD_END', `${this.findings.describe(node)} has no outgoing flow`, shownId(node), {
        hint: `Continue the flow (\`bpmn add <file> <kind> "<Name>" --after ${shownId(node)}\`) or end it (\`bpmn add <file> endEvent "<Name>" --after ${shownId(node)}\`).`,
      });
    }
    this.gatewayLint.lint(node, outgoing);
    this.lintImplicitSplitAndJoin(node, outgoing, incoming);
    if (is(node, 'bpmn:SubProcess') && !doc.flowNodes(node).length) {
      this.findings.warning('W_EMPTY_SUBPROCESS', `${this.findings.describe(node)} contains no nodes`, shownId(node), {
        hint: `Add content: \`bpmn add <file> startEvent "<Name>" --in ${shownId(node)}\` ... or remove it.`,
      });
    }
  }

  private lintImplicitSplitAndJoin(node: El, outgoing: El[], incoming: El[]): void {
    if (is(node, 'bpmn:Gateway')) return;
    if (outgoing.length >= 2) {
      this.findings.warning('W_IMPLICIT_SPLIT', `${this.findings.describe(node)} has ${outgoing.length} outgoing flows (implicit split)`, shownId(node), {
        related: outgoing.map(shownId),
        hint: `Split through a gateway instead: \`bpmn add <file> parallelGateway --flow ${shownId(outgoing[0])}\` (or exclusiveGateway "<Question?>" for alternatives), then \`bpmn set <file> ${shownId(outgoing[1])} source=<gatewayId>\` for each other outgoing flow (new branches: a {"op":"split"} op in \`bpmn apply <file> ops.json\`).`,
      });
    }
    if (incoming.length >= 2) {
      this.findings.warning('W_IMPLICIT_JOIN', `${this.findings.describe(node)} has ${incoming.length} incoming flows (implicit join)`, shownId(node), {
        related: incoming.map(shownId),
        hint: `Join through a gateway instead: \`bpmn add <file> exclusiveGateway --flow ${shownId(incoming[0])}\` (parallelGateway to synchronise), then \`bpmn set <file> ${shownId(incoming[1])} target=<gatewayId>\` for each other incoming flow.`,
      });
    }
  }

  checkDuplicateNames(): void {
    const groups = new Map<string, El[]>();
    for (const el of walk(this.doc.definitions)) {
      if (!is(el, 'bpmn:FlowNode') && !is(el, 'bpmn:Participant') && !is(el, 'bpmn:Lane')) continue;
      const name = this.findings.nameOf(el)?.trim();
      if (!name) continue;
      const key = `${kindLabel(el)}\u0000${name}`;
      groups.set(key, [...(groups.get(key) ?? []), el]);
    }
    for (const els of groups.values()) {
      if (els.length < 2) continue;
      const [first, ...rest] = els;
      this.findings.warning('W_DUPLICATE_NAME', `${els.length} ${kindLabel(first!)} elements are named "${this.findings.nameOf(first!)}" (${els.map(shownId).join(', ')})`, shownId(first), {
        related: rest.map(shownId),
        hint: 'Distinct names keep the model unambiguous; rename with `bpmn set <file> <id> name="<New name>"`.',
      });
    }
  }

  private isDeadEndExempt(node: El): boolean {
    if (is(node, 'bpmn:EndEvent') || isEventSubProcess(node)) return true;
    if (peek<boolean>(node, 'isForCompensation') === true) return true;
    const trigger = triggerOf(node);
    if (is(node, 'bpmn:IntermediateThrowEvent') && trigger === 'link') return true;
    if (is(node, 'bpmn:BoundaryEvent') && trigger === 'compensate') return true;
    return false;
  }
}
