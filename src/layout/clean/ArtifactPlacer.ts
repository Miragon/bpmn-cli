import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { METRICS, SIZES, boxesOverlap, type Box, type GArtifact, type GEdge, type GNode, type LinkEnd, type Point, type ScopeLayout } from '../../diagram/types.js';
import { EdgeRouter } from './EdgeRouter.js';
import { annotationSize } from './place.js';
import { ScopeLabels } from './ScopeLabels.js';
import { routedSegments, shiftScope } from './utils/scope.js';

export class ArtifactPlacer {
  constructor(private readonly layout: ScopeLayout) {}

  /** Builds the artifacts of a scope and their links (no positions yet). */
  build(scope: El, byId: Map<string, GNode>): void {
    const { layout } = this;
    const artifacts: GArtifact[] = [];
    const byArtifactId = new Map<string, GArtifact>();
    const add = (el: El, kind: GArtifact['kind'], size: { width: number; height: number }): GArtifact => {
      const a: GArtifact = { el, id: idOf(el), kind, ...size, box: { x: 0, y: 0, ...size }, links: [] };
      artifacts.push(a);
      byArtifactId.set(a.id, a);
      return a;
    };
    for (const el of many(scope, 'flowElements')) {
      if (is(el, 'bpmn:DataObjectReference')) add(el, 'dataObject', { ...SIZES.dataObject });
      else if (is(el, 'bpmn:DataStoreReference')) add(el, 'dataStore', { ...SIZES.dataStore });
    }
    for (const el of many(scope, 'artifacts')) {
      if (is(el, 'bpmn:TextAnnotation')) add(el, 'annotation', annotationSize(el.get<string | undefined>('text')));
    }
    const flowsById = new Map(layout.edges.map((e) => [e.id, e]));
    const flowEnds = new Map<GEdge, LinkEnd>();
    const resolve = (el: El | undefined): GNode | GArtifact | LinkEnd | undefined => {
      if (!el) return undefined;
      const id = idOf(el);
      const node = byId.get(id) ?? byArtifactId.get(id);
      if (node) return node;
      const flow = flowsById.get(id);
      if (!flow) return undefined;
      let end = flowEnds.get(flow);
      if (!end) {
        end = { box: { x: 0, y: 0, width: 0, height: 0 }, flow };
        flowEnds.set(flow, end);
      }
      return end;
    };
    const anchorTo = (art: GArtifact, end: GNode | GArtifact | LinkEnd): void => {
      if (art.anchor) return;
      art.anchor = end;
      if ('kind' in end && 'boundary' in end) art.anchorNode = end;
    };
    for (const el of many(scope, 'artifacts')) {
      if (!is(el, 'bpmn:Association')) continue;
      const source = el.get<El | undefined>('sourceRef');
      const target = el.get<El | undefined>('targetRef');
      const from = resolve(source);
      const to = resolve(target);
      const art = from && 'links' in from ? (from as GArtifact) : to && 'links' in to ? (to as GArtifact) : undefined;
      if (!from || !to || !art) {
        // an end in another scope (a nested sub-process): drawn by the engine once both shapes exist
        if (source && target && !layout.compensations.some((c) => c.el === el)) layout.crossLinks.push({ el, id: idOf(el), sourceId: idOf(source), targetId: idOf(target) });
        continue;
      }
      art.links.push({ el, id: idOf(el), from, to, points: [] });
      anchorTo(art, art === from ? to : from);
    }
    for (const node of [...byId.values()]) {
      for (const da of node.el.get<El[] | undefined>('dataInputAssociations') ?? []) {
        const src = (da.get<El[] | undefined>('sourceRef') ?? [])[0];
        const art = src ? byArtifactId.get(idOf(src)) : undefined;
        if (!art) {
          if (src) layout.crossLinks.push({ el: da, id: idOf(da), sourceId: idOf(src), targetId: node.id });
          continue;
        }
        art.links.push({ el: da, id: idOf(da), from: art, to: node, points: [] });
        anchorTo(art, node);
      }
      for (const da of node.el.get<El[] | undefined>('dataOutputAssociations') ?? []) {
        const tgt = da.get<El | undefined>('targetRef');
        const art = tgt ? byArtifactId.get(idOf(tgt)) : undefined;
        if (!art) {
          if (tgt) layout.crossLinks.push({ el: da, id: idOf(da), sourceId: node.id, targetId: idOf(tgt) });
          continue;
        }
        art.links.push({ el: da, id: idOf(da), from: node, to: art, points: [] });
        anchorTo(art, node);
      }
    }
    layout.artifacts = artifacts;
  }

