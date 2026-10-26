import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { METRICS, SIZES, annotationSize } from '../../drawing/utils/sizes.js';
import { boxesOverlap } from '../../drawing/utils/geom.js';
import type { Box, GArtifact, GEdge, GNode, LinkEnd, Point, ScopeLayout } from '../../drawing/types.js';
import { ChannelRouter } from './ChannelRouter.js';
import { ScopeLabels } from './ScopeLabels.js';
import { routedSegments, shiftScope } from './utils/scope.js';

/**
 * Places a scope's data objects, stores and text annotations and builds their links:
 * data before routing so the router avoids it, annotations above their anchor after routing.
 */
export class ScopeArtifactPlacer {
  constructor(private readonly layout: ScopeLayout) {}

  build(scope: El, byId: Map<string, GNode>): void {
    const { layout } = this;
    const artifacts: GArtifact[] = [];
    const byArtifactId = new Map<string, GArtifact>();
    const add = (el: El, kind: GArtifact['kind'], size: { width: number; height: number }): GArtifact => {
      const artifact: GArtifact = { el, id: idOf(el), kind, ...size, box: { x: 0, y: 0, ...size }, links: [] };
      artifacts.push(artifact);
      byArtifactId.set(artifact.id, artifact);
      return artifact;
    };
    for (const el of many(scope, 'flowElements')) {
      if (is(el, 'bpmn:DataObjectReference')) add(el, 'dataObject', { ...SIZES.dataObject });
      else if (is(el, 'bpmn:DataStoreReference')) add(el, 'dataStore', { ...SIZES.dataStore });
    }
    for (const el of many(scope, 'artifacts')) {
      if (is(el, 'bpmn:TextAnnotation')) add(el, 'annotation', annotationSize(el.get<string | undefined>('text')));
    }
    const flowsById = new Map(layout.edges.map((edge) => [edge.id, edge]));
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
        // an end in a nested sub-process: drawn once both shapes exist
        if (source && target && !layout.compensations.some((compensation) => compensation.el === el)) layout.crossLinks.push({ el, id: idOf(el), sourceId: idOf(source), targetId: idOf(target) });
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

  placeAttached(): void {
    const { layout } = this;
    const taken: Box[] = [];
    const free = (box: Box): boolean => !taken.some((takenBox) => boxesOverlap(takenBox, box, 10));
    for (const artifact of layout.artifacts) {
      const node = artifact.anchorNode;
      if (!node) continue;
      if (artifact.kind === 'annotation') {
        if (!node.host) continue;
        artifact.box = this.boundaryNoteBox(artifact, node, node.host, free, layout.nodes.flatMap((other) => [other.box, ...other.boundary.map((event) => event.box)]));
        taken.push(artifact.box);
        continue;
      }
      // a join's entries from below rise into its bottom vertex: its data hang right of their line
      const cx = ChannelRouter.entriesFromBelow(node).length ? node.box.x + node.box.width / 2 + 6 + artifact.width / 2 : this.belowX(node);
      let box: Box = { x: Math.round(cx - artifact.width / 2), y: node.box.y + node.box.height + (node.boundary.length ? 24 : 20), width: artifact.width, height: artifact.height };
      while (!free(box)) box = { ...box, x: box.x + artifact.width + 10 };
      artifact.box = box;
      taken.push(box);
    }
    // unanchored data: right of the content
    let left = layout.width + METRICS.hGap;
    for (const artifact of layout.artifacts) {
      if (artifact.kind === 'annotation' || artifact.anchorNode) continue;
      artifact.box = { x: left, y: 0, width: artifact.width, height: artifact.height };
      left += artifact.width + 20;
    }
    layout.width = Math.max(layout.width, ...layout.artifacts.filter((artifact) => artifact.kind !== 'annotation' || artifact.anchorNode?.host).map((artifact) => artifact.box.x + artifact.box.width));
    layout.height = Math.max(layout.height, ...layout.artifacts.filter((artifact) => artifact.kind !== 'annotation' || artifact.anchorNode?.host).map((artifact) => artifact.box.y + artifact.box.height));
  }

  /** A note whose spot above its anchor is taken goes into a band above the whole content. */
  placeAnnotations(): void {
    const { layout } = this;
    const notes = layout.artifacts.filter((artifact) => artifact.kind === 'annotation' && !(artifact.anchorNode?.host));
    if (!notes.length) return;
    const boxes: Box[] = [];
    for (const node of layout.nodes) {
      boxes.push(node.box);
      for (const event of node.boundary) {
        boxes.push(event.box);
        // the label of an event on its host's top border lies above the host, where a note would go
        const label = event.onTop ? ScopeLabels.of(event, 'boundary') : undefined;
        if (label) boxes.push(label);
      }
    }
    for (const es of layout.eventSubs) boxes.push(es.box);
    for (const artifact of layout.artifacts) if (artifact.kind !== 'annotation' || artifact.anchorNode?.host) boxes.push(artifact.box);
    for (const edge of layout.edges) if (edge.label) boxes.push(edge.label);
    const segments = routedSegments(layout);
    const collides = (box: Box): boolean =>
      boxes.some((obstacle) => boxesOverlap(obstacle, box, 6)) ||
      segments.some(([start, end]) => Math.min(start.x, end.x) < box.x + box.width + 4 && Math.max(start.x, end.x) > box.x - 4 && Math.min(start.y, end.y) < box.y + box.height + 4 && Math.max(start.y, end.y) > box.y - 4);
    const settle = (note: GArtifact, cx: number, top: number, check: (box: Box) => boolean): Box | undefined => {
      for (let step = 0; step <= 8; step++) {
        for (const dir of step ? [1, -1] : [0]) {
          const left = Math.max(0, Math.round(cx - note.width / 2 + dir * step * (note.width / 2 + 20)));
          const box = { x: left, y: top, width: note.width, height: note.height };
          if (!check(box)) return box;
        }
      }
      return undefined;
    };
    const anchorX = (note: GArtifact): number => {
      const anchor = note.anchor?.box;
      return anchor ? anchor.x + anchor.width / 2 : layout.width + METRICS.hGap + note.width / 2;
    };
    const band: GArtifact[] = [];
    for (const note of notes) {
      const anchor = note.anchor?.box;
      if (!anchor) {
        band.push(note);
        continue;
      }
      const top = anchor.y - 16 - note.height;
      const box = top >= 0 ? settle(note, anchorX(note), top, collides) : undefined;
      if (box) {
        note.box = box;
        boxes.push(box);
      } else band.push(note);
    }
    if (band.length) {
      // in anchor order, so no two association lines cross
      const topBand = Math.max(...band.map((note) => note.height)) + METRICS.vGap;
      shiftScope(layout, 0, topBand);
      band.sort((first, second) => anchorX(first) - anchorX(second));
      let cursor = 0;
      for (const note of band) {
        const left = Math.max(cursor, Math.round(anchorX(note) - note.width / 2));
        note.box = { x: left, y: 0, width: note.width, height: note.height };
        cursor = left + note.width + 20;
      }
    }
    layout.width = Math.max(layout.width, ...layout.artifacts.map((artifact) => artifact.box.x + artifact.box.width));
    layout.height = Math.max(layout.height, ...layout.artifacts.map((artifact) => artifact.box.y + artifact.box.height));
  }

  refreshFlowAnchors(): void {
    for (const artifact of this.layout.artifacts) {
      for (const link of artifact.links) {
        for (const end of [link.from, link.to]) if (end.flow) end.box = this.flowPoint(end.flow);
      }
      if (artifact.anchor?.flow) artifact.anchor.box = this.flowPoint(artifact.anchor.flow);
    }
  }

  private flowPoint(flow: GEdge): Box {
    let best: [Point, Point] | undefined;
    for (let index = 0; index + 1 < flow.points.length; index++) {
      const start = flow.points[index]!, end = flow.points[index + 1]!;
      if (!best || Math.hypot(end.x - start.x, end.y - start.y) > Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y)) best = [start, end];
    }
    const midpoint = best ? { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 } : { x: 0, y: 0 };
    return { x: midpoint.x, y: midpoint.y, width: 0, height: 0 };
  }

