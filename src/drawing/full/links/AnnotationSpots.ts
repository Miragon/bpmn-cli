import { Box, Polyline, type Segment } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GArtifact, ScopeLayout } from '../scopes/GNode.js';
import { Scope } from '../scopes/Scope.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { LinkRouter } from './LinkRouter.js';

export class AnnotationSpots {
  private static readonly ABOVE_ANCHOR = 16;
  private static readonly SHAPE_KEEP = 6;
  private static readonly LINE_KEEP = 4;
  private static readonly SETTLE_STEPS = 8;
  private static readonly SIDE_STEP = 20;
  private static readonly BESIDE_DATA = 20;

  private readonly boxes: Box[];
  private readonly segments: Segment[];

  constructor(private readonly layout: ScopeLayout) {
    this.boxes = AnnotationSpots.obstacles(layout);
    const compensations = layout.compensations.flatMap((compensation) => new Polyline(LinkRouter.compensationPath(compensation.event.box, compensation.handler.box)).segments());
    this.segments = [...new Scope(layout).routedSegments(), ...compensations];
  }

  private static obstacles({ nodes, eventSubs, artifacts, edges }: ScopeLayout): Box[] {
    const boxes: Box[] = [];
    for (const node of nodes) {
      boxes.push(node.box);
      for (const event of node.boundary) {
        boxes.push(event.box);
        const label = event.onTop ? ScopeLabels.of(event, 'boundary') : undefined;
        if (label) {
          boxes.push(label);
        }
      }
    }
    boxes.push(...eventSubs.map((eventSub) => eventSub.box));
    boxes.push(...artifacts.filter((artifact) => artifact.kind !== 'annotation' || artifact.anchorNode?.host).map((artifact) => artifact.box));
    boxes.push(...edges.flatMap((edge) => edge.label ?? []));
    return boxes;
  }

  take(box: Box): void {
    this.boxes.push(box);
  }

  anchorX(note: GArtifact): number {
    const anchor = note.anchor?.box;
    return anchor ? anchor.center.x : this.layout.width + ShapeSizes.GAPS.hGap + note.width / 2;
  }

  spotOf(note: GArtifact, anchor: Box): Box | undefined {
    const top = anchor.y - AnnotationSpots.ABOVE_ANCHOR - note.height;
    return this.besideData(note) ?? this.underFlow(note, top) ?? (top >= 0 ? this.settle(note, top, AnnotationSpots.SETTLE_STEPS) : undefined);
  }

  private collides(box: Box): boolean {
    const keep = AnnotationSpots.LINE_KEEP;
    return (
      this.boxes.some((obstacle) => obstacle.overlaps(box, AnnotationSpots.SHAPE_KEEP)) ||
      this.segments.some(({ start, end }) => Math.min(start.x, end.x) < box.right + keep && Math.max(start.x, end.x) > box.x - keep && Math.min(start.y, end.y) < box.bottom + keep && Math.max(start.y, end.y) > box.y - keep)
    );
  }

  private settle(note: GArtifact, top: number, steps: number): Box | undefined {
    const centerX = this.anchorX(note);
    for (let step = 0; step <= steps; step++) {
      for (const direction of step ? [1, -1] : [0]) {
        const left = Math.max(0, Math.round(centerX - note.width / 2 + direction * step * (note.width / 2 + AnnotationSpots.SIDE_STEP)));
        const box = new Box(left, top, note.width, note.height);
        if (!this.collides(box)) {
          return box;
        }
      }
    }
    return undefined;
  }

  private underFlow(note: GArtifact, top: number): Box | undefined {
    const point = note.anchor?.flow ? note.anchor.box : undefined;
    const lane = point && this.layout.laneBands?.slice(1).find((band) => point.y > band.top && point.y < band.bottom);
    const under = point && point.y + AnnotationSpots.ABOVE_ANCHOR;
    return lane && top < lane.top && top + note.height > lane.top && under! + note.height <= lane.bottom ? this.settle(note, under!, 1) : undefined;
  }

  private besideData(note: GArtifact): Box | undefined {
    const data = this.layout.artifacts.find((artifact) => artifact === note.anchor && artifact.kind !== 'annotation');
    if (!data) {
      return undefined;
    }
    const node = data.anchorNode;
    const lane = node && this.layout.laneBands?.slice(0, -1).find((band) => band.nodes.has(node.host ?? node));
    const y = Math.round(Math.min(data.box.center.y - note.height / 2, (lane?.bottom ?? Number.POSITIVE_INFINITY) - note.height));
    return [data.box.right + AnnotationSpots.BESIDE_DATA, data.box.x - AnnotationSpots.BESIDE_DATA - note.width]
      .map((x) => new Box(Math.round(x), y, note.width, note.height))
      .find((spot) => spot.x >= 0 && spot.y >= 0 && !this.collides(spot));
  }
}
