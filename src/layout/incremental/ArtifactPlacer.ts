import { is } from '../../model/utils/moddle.js';
import { bottom, type Box, cx, overlaps, right } from '../../drawing/utils/geom.js';
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
        const sourceId = idOf(raw(other, 'sourceRef'));
        const targetId = idOf(raw(other, 'targetRef'));
        if (sourceId === id && targetId) out.push(targetId);
        else if (targetId === id && sourceId) out.push(sourceId);
      } else if (is(other, 'bpmn:DataInputAssociation')) {
        if (rawList(other, 'sourceRef').some((ref) => idOf(ref) === id) && idOf(other.$parent)) out.push(idOf(other.$parent)!);
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
      .map((anchorId) => plane.shapes.get(anchorId))
      .find((shape): shape is DShape => !!shape);
    if (!anchor) {
      this.neighbours.placeUnconnected(plane, id);
      return;
    }
    const probe = this.placer.probeOf(plane, id);
    const frame = Frames.of(plane, probe);
    const obs = this.obstacles.of(plane, frame, new Set([id, ...this.obstacles.homeGroups(plane, [anchor])]));
    const segs = this.obstacles.edgeBoxes(plane);
    const anchorBox = this.placer.drawing(plane).unitBox(anchor);
    const annotation = is(el, 'bpmn:TextAnnotation');
    const candidates: Box[] = [];
    const steps = [0, 1, 2, 3, 4];
    for (const step of steps) {
      if (annotation) {
        candidates.push({ x: right(anchorBox) + 20 + step * 30, y: anchorBox.y - 30 - size.height - step * 20, ...size });
        candidates.push({ x: cx(anchorBox) + step * 40, y: anchorBox.y - 40 - size.height - step * 30, ...size });
      } else {
        candidates.push({ x: right(anchorBox) + 10 + step * (size.width + 20), y: bottom(anchorBox) + 30, ...size });
        candidates.push({ x: right(anchorBox) + 10, y: bottom(anchorBox) + 30 + step * (size.height + 20), ...size });
      }
    }
    if (annotation) for (const step of steps) candidates.push({ x: right(anchorBox) + 30 + step * (size.width + 20), y: anchorBox.y - size.height / 2, ...size }, { x: right(anchorBox) + 20, y: bottom(anchorBox) + 30 + step * (size.height + 20), ...size });
    const inner = frame ? Frames.interior(frame, 5) : undefined;
    const ok = (box: Box): boolean => this.obstacles.isFree(box, obs, 15) && !segs.some((segment) => overlaps(segment, box, 2)) && (!inner || (box.x >= inner.x && box.y >= inner.y));
    const box = candidates.find(ok) ?? candidates.find((candidate) => this.obstacles.isFree(candidate, obs, 10) && (!inner || (candidate.x >= inner.x && candidate.y >= inner.y))) ?? candidates[0]!;
    const shape = this.placer.newShape(plane, id, { ...box, x: Math.round(box.x), y: Math.round(box.y) });
    this.placer.commit(plane, shape);
  }
}
