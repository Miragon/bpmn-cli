import { type BpmnDocument, type BpmnElement, ElementText, Kinds, Triggers } from '../../model/index.js';
import { FlowOrder } from './FlowOrder.js';
import { GatewayChecks } from './GatewayChecks.js';
import type { StructureFindings } from './StructureFindings.js';

export class ScopeChecks {
  private readonly gatewayChecks: GatewayChecks;

  constructor(
    private readonly document: BpmnDocument,
    private readonly findings: StructureFindings,
  ) {
    this.gatewayChecks = new GatewayChecks(document, findings);
  }

  checkScope(scope: BpmnElement, order: FlowOrder): void {
    const nodes = this.document.scopes.flowNodes(scope);
    const adHoc = scope.is('bpmn:AdHocSubProcess');
    if ((scope.is('bpmn:Process') || nodes.length) && !adHoc) {
      this.checkStartAndEnd(scope, nodes);
    }
    this.checkUnreachable(order);
    for (const node of nodes) {
      this.checkNode(node, adHoc);
    }
  }

  private checkStartAndEnd(scope: BpmnElement, nodes: BpmnElement[]): void {
    const isProcess = scope.is('bpmn:Process');
    if (!Kinds.isEventSubProcess(scope) && !nodes.some((node) => node.is('bpmn:StartEvent'))) {
      this.findings.warning('W_NO_START', `${isProcess ? 'Process' : 'Sub-process'} ${ElementText.shownId(scope)} has no start event`, ElementText.shownId(scope), { hint: `Add one: \`bpmn add <file> startEvent "<Name>" --in ${ElementText.shownId(scope)}\` (or --before <firstNodeId>).` });
    }
    if (!nodes.some((node) => node.is('bpmn:EndEvent'))) {
      this.findings.warning('W_NO_END', `${isProcess ? 'Process' : 'Sub-process'} ${ElementText.shownId(scope)} has no end event`, ElementText.shownId(scope), { hint: `Add one after the last node: \`bpmn add <file> endEvent "<Name>" --after <nodeId>\`.` });
    }
  }

  private checkUnreachable(order: FlowOrder): void {
    for (const node of order.unreachable) {
      const link = Triggers.isLinkCatch(node) ? FlowOrder.linkNameOf(node) : undefined;
      this.findings.warning('W_UNREACHABLE', `${this.findings.describe(node)} is not reachable from any start event${link ? ` (no throwing link event "${link}" pairs with it)` : ''}`, ElementText.shownId(node), {
        hint: link
          ? `Link events pair by link name: add the throwing side with \`bpmn add <file> intermediateThrowEvent:link "<Name>" --after <nodeId> link=${link}\`, or remove it.`
          : `Connect it (\`bpmn connect <file> <fromId> ${ElementText.shownId(node)}\` or \`bpmn move <file> ${ElementText.shownId(node)} --after <nodeId>\`) or remove it.`,
      });
    }
  }

  private checkNode(node: BpmnElement, adHoc: boolean): void {
    const outgoing = this.document.flows.outgoing(node);
    const incoming = this.document.flows.incoming(node);
    if (!outgoing.length && !adHoc && !ScopeChecks.isDeadEndExempt(node)) {
      this.findings.warning('W_DEAD_END', `${this.findings.describe(node)} has no outgoing flow`, ElementText.shownId(node), { hint: `Continue the flow (\`bpmn add <file> <kind> "<Name>" --after ${ElementText.shownId(node)}\`) or end it (\`bpmn add <file> endEvent "<Name>" --after ${ElementText.shownId(node)}\`).` });
    }
    this.gatewayChecks.lint(node, outgoing);
    this.checkImplicitSplitAndJoin(node, outgoing, incoming);
    if (node.is('bpmn:SubProcess') && !this.document.scopes.flowNodes(node).length) {
      this.findings.warning('W_EMPTY_SUBPROCESS', `${this.findings.describe(node)} contains no nodes`, ElementText.shownId(node), { hint: `Add content: \`bpmn add <file> startEvent "<Name>" --in ${ElementText.shownId(node)}\` ... or remove it.` });
    }
  }

  private checkImplicitSplitAndJoin(node: BpmnElement, outgoing: BpmnElement[], incoming: BpmnElement[]): void {
    if (node.is('bpmn:Gateway')) {
      return;
    }
    if (outgoing.length >= 2) {
      this.findings.warning('W_IMPLICIT_SPLIT', `${this.findings.describe(node)} has ${outgoing.length} outgoing flows (implicit split)`, ElementText.shownId(node), { related: outgoing.map((element) => ElementText.shownId(element)), hint: `Split through a gateway instead: \`bpmn add <file> parallelGateway --flow ${ElementText.shownId(outgoing[0])}\` (or exclusiveGateway "<Question?>" for alternatives), then \`bpmn set <file> ${ElementText.shownId(outgoing[1])} source=<gatewayId>\` for each other outgoing flow (new branches: a {"op":"split"} op in \`bpmn apply <file> ops.json\`).` });
    }
    if (incoming.length >= 2) {
      this.findings.warning('W_IMPLICIT_JOIN', `${this.findings.describe(node)} has ${incoming.length} incoming flows (implicit join)`, ElementText.shownId(node), { related: incoming.map((element) => ElementText.shownId(element)), hint: `Join through a gateway instead: \`bpmn add <file> exclusiveGateway --flow ${ElementText.shownId(incoming[0])}\` (parallelGateway to synchronise), then \`bpmn set <file> ${ElementText.shownId(incoming[1])} target=<gatewayId>\` for each other incoming flow.` });
    }
  }

  checkDuplicateNames(): void {
    const groups = new Map<string, BpmnElement[]>();
    for (const el of this.document.tree.walk(this.document.tree.definitions)) {
      if (!el.is('bpmn:FlowNode') && !el.is('bpmn:Participant') && !el.is('bpmn:Lane')) {
        continue;
      }
      const name = this.findings.nameOf(el)?.trim();
      if (!name) {
        continue;
      }
      const key = `${Kinds.label(el)}\u0000${name}`;
      groups.set(key, [...(groups.get(key) ?? []), el]);
    }
    for (const els of groups.values()) {
      if (els.length < 2) {
        continue;
      }
      const [first, ...rest] = els;
      this.findings.warning('W_DUPLICATE_NAME', `${els.length} ${Kinds.label(first!)} elements are named "${this.findings.nameOf(first!)}" (${els.map((element) => ElementText.shownId(element)).join(', ')})`, ElementText.shownId(first), { related: rest.map((element) => ElementText.shownId(element)), hint: 'Distinct names keep the model unambiguous; rename with `bpmn set <file> <id> name="<New name>"`.' });
    }
  }

  private static isDeadEndExempt(node: BpmnElement): boolean {
    const trigger = Triggers.of(node);
    const pairedThrow = node.is('bpmn:IntermediateThrowEvent') && trigger === 'link';
    const compensating = node.is('bpmn:BoundaryEvent') && trigger === 'compensate';
    return node.is('bpmn:EndEvent') || Kinds.isEventSubProcess(node) || node.peek<boolean>('isForCompensation') === true || pairedThrow || compensating;
  }
}
