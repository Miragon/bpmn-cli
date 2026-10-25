import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { SIZES } from '../../diagram/utils/sizes.js';
import type { GEdge, GNode, ScopeLayout } from '../../diagram/types.js';
import { outgoingOf } from './utils/nodes.js';

export class ScopeGraph {
  readonly layout: ScopeLayout;
  readonly byId = new Map<string, GNode>();

  constructor(scope: El, nest: (node: GNode) => void) {
    const flowElements = many(scope, 'flowElements');
    const { byId } = this;
    const nodes: GNode[] = [];
    const eventSubs: GNode[] = [];

    for (const el of flowElements) {
      if (!is(el, 'bpmn:FlowNode') || is(el, 'bpmn:BoundaryEvent')) continue;
      const kind = this.kindOfNode(el);
      const node: GNode = { el, id: idOf(el), ...this.sizeOfNode(el), kind, boundary: [], layer: 0, row: 0, band: 0, box: { x: 0, y: 0, width: 0, height: 0 }, out: [], in: [] };
      if (kind === 'subProcess' || kind === 'eventSubProcess') nest(node);
      byId.set(node.id, node);
      if (kind === 'eventSubProcess') eventSubs.push(node);
      else nodes.push(node);
    }
    for (const el of flowElements) {
      if (!is(el, 'bpmn:BoundaryEvent')) continue;
      const hostEl = el.get<El | undefined>('attachedToRef');
      const host = hostEl ? byId.get(idOf(hostEl)) : undefined;
      const node: GNode = { el, id: idOf(el), ...SIZES.event, kind: 'event', boundary: [], layer: 0, row: 0, band: 0, box: { x: 0, y: 0, width: 0, height: 0 }, out: [], in: [] };
      if (host) {
        node.host = host;
        host.boundary.push(node);
      } else {
        nodes.push(node); // dangling boundary event: treat as a normal node
      }
      byId.set(node.id, node);
    }
    const edges: GEdge[] = [];
    for (const el of flowElements) {
      if (!is(el, 'bpmn:SequenceFlow')) continue;
      const s = el.get<El | undefined>('sourceRef');
      const t = el.get<El | undefined>('targetRef');
      const source = s ? byId.get(idOf(s)) : undefined;
      const target = t ? byId.get(idOf(t)) : undefined;
      if (!source || !target) continue;
      const edge: GEdge = { el, id: idOf(el), source, target, back: false, points: [] };
      source.out.push(edge);
      target.in.push(edge);
      edges.push(edge);
    }

    const layout: ScopeLayout = { el: scope, nodes, edges, artifacts: [], eventSubs, compensations: [], width: 0, height: 0, lanes: [], crossLinks: [] };
    for (const el of many(scope, 'artifacts')) {
      if (!is(el, 'bpmn:Association')) continue;
      const src = el.get<El | undefined>('sourceRef');
      const tgt = el.get<El | undefined>('targetRef');
      const event = src ? byId.get(idOf(src)) : undefined;
      const handler = tgt ? byId.get(idOf(tgt)) : undefined;
      if (!event || !handler || !event.host || !is(event.el, 'bpmn:BoundaryEvent')) continue;
      if (handler.in.length || !is(handler.el, 'bpmn:Activity')) continue;
      event.compensationHandler = handler;
      handler.compensatedBy = event;
      layout.compensations.push({ el, id: idOf(el), event, handler, points: [] });
    }
    this.layout = layout;
    this.markBackEdges();
  }

  private sizeOfNode(el: El): { width: number; height: number } {
    if (is(el, 'bpmn:Event')) return { ...SIZES.event };
    if (is(el, 'bpmn:Gateway')) return { ...SIZES.gateway };
    return { ...SIZES.task };
  }

  private kindOfNode(el: El): GNode['kind'] {
    if (is(el, 'bpmn:StartEvent')) return 'start';
    if (is(el, 'bpmn:EndEvent')) return 'end';
    if (is(el, 'bpmn:Event')) return 'event';
    if (is(el, 'bpmn:Gateway')) return 'gateway';
    if (is(el, 'bpmn:SubProcess')) return el.get<boolean | undefined>('triggeredByEvent') ? 'eventSubProcess' : 'subProcess';
    return 'task';
  }

  /**
   * Cuts each cycle at the edge back to its shallowest node, so the loop is drawn from the late
   * node back to the early one. Ties: the deepest source, then the later declared edge.
   */
  private markBackEdges(): void {
    const { nodes, edges } = this.layout;
    const srcOf = (e: GEdge): GNode => e.source.host ?? e.source;
    const forwardOut = (n: GNode): GEdge[] => outgoingOf(n).filter((e) => !e.back);
    const starts = nodes.filter((n) => n.kind === 'start');
    const sources = nodes.filter((n) => n.kind !== 'start' && n.in.length === 0);
    const roots = [...starts, ...sources];
    const depths = (): Map<GNode, number> => {
      const depth = new Map<GNode, number>();
      const bfs = (root: GNode): void => {
        if (depth.has(root)) return;
        depth.set(root, 0);
        const queue = [root];
        while (queue.length) {
          const n = queue.shift()!;
          for (const e of forwardOut(n)) {
            if (depth.has(e.target)) continue;
            depth.set(e.target, depth.get(n)! + 1);
            queue.push(e.target);
          }
        }
      };
      for (const r of roots) bfs(r);
      for (const n of nodes) bfs(n); // nodes only reachable through cycles
      return depth;
    };
    const reaches = (from: GNode, to: GNode): boolean => {
      const seen = new Set<GNode>([from]);
      const stack = [from];
      while (stack.length) {
        const n = stack.pop()!;
        if (n === to) return true;
        for (const e of forwardOut(n)) if (!seen.has(e.target)) {
          seen.add(e.target);
          stack.push(e.target);
        }
      }
      return false;
    };
    const hasCycle = (): boolean => {
      const state = new Map<GNode, 1 | 2>();
      const visit = (n: GNode): boolean => {
        state.set(n, 1);
        for (const e of forwardOut(n)) {
          const s = state.get(e.target);
          if (s === 1 || (s === undefined && visit(e.target))) return true;
        }
        state.set(n, 2);
        return false;
      };
      return nodes.some((n) => !state.has(n) && visit(n));
    };
    for (let guard = 0; guard <= edges.length && hasCycle(); guard++) {
      const depth = depths();
      let best: { e: GEdge; index: number; tDepth: number; sDepth: number } | undefined;
      edges.forEach((e, index) => {
        if (e.back) return;
        const u = srcOf(e), v = e.target;
        const tDepth = depth.get(v) ?? 0, sDepth = depth.get(u) ?? 0;
        if (tDepth > sDepth || !reaches(v, u)) return;
        if (!best || tDepth < best.tDepth || (tDepth === best.tDepth && (sDepth > best.sDepth || (sDepth === best.sDepth && index > best.index)))) {
          best = { e, index, tDepth, sDepth };
        }
      });
      if (!best) break;
      best.e.back = true;
    }
  }
}
