import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { SIZES } from '../../drawing/utils/sizes.js';
import type { GEdge, GNode, ScopeLayout } from '../../drawing/types.js';
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
      const sourceEl = el.get<El | undefined>('sourceRef');
      const targetEl = el.get<El | undefined>('targetRef');
      const source = sourceEl ? byId.get(idOf(sourceEl)) : undefined;
      const target = targetEl ? byId.get(idOf(targetEl)) : undefined;
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
    const srcOf = (edge: GEdge): GNode => edge.source.host ?? edge.source;
    const forwardOut = (node: GNode): GEdge[] => outgoingOf(node).filter((edge) => !edge.back);
    const starts = nodes.filter((node) => node.kind === 'start');
    const sources = nodes.filter((node) => node.kind !== 'start' && node.in.length === 0);
    const roots = [...starts, ...sources];
    const depths = (): Map<GNode, number> => {
      const depth = new Map<GNode, number>();
      const bfs = (root: GNode): void => {
        if (depth.has(root)) return;
        depth.set(root, 0);
        const queue = [root];
        while (queue.length) {
          const node = queue.shift()!;
          for (const edge of forwardOut(node)) {
            if (depth.has(edge.target)) continue;
            depth.set(edge.target, depth.get(node)! + 1);
            queue.push(edge.target);
          }
        }
      };
      for (const root of roots) bfs(root);
      for (const node of nodes) bfs(node); // nodes only reachable through cycles
      return depth;
    };
    const reaches = (from: GNode, to: GNode): boolean => {
      const seen = new Set<GNode>([from]);
      const stack = [from];
      while (stack.length) {
        const node = stack.pop()!;
        if (node === to) return true;
        for (const edge of forwardOut(node)) if (!seen.has(edge.target)) {
          seen.add(edge.target);
          stack.push(edge.target);
        }
      }
      return false;
    };
    const hasCycle = (): boolean => {
      const state = new Map<GNode, 1 | 2>();
      const visit = (node: GNode): boolean => {
        state.set(node, 1);
        for (const edge of forwardOut(node)) {
          const targetState = state.get(edge.target);
          if (targetState === 1 || (targetState === undefined && visit(edge.target))) return true;
        }
        state.set(node, 2);
        return false;
      };
      return nodes.some((node) => !state.has(node) && visit(node));
    };
    for (let guard = 0; guard <= edges.length && hasCycle(); guard++) {
      const depth = depths();
      let best: { edge: GEdge; index: number; tDepth: number; sDepth: number } | undefined;
      edges.forEach((edge, index) => {
        if (edge.back) return;
        const sourceNode = srcOf(edge), targetNode = edge.target;
        const tDepth = depth.get(targetNode) ?? 0, sDepth = depth.get(sourceNode) ?? 0;
        if (tDepth > sDepth || !reaches(targetNode, sourceNode)) return;
        if (!best || tDepth < best.tDepth || (tDepth === best.tDepth && (sDepth > best.sDepth || (sDepth === best.sDepth && index > best.index)))) {
          best = { edge, index, tDepth, sDepth };
        }
      });
      if (!best) break;
      best.edge.back = true;
    }
  }
}
