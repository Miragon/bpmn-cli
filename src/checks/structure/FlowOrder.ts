import { type BpmnDocument, type BpmnElement, Kinds, Triggers } from '../../model/index.js';

export class FlowOrder {
  readonly ordered: BpmnElement[] = [];
  readonly unreachable = new Set<BpmnElement>();
  private readonly members: Set<BpmnElement>;
  private readonly linkCatches: Map<string, BpmnElement[]>;
  private readonly seen = new Set<BpmnElement>();

  constructor(
    private readonly document: BpmnDocument,
    scope: BpmnElement,
  ) {
    const nodes = this.document.scopes.flowNodes(scope).filter((node) => !node.is('bpmn:BoundaryEvent') || this.isOrphanBoundary(node, scope));
    this.members = new Set(nodes);
    this.linkCatches = FlowOrder.linkCatchesOf(nodes);
    const starts = nodes.filter((node) => node.is('bpmn:StartEvent'));
    const entries = starts.length ? starts : nodes.filter((node) => this.document.flows.incoming(node).length === 0);
    for (const entry of entries) {
      this.visit(entry);
    }
    const reachable = new Set(this.seen);
    for (const node of nodes) {
      if (this.document.flows.incoming(node).length === 0) {
        this.visit(node);
      }
    }
    for (const node of nodes) {
      this.visit(node);
    }
    if (scope.is('bpmn:AdHocSubProcess')) {
      return;
    }
    for (const node of nodes) {
      if (reachable.has(node)) {
        continue;
      }
      if (Kinds.isEventSubProcess(node) || node.peek<boolean>('isForCompensation') === true || node.is('bpmn:BoundaryEvent')) {
        continue;
      }
      this.unreachable.add(node);
    }
  }

  static linkNameOf(element: BpmnElement): string | undefined {
    const definition = element.list('eventDefinitions').find((candidate) => candidate.is('bpmn:LinkEventDefinition'));
    const name = definition?.peek<unknown>('name');
    return typeof name === 'string' && name ? name : undefined;
  }

  private visit(node: BpmnElement): void {
    if (this.seen.has(node) || !this.members.has(node)) {
      return;
    }
    this.seen.add(node);
    this.ordered.push(node);
    for (const next of this.successors(node)) {
      this.visit(next);
    }
  }

  private isOrphanBoundary(el: BpmnElement, scope: BpmnElement): boolean {
    const host = el.peek<BpmnElement>('attachedToRef');
    return !host || !this.document.scopes.flowElements(scope).includes(host);
  }

  private static linkCatchesOf(nodes: BpmnElement[]): Map<string, BpmnElement[]> {
    const out = new Map<string, BpmnElement[]>();
    for (const node of nodes) {
      const name = Triggers.isLinkCatch(node) ? FlowOrder.linkNameOf(node) : undefined;
      if (name) {
        out.set(name, [...(out.get(name) ?? []), node]);
      }
    }
    return out;
  }

  private successors(node: BpmnElement): BpmnElement[] {
    const out: BpmnElement[] = [];
    for (const flow of this.document.flows.outgoing(node)) {
      const target = flow.peek<BpmnElement>('targetRef');
      if (target) {
        out.push(target);
      }
    }
    if (node.is('bpmn:Activity')) {
      for (const boundary of this.document.scopes.boundaryEventsOf(node)) {
        for (const flow of this.document.flows.outgoing(boundary)) {
          const target = flow.peek<BpmnElement>('targetRef');
          if (target) {
            out.push(target);
          }
        }
      }
    }
    if (Triggers.isLinkThrow(node)) {
      const name = FlowOrder.linkNameOf(node);
      if (name) {
        out.push(...(this.linkCatches.get(name) ?? []));
      }
    }
    return out;
  }
}
