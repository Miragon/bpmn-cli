import type { Point } from '../../../model/index.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { SpacePass, SpaceResult } from './SpacePass.js';

export class EdgeFollow {
  private readonly blockOf = new Map<string, string>();

  constructor(
    private readonly pass: SpacePass,
    private readonly result: SpaceResult,
  ) {}

  private static nearestSegment(points: readonly Point[], box: { center: Point }): number {
    const center = box.center;
    let best = 0;
    let least = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < points.length; index++) {
      const start = points[index]!, end = points[index + 1]!;
      const dx = end.x - start.x, dy = end.y - start.y;
      const length = dx * dx + dy * dy;
      const projection = length ? Math.max(0, Math.min(1, ((center.x - start.x) * dx + (center.y - start.y) * dy) / length)) : 0;
      const distance = Math.hypot(center.x - (start.x + projection * dx), center.y - (start.y + projection * dy));
      if (distance < least - 1e-9) {
        least = distance;
        best = index;
      }
    }
    return best;
  }

  follow(): void {
    this.noteBlocks();
    for (const edge of this.pass.plane.edges.values()) {
      if (!this.staysPut(edge)) {
        this.shiftEdge(edge);
      }
    }
  }

  private noteBlocks(): void {
    const { pass, blockOf } = this;
    const { plane } = pass;
    if (!pass.held) {
      return;
    }
    for (const shape of plane.shapes.values()) {
      if (!pass.rigid(shape) || pass.rigidAround(shape)) {
        continue;
      }
      blockOf.set(shape.id, shape.id);
      for (const inner of [...plane.boundariesOf(shape.id), ...plane.contentOf(shape.id).shapes]) {
        blockOf.set(inner.id, shape.id);
      }
    }
  }

  private changed(id: string | undefined): boolean {
    return !!id && (this.result.moved.has(id) || this.result.resized.has(id));
  }

  private outsideFrame(id: string | undefined): boolean {
    const { pass } = this;
    const shape = id ? pass.plane.shapes.get(id) : undefined;
    return !shape || (shape !== pass.scope!.frame && !pass.insideFrame(shape));
  }

  private staysPut({ sourceId, targetId }: DEdge): boolean {
    const { pass } = this;
    if (sourceId && targetId && pass.keep.has(sourceId) && pass.keep.has(targetId)) {
      return true;
    }
    return !!pass.scope && !this.changed(sourceId) && !this.changed(targetId) && this.outsideFrame(sourceId) && this.outsideFrame(targetId);
  }

  private shiftEdge(edge: DEdge): void {
    const { pass } = this;
    const { axis, delta, line, band, along, push } = pass;
    const bends = !push || push.has(edge.id) || this.changed(edge.sourceId) || this.changed(edge.targetId);
    const block = edge.sourceId && edge.targetId ? this.blockOf.get(edge.sourceId) : undefined;
    const inBlock = block !== undefined && this.blockOf.get(edge.targetId!) === block ? block : undefined;
    const segment = edge.label && edge.points.length >= 2 ? EdgeFollow.nearestSegment(edge.points, edge.label) : -1;
    const shifted = edge.points.map((point, index) => {
      const shift = this.pointShifts(edge, index, inBlock, bends);
      if (shift) {
        point[axis] += delta;
      }
      return shift;
    });
    if (!edge.label) {
      return;
    }
    const startShifted = segment >= 0 ? shifted[segment] : undefined;
    const endShifted = segment >= 0 ? shifted[segment + 1] : undefined;
    const follows = startShifted !== undefined && startShifted === endShifted ? startShifted : bends && along.near(edge.label) >= line && (segment >= 0 || along.centreInBand(edge.label, band));
    if (follows) {
      along.shift(edge.label, delta);
    }
  }

  private endAt({ points, sourceId, targetId }: DEdge, index: number): string | undefined {
    if (index === 0) {
      return sourceId;
    }
    return index === points.length - 1 ? targetId : undefined;
  }

  private pointShifts(edge: DEdge, index: number, block: string | undefined, bends: boolean): boolean {
    const { pass, result } = this;
    const { axis, line, band, along, plane } = pass;
    const point = edge.points[index]!;
    if (block !== undefined) {
      return result.moved.has(block);
    }
    const endId = this.endAt(edge, index);
    const end = endId ? plane.shapes.get(endId) : undefined;
    const beyond = point[axis] >= line;
    if (!end) {
      return beyond && bends && along.pointInBand(point, band);
    }
    if (result.moved.has(end.id)) {
      return true;
    }
    return result.resized.has(end.id) && beyond;
  }
}