  private belowX(node: GNode): number {
    const cx = node.box.x + node.box.width / 2;
    if (!node.boundary.length) return cx + Math.min(30, node.box.width / 2 - 10);
    const collapsed = node.kind === 'subProcess' && !node.child;
    return collapsed ? cx + 30 : cx - 30;
  }

  private dropLine(left: number, top: number): Box {
    return { x: left - 2, y: top, width: 4, height: 100000 };
  }

  private boundaryNoteBlockers(event: GNode, host: GNode): Box[] {
    const out: Box[] = [];
    for (const sibling of host.boundary) {
      if (sibling === event) continue;
      out.push(sibling.box);
      const label = ScopeLabels.of(sibling, 'boundary');
      if (label) out.push(label);
      // an event on the top border sends its flows up
      if (sibling.out.length && !sibling.onTop) out.push(this.dropLine(sibling.box.x + sibling.box.width / 2, sibling.box.y));
    }
    const hostY = host.box.y + host.box.height / 2;
    if (host.out.some((flow) => !flow.back && flow.target.box.y + flow.target.box.height / 2 > hostY + 1)) {
      for (const left of [host.box.x + 8, host.box.x + 20]) out.push(this.dropLine(left, host.box.y + host.box.height));
    }
    return out;
  }

  /**
   * Lower left of the event below the host; when that covers a sibling event, its label or
   * line, the note tries the lower right, then left of everything it would cover.
   */
  private boundaryNoteBox(note: GArtifact, event: GNode, host: GNode, free: (box: Box) => boolean, nodes: Box[]): Box {
    const blockers = this.boundaryNoteBlockers(event, host);
    const near = event.box.x - 8 - note.width;
    const y0 = host.box.y + host.box.height + 8;
    const fallback = (): Box => {
      let box: Box = { x: near, y: y0, width: note.width, height: note.height };
      while (!free(box)) box = { ...box, y: box.y + note.height + 8 };
      return box;
    };
    if (!blockers.length) return fallback();
    const others = nodes.filter((box) => box !== host.box && box !== event.box);
    const clear = (box: Box): boolean => free(box) && !blockers.some((blocker) => boxesOverlap(blocker, box, 4)) && !others.some((blocker) => boxesOverlap(blocker, box, 8));
    const label = ScopeLabels.of(event, 'boundary');
    const right = { x: event.box.x + event.box.width + 8, y: Math.max(y0, label ? label.y + label.height + 6 : y0) };
    const far = Math.min(near, Math.min(...blockers.map((blocker) => blocker.x)) - 8 - note.width);
    for (let attempt = 0; attempt < 6; attempt++) {
      const dy = attempt * (note.height + 8);
      // left of the content (x < 0) the note would leave its lane / pool: not a candidate
      for (const { x: left, y: top } of [{ x: near, y: y0 }, right, ...(far >= 0 ? [{ x: far, y: y0 }] : [])]) {
        const box = { x: left, y: top + dy, width: note.width, height: note.height };
        if (clear(box)) return box;
      }
    }
    return fallback();
  }
}
