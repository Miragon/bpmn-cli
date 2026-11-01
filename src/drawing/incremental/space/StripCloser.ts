import type { Box } from '../../../model/index.js';
import { BoxAxis, type Axis, type Band } from '../../plane/BoxAxis.js';
import { DrawingCheckpoint } from '../../plane/DrawingCheckpoint.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import type { SpaceRequest, SpaceResult } from './SpacePass.js';

export interface StripRequest {
  axis: Axis;
  from: number;
  to: number;
  gap: number;
  within?: Box;
  ignore?: ReadonlySet<string>;
  keep?: ReadonlySet<string>;
}

interface Opening {
  along: BoxAxis;
  band: Band | undefined;
  low: number;
  high: number;
  line: number;
}

export class StripCloser {
  private static readonly TOLERANCE = 3;

  constructor(
    private readonly plane: Plane,
    private readonly makeSpace: (request: SpaceRequest) => SpaceResult,
  ) {}

  close(request: StripRequest): SpaceResult | undefined {
    const { axis, from, to, gap, within, keep } = request;
    const width = to - from;
    if (width - gap <= 0) {
      return undefined;
    }
    const line = to - StripCloser.TOLERANCE;
    const along = BoxAxis.of(axis);
    const opening = { along, band: along.bandOf(within), low: from + gap + StripCloser.TOLERANCE, high: line, line };
    if (this.shapesBlock(opening) || this.edgesBlock(request, opening)) {
      return undefined;
    }
    const checkpoint = new DrawingCheckpoint(this.plane);
    const result = this.makeSpace({ axis, line, delta: -(width - gap), ...(within ? { within } : {}), ...(keep ? { keep } : {}) });
    if (this.landsOnShape(result, checkpoint)) {
      checkpoint.restore();
      return undefined;
    }
    return result;
  }

  private shapesBlock(opening: Opening): boolean {
    const { along, band, line } = opening;
    const { shapes } = this.plane;
    return [...shapes.values()].some((shape) => {
      const owner = shape.hostId ? (shapes.get(shape.hostId) ?? shape) : shape;
      const stays = along.near(owner.bounds) < line;
      return (shape.isLeaf && stays && this.blocks(shape.bounds, opening)) || (!!shape.label && stays && this.blocks(shape.label, opening)) || (shape.container && along.overlapsBand(shape.bounds, band) && this.borderInside(shape, opening));
    });
  }

  private blocks(box: Box, { along, band, low, high }: Opening): boolean {
    return along.near(box) < high && along.far(box) > low && along.overlapsBand(box, band);
  }

  private borderInside({ bounds }: DShape, { along, low, high }: Opening): boolean {
    const near = along.near(bounds), far = along.far(bounds);
    return (near > low && near < high) || (far > low && far < high);
  }

  private edgesBlock({ axis, ignore }: StripRequest, opening: Opening): boolean {
    const { along, band, low, high } = opening;
    return [...this.plane.edges.values()].some((edge) => {
      if (ignore?.has(edge.id)) {
        return false;
      }
      const bendInside = edge.points.slice(1, -1).some((point) => point[axis] > low && point[axis] < high && along.pointInBand(point, band));
      return bendInside || (!!edge.label && this.blocks(edge.label, opening));
    });
  }

  private landsOnShape(result: SpaceResult, checkpoint: DrawingCheckpoint): boolean {
    const leaves = this.plane.leaves();
    return leaves.some(
      (shape) =>
        result.moved.has(shape.id) &&
        leaves.some((other) => other !== shape && other.hostId !== shape.id && shape.hostId !== other.id && other.bounds.overlaps(shape.bounds) && !checkpoint.boundsOf(other).overlaps(checkpoint.boundsOf(shape))),
    );
  }
}
