import type { Doc } from '../document/Doc.js';
import { isEventSubProcess, isLinkCatch, isLinkThrow } from '../document/utils/kinds.js';
import { is, type El, peek } from '../document/utils/moddle.js';
import { linkNameOf } from './utils/flow-nodes.js';

/**
 * Flow order of one scope for the view and the lint: depth-first from its start events,
 * following link throw -> catch pairs. Event sub-processes, compensation handlers and the
 * nodes of an ad-hoc sub-process (all entry points) are never unreachable.
 */
export class FlowOrder {
  /** attached boundary events are left out: they hang off their host */
  readonly ordered: El[] = [];
  readonly unreachable = new Set<El>();
  private readonly members: Set<El>;
  private readonly linkCatches: Map<string, El[]>;
  private readonly seen = new Set<El>();

  constructor(
    private readonly doc: Doc,
    scope: El,
  ) {
    const nodes = doc.flowNodes(scope).filter((node) => !is(node, 'bpmn:BoundaryEvent') || this.isOrphanBoundary(node, scope));
    this.members = new Set(nodes);
    this.linkCatches = FlowOrder.linkCatchesOf(nodes);
    const starts = nodes.filter((node) => is(node, 'bpmn:StartEvent'));
    const entries = starts.length ? starts : nodes.filter((node) => doc.incoming(node).length === 0);
    for (const entry of entries) this.visit(entry);
    const reachable = new Set(this.seen);
    for (const node of nodes) if (doc.incoming(node).length === 0) this.visit(node);
    for (const node of nodes) this.visit(node);
    if (is(scope, 'bpmn:AdHocSubProcess')) return;
    for (const node of nodes) {
      if (reachable.has(node)) continue;
      if (isEventSubProcess(node) || peek<boolean>(node, 'isForCompensation') === true || is(node, 'bpmn:BoundaryEvent')) continue;
      this.unreachable.add(node);
    }
  }

  private visit(node: El): void {
    if (this.seen.has(node) || !this.members.has(node)) return;
    this.seen.add(node);
    this.ordered.push(node);
    for (const next of this.successors(node)) this.visit(next);
  }

  /** treated like a plain node */
  private isOrphanBoundary(el: El, scope: El): boolean {
    const host = peek<El>(el, 'attachedToRef');
    return !host || !this.doc.flowElements(scope).includes(host);
  }

  private static linkCatchesOf(nodes: El[]): Map<string, El[]> {
    const out = new Map<string, El[]>();
    for (const node of nodes) {
      const name = isLinkCatch(node) ? linkNameOf(node) : undefined;
      if (name) out.set(name, [...(out.get(name) ?? []), node]);
    }
    return out;
  }

  /** A throwing link event continues at the catching link events of the same name. */
  private successors(node: El): El[] {
    const out: El[] = [];
    for (const flow of this.doc.outgoing(node)) {
      const target = peek<El>(flow, 'targetRef');
      if (target) out.push(target);
    }
    if (is(node, 'bpmn:Activity')) {
      for (const boundary of this.doc.boundaryEventsOf(node)) {
        for (const flow of this.doc.outgoing(boundary)) {
          const target = peek<El>(flow, 'targetRef');
          if (target) out.push(target);
        }
      }
    }
    if (isLinkThrow(node)) {
      const name = linkNameOf(node);
      if (name) out.push(...(this.linkCatches.get(name) ?? []));
    }
    return out;
  }
}
