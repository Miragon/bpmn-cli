import { Box, type Point } from '../../../model/index.js';
import type { Drawing } from '../../incremental/Drawing.js';
import type { SpaceResult } from '../../incremental/space/SpaceTool.js';
import { BoxAxis, type Axis } from '../../plane/BoxAxis.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import { PlaneStrips, type Strip } from './PlaneStrips.js';

export class StripClosure {
  private static readonly LINE_BEFORE_END = 3;

  constructor(private readonly drawing: Drawing) {}

  private static withinBand(coordinate: number, axis: Axis, within: Box | undefined): boolean {
    if (!within) {
      return true;
    }
    return axis === 'x' ? coordinate >= within.y - 1 && coordinate <= within.bottom + 1 : coordinate >= within.x - 1 && coordinate <= within.right + 1;
  }

  private static squeezed(coordinate: number, { from, to, keep }: Strip): number {
    return from + ((coordinate - from) * keep) / (to - from);
  }

  private static touches({ points, label }: PlaneEdge, axis: Axis, strip: Strip, within: Box | undefined): boolean {
    const along = BoxAxis.of(axis);
    const band = along.bandOf(within);
    const hit = (box: Box): boolean => along.far(box) + 1 > strip.from && along.near(box) - 1 < strip.to && along.overlapsBand(box.grow(1), band);
    return [...points.slice(1, -1).map(({ x, y }) => new Box(x, y, 0, 0)), ...(label ? [label] : [])].some(hit);
  }

  private static squeezeBends({ points }: PlaneEdge, axis: Axis, strip: Strip, within: Box | undefined): void {
    for (const point of points.slice(1, -1)) {
      const { along, across } = StripClosure.coordinates(point, axis);
      if (StripClosure.inClosedPart(along, strip) && StripClosure.withinBand(across, axis, within)) {
        point[axis] = Math.round(StripClosure.squeezed(along, strip));
      }
    }
  }

  private static squeezeLabel({ label }: PlaneEdge, axis: Axis, strip: Strip, within: Box | undefined): void {
    if (!label) {
      return;
    }
    const { along, across } = StripClosure.coordinates(label.center, axis);
    if (StripClosure.inClosedPart(along, strip) && StripClosure.withinBand(across, axis, within)) {
      label[axis] += Math.round(StripClosure.squeezed(along, strip) - along);
    }
  }

  private static inClosedPart(coordinate: number, strip: Strip): boolean {
    return coordinate > strip.from && coordinate < strip.to - StripClosure.LINE_BEFORE_END;
  }

  private static coordinates({ x, y }: Point, axis: Axis): { along: number; across: number } {
    return axis === 'x' ? { along: x, across: y } : { along: y, across: x };
  }

  close(axis: Axis, strip: Strip, within?: Box, keep?: ReadonlySet<string>): SpaceResult | undefined {
    const { plane, space } = this.drawing;
    const loose = new PlaneStrips(plane).looseEdges();
    const touched = [...plane.edges.values()].filter((edge) => loose.has(edge.id) && StripClosure.touches(edge, axis, strip, within));
    const result = space.closeStrip({ axis, from: strip.from, to: strip.to, gap: strip.keep, ignore: loose, ...(within ? { within: within.copy() } : {}), ...(keep ? { keep } : {}) });
    if (result) {
      for (const edge of touched) {
        StripClosure.squeezeBends(edge, axis, strip, within);
        StripClosure.squeezeLabel(edge, axis, strip, within);
      }
    }
    return result;
  }
}