  /**
   * Data objects / stores right below the node they belong to (a join's right
   * of the line its entries from below rise on), annotations of boundary
   * events at the lower left of the event. Runs before routing so the router
   * treats them as obstacles.
   */
  placeAttached(): void {
    const { layout } = this;
    const taken: Box[] = [];
    const free = (b: Box): boolean => !taken.some((t) => boxesOverlap(t, b, 10));
    for (const a of layout.artifacts) {
      const n = a.anchorNode;
      if (!n) continue;
      if (a.kind === 'annotation') {
        if (!n.host) continue;
        a.box = this.boundaryNoteBox(a, n, n.host, free, layout.nodes.flatMap((x) => [x.box, ...x.boundary.map((b) => b.box)]));
        taken.push(a.box);
        continue;
      }
      // a join's entries from below rise into its bottom vertex: its data hang right of their line
      const cx = EdgeRouter.entriesFromBelow(n).length ? n.box.x + n.box.width / 2 + 6 + a.width / 2 : this.belowX(n);
      let box: Box = { x: Math.round(cx - a.width / 2), y: n.box.y + n.box.height + (n.boundary.length ? 24 : 20), width: a.width, height: a.height };
      while (!free(box)) box = { ...box, x: box.x + a.width + 10 };
      a.box = box;
      taken.push(box);
    }
    // unanchored data: right of the content
    let x = layout.width + METRICS.hGap;
    for (const a of layout.artifacts) {
      if (a.kind === 'annotation' || a.anchorNode) continue;
      a.box = { x, y: 0, width: a.width, height: a.height };
      x += a.width + 20;
    }
    layout.width = Math.max(layout.width, ...layout.artifacts.filter((a) => a.kind !== 'annotation' || a.anchorNode?.host).map((a) => a.box.x + a.box.width));
    layout.height = Math.max(layout.height, ...layout.artifacts.filter((a) => a.kind !== 'annotation' || a.anchorNode?.host).map((a) => a.box.y + a.box.height));
  }

  /**
   * Text annotations above their anchor (node or flow point) when that spot is
   * free, else in a band above the whole content. Runs after routing.
   */
  placeAnnotations(): void {
    const { layout } = this;
    const notes = layout.artifacts.filter((a) => a.kind === 'annotation' && !(a.anchorNode?.host));
    if (!notes.length) return;
    const boxes: Box[] = [];
    for (const n of layout.nodes) {
      boxes.push(n.box);
      for (const b of n.boundary) {
        boxes.push(b.box);
        // the label of an event on its host's top border lies above the host, where a note would go
        const label = b.onTop ? ScopeLabels.of(b, 'boundary') : undefined;
        if (label) boxes.push(label);
      }
    }
    for (const es of layout.eventSubs) boxes.push(es.box);
    for (const a of layout.artifacts) if (a.kind !== 'annotation' || a.anchorNode?.host) boxes.push(a.box);
    for (const e of layout.edges) if (e.label) boxes.push(e.label);
    const segments = routedSegments(layout);
    const collides = (b: Box): boolean =>
      boxes.some((o) => boxesOverlap(o, b, 6)) ||
      segments.some(([p, q]) => Math.min(p.x, q.x) < b.x + b.width + 4 && Math.max(p.x, q.x) > b.x - 4 && Math.min(p.y, q.y) < b.y + b.height + 4 && Math.max(p.y, q.y) > b.y - 4);
    /** first free x near `cx`, alternating right and left */
    const settle = (a: GArtifact, cx: number, y: number, check: (b: Box) => boolean): Box | undefined => {
      for (let step = 0; step <= 8; step++) {
        for (const dir of step ? [1, -1] : [0]) {
          const x = Math.max(0, Math.round(cx - a.width / 2 + dir * step * (a.width / 2 + 20)));
          const box = { x, y, width: a.width, height: a.height };
          if (!check(box)) return box;
        }
      }
      return undefined;
    };
    const anchorX = (a: GArtifact): number => {
      const anchor = a.anchor?.box;
      return anchor ? anchor.x + anchor.width / 2 : layout.width + METRICS.hGap + a.width / 2;
    };
    const band: GArtifact[] = [];
    for (const a of notes) {
      const anchor = a.anchor?.box;
      if (!anchor) {
        band.push(a);
        continue;
      }
      const y = anchor.y - 16 - a.height;
      const box = y >= 0 ? settle(a, anchorX(a), y, collides) : undefined;
      if (box) {
        a.box = box;
        boxes.push(box);
      } else band.push(a);
    }
    if (band.length) {
      // a strip above the content: left to right in the order of their anchors, so
      // no two association lines cross
      const topBand = Math.max(...band.map((a) => a.height)) + METRICS.vGap;
      shiftScope(layout, 0, topBand);
      band.sort((p, q) => anchorX(p) - anchorX(q));
      let cursor = 0;
      for (const a of band) {
        const x = Math.max(cursor, Math.round(anchorX(a) - a.width / 2));
        a.box = { x, y: 0, width: a.width, height: a.height };
        cursor = x + a.width + 20;
      }
    }
    layout.width = Math.max(layout.width, ...layout.artifacts.map((a) => a.box.x + a.box.width));
    layout.height = Math.max(layout.height, ...layout.artifacts.map((a) => a.box.y + a.box.height));
  }

