import type { Box, Point } from '../../../model/index.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';

export class FrameEscape {
  private static readonly HEADER_TOLERANCE = 10;

  constructor(private readonly plane: Plane) {}

  of(shape: PlaneShape, frame: PlaneShape, box: Box): PlaneShape | undefined {
    const inner = Frames.interior(frame, 0);
    const center = box.center;
    const tolerance = frame.kind === 'lane' || frame.kind === 'participant' ? FrameEscape.HEADER_TOLERANCE : 0.5;
    if (box.x < inner.x - tolerance || box.y < frame.bounds.y - 0.5) {
      return frame;
    }
    const otherPool = this.shapes().find((pool) => pool.kind === 'participant' && pool.id !== shape.poolId && pool.bounds.contains(center));
    if (otherPool) {
      return otherPool;
    }
    return frame.kind === 'lane' ? this.outOfLane(shape, frame, center) : undefined;
  }

  private outOfLane(shape: PlaneShape, frame: PlaneShape, center: Point): PlaneShape | undefined {
    const there = this.laneAt(shape.poolId, center);
    if (there) {
      return there.id === frame.id ? undefined : there;
    }
    const laneFollows = this.shapes().some((lane) => lane.kind === 'lane' && lane.poolId === shape.poolId && lane.bounds.y >= frame.bounds.bottom - 1);
    return center.y >= frame.bounds.bottom && laneFollows ? frame : undefined;
  }

  private laneAt(poolId: string | undefined, point: Point): PlaneShape | undefined {
    let smallest: PlaneShape | undefined;
    for (const lane of this.shapes()) {
      if (lane.kind !== 'lane' || lane.poolId !== poolId || !lane.bounds.contains(point)) {
        continue;
      }
      if (!smallest || lane.bounds.width * lane.bounds.height < smallest.bounds.width * smallest.bounds.height) {
        smallest = lane;
      }
    }
    return smallest;
  }

  private shapes(): PlaneShape[] {
    return [...this.plane.shapes.values()];
  }
}
