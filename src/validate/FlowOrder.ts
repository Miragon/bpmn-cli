import type { Doc } from '../model/Doc.js';
import { isEventSubProcess, isLinkCatch, isLinkThrow } from '../model/utils/kinds.js';
import { is, type El, peek } from '../model/utils/moddle.js';
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
    const nodes = doc.flowNodes(scope).filter((n) => !is(n, 'bpmn:BoundaryEvent') || this.isOrphanBoundary(n, scope));
    this.members = new Set(nodes);
    this.linkCatches = FlowOrder.linkCatchesOf(nodes);
    const starts = nodes.filter((n) => is(n, 'bpmn:StartEvent'));
    const entries = starts.length ? starts : nodes.filter((n) => doc.incoming(n).length === 0);
    for (const e of entries) this.visit(e);
    const reachable = new Set(this.seen);
    for (const n of nodes) if (doc.incoming(n).length === 0) this.visit(n);
    for (const n of nodes) this.visit(n);
    if (is(scope, 'bpmn:AdHocSubProcess')) return;
    for (const n of nodes) {
      if (reachable.has(n)) continue;
      if (isEventSubProcess(n) || peek<boolean>(n, 'isForCompensation') === true || is(n, 'bpmn:BoundaryEvent')) continue;
      this.unreachable.add(n);
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
    for (const n of nodes) {
      const name = isLinkCatch(n) ? linkNameOf(n) : undefined;
      if (name) out.set(name, [...(out.get(name) ?? []), n]);
    }
    return out;
  }

  /** A throwing link event continues at the catching link events of the same name. */
  private successors(node: El): El[] {
    const out: El[] = [];
    for (const f of this.doc.outgoing(node)) {
      const t = peek<El>(f, 'targetRef');
      if (t) out.push(t);
    }
    if (is(node, 'bpmn:Activity')) {
      for (const b of this.doc.boundaryEventsOf(node)) {
        for (const f of this.doc.outgoing(b)) {
          const t = peek<El>(f, 'targetRef');
          if (t) out.push(t);
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