  /** Re-computes the anchor points of associations that dock on a flow (after routing). */
  refreshFlowAnchors(): void {
    for (const a of this.layout.artifacts) {
      for (const link of a.links) {
        for (const end of [link.from, link.to]) if (end.flow) end.box = this.flowPoint(end.flow);
      }
      if (a.anchor?.flow) a.anchor.box = this.flowPoint(a.anchor.flow);
    }
  }

  /** Middle of the longest segment of a routed flow (zero-size anchor box). */
  private flowPoint(flow: GEdge): Box {
    let best: [Point, Point] | undefined;
    for (let i = 0; i + 1 < flow.points.length; i++) {
      const a = flow.points[i]!, b = flow.points[i + 1]!;
      if (!best || Math.hypot(b.x - a.x, b.y - a.y) > Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y)) best = [a, b];
    }
    const p = best ? { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 } : { x: 0, y: 0 };
    return { x: p.x, y: p.y, width: 0, height: 0 };
  }

  /** x centre for an artifact hanging below a node: beside the drop line, away from boundary events. */
  private belowX(n: GNode): number {
    const cx = n.box.x + n.box.width / 2;
    if (!n.boundary.length) return cx + Math.min(30, n.box.width / 2 - 10);
    const collapsed = n.kind === 'subProcess' && !n.child;
    return collapsed ? cx + 30 : cx - 30;
  }

  /** A tall thin box: the line dropping from `x` downwards (an obstacle for notes). */
  private dropLine(x: number, y: number): Box {
    return { x: x - 2, y, width: 4, height: 100000 };
  }

  /** What a note on a boundary event must not cover: the host's other boundary events, their labels and the lines dropping from them and from the host. */
  private boundaryNoteBlockers(event: GNode, host: GNode): Box[] {
    const out: Box[] = [];
    for (const b of host.boundary) {
      if (b === event) continue;
      out.push(b.box);
      const label = ScopeLabels.of(b, 'boundary');
      if (label) out.push(label);
      // an event on the top border sends its flows up
      if (b.out.length && !b.onTop) out.push(this.dropLine(b.box.x + b.box.width / 2, b.box.y));
    }
    const hostY = host.box.y + host.box.height / 2;
    if (host.out.some((e) => !e.back && e.target.box.y + e.target.box.height / 2 > hostY + 1)) {
      for (const x of [host.box.x + 8, host.box.x + 20]) out.push(this.dropLine(x, host.box.y + host.box.height));
    }
    return out;
  }

  /**
   * Box of a note on a boundary event: at the lower left of the event, below
   * the host, further down while another note is there. When that spot covers
   * a sibling boundary event, its label, a line dropping from them or another
   * node, the note goes to the lower right of the event (below its label) or
   * left of everything it would cover, whichever is free first.
   */
  private boundaryNoteBox(a: GArtifact, event: GNode, host: GNode, free: (b: Box) => boolean, nodes: Box[]): Box {
    const blockers = this.boundaryNoteBlockers(event, host);
    const near = event.box.x - 8 - a.width;
    const y0 = host.box.y + host.box.height + 8;
    const fallback = (): Box => {
      let box: Box = { x: near, y: y0, width: a.width, height: a.height };
      while (!free(box)) box = { ...box, y: box.y + a.height + 8 };
      return box;
    };
    if (!blockers.length) return fallback();
    const others = nodes.filter((b) => b !== host.box && b !== event.box);
    const clear = (b: Box): boolean => free(b) && !blockers.some((o) => boxesOverlap(o, b, 4)) && !others.some((o) => boxesOverlap(o, b, 8));
    const label = ScopeLabels.of(event, 'boundary');
    const right = { x: event.box.x + event.box.width + 8, y: Math.max(y0, label ? label.y + label.height + 6 : y0) };
    const far = Math.min(near, Math.min(...blockers.map((o) => o.x)) - 8 - a.width);
    for (let k = 0; k < 6; k++) {
      const dy = k * (a.height + 8);
      // left of the content (x < 0) the note would leave its lane / pool: not a candidate
      for (const { x, y } of [{ x: near, y: y0 }, right, ...(far >= 0 ? [{ x: far, y: y0 }] : [])]) {
        const box = { x, y: y + dy, width: a.width, height: a.height };
        if (clear(box)) return box;
      }
    }
    return fallback();
  }
}
