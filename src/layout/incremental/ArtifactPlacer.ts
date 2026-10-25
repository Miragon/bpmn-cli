import { is } from '../../model/utils/moddle.js';
import { bottom, overlaps, right, type Box } from '../../drawing/utils/geom.js';
import { idOf, raw, rawList } from '../../drawing/utils/raw.js';
import { Frames } from '../../drawing/Frames.js';

import type { DShape, Plane } from '../../drawing/types.js';
import type { NodePlacer } from './NodePlacer.js';
import type { PlacementObstacles } from './PlacementObstacles.js';
import type { NeighbourPlacer } from './NeighbourPlacer.js';

/**
 * Text annotations above-right, data objects and stores below-right of the element they are
 * connected to; an unconnected artifact goes below its frame's content.
 */
export class ArtifactPlacer {
  constructor(
    private readonly placer: NodePlacer,
    private readonly obstacles: PlacementObstacles,
    private readonly neighbours: NeighbourPlacer,
  ) {}

  /** Elements an artifact is connected to (associations, data associations), in model order. */
  private artifactAnchors(id: string): string[] {
    const out: string[] = [];
    const el = this.placer.sem.byId.get(id);
    if (!el) return out;
    for (const other of this.placer.sem.byId.values()) {
      if (is(other, 'bpmn:Association')) {
        const s = idOf(raw(other, 'sourceRef'));
        const t = idOf(raw(other, 'targetRef'));
        if (s === id && t) out.push(t);
        else if (t === id && s) out.push(s);
      } else if (is(other, 'bpmn:DataInputAssociation')) {
        if (rawList(other, 'sourceRef').some((r) => idOf(r) === id) && idOf(other.$parent)) out.push(idOf(other.$parent)!);
      } else if (is(other, 'bpmn:DataOutputAssociation')) {
        if (idOf(raw(other, 'targetRef')) === id && idOf(other.$parent)) out.push(idOf(other.$parent)!);
      }
    }
    return out;
  }

  placeArtifact(plane: Plane, id: string): void {
    const el = this.placer.sem.byId.get(id)!;
    const size = this.placer.sizeFor(plane, id);
    const anchor = this.artifactAnchors(id)
      .map((a) => plane.shapes.get(a))
      .find((s): s is DShape => !!s);
    if (!anchor) {
      this.neighbours.placeUnconnected(plane, id);
      return;
    }
    const probe = this.placer.probeOf(plane, id);
    const frame = Frames.of(plane, probe);
    const obs = this.obstacles.of(plane, frame, new Set([id, ...this.obstacles.homeGroups(plane, [anchor])]));
    const segs = this.obstacles.edgeBoxes(plane);
    const a = this.placer.drawing(plane).unitBox(anchor);
    const annotation = is(el, 'bpmn:TextAnnotation');
    const candidates: Box[] = [];
    const steps = [0, 1, 2, 3, 4];
    for (const k of steps) {
      if (annotation) {
        candidates.push({ x: right(a) + 20 + k * 30, y: a.y - 30 - size.height - k * 20, ...size });
        candidates.push({ x: a.x + a.width / 2 + k * 40, y: a.y - 40 - size.height - k * 30, ...size });
      } else {
        candidates.push({ x: right(a) + 10 + k * (size.width + 20), y: bottom(a) + 30, ...size });
        candidates.push({ x: right(a) + 10, y: bottom(a) + 30 + k * (size.height + 20), ...size });
      }
    }
    if (annotation) for (const k of steps) candidates.push({ x: right(a) + 30 + k * (size.width + 20), y: a.y - size.height / 2, ...size }, { x: right(a) + 20, y: bottom(a) + 30 + k * (size.height + 20), ...size });
    const inner = frame ? Frames.interior(frame, 5) : undefined;
    const ok = (b: Box): boolean => this.obstacles.isFree(b, obs, 15) && !segs.some((s) => overlaps(s, b, 2)) && (!inner || (b.x >= inner.x && b.y >= inner.y));
    const box = candidates.find(ok) ?? candidates.find((b) => this.obstacles.isFree(b, obs, 10) && (!inner || (b.x >= inner.x && b.y >= inner.y))) ?? candidates[0]!;
    const s = this.placer.newShape(plane, id, { ...box, x: Math.round(box.x), y: Math.round(box.y) });
    this.placer.commit(plane, s);
  }
}
