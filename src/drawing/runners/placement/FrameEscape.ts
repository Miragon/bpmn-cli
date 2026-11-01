import type { Box, Point } from '../../../model/index.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';

export class FrameEscape {
  private static readonly HEADER_TOLERANCE = 10;

  constructor(private readonly plane: Plane) {}

  of(shape: DShape, frame: DShape, box: Box): DShape | undefined {
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

  private outOfLane(shape: DShape, frame: DShape, center: Point): DShape | undefined {
    const there = this.laneAt(shape.poolId, center);
    if (there) {
      return there.id === frame.id ? undefined : there;
    }
    const laneFollows = this.shapes().some((lane) => lane.kind === 'lane' && lane.poolId === shape.poolId && lane.bounds.y >= frame.bounds.bottom - 1);
    return center.y >= frame.bounds.bottom && laneFollows ? frame : undefined;
  }

  private laneAt(poolId: string | undefined, point: Point): DShape | undefined {
    let smallest: DShape | undefined;
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

  private shapes(): DShape[] {
    return [...this.plane.shapes.values()];
  }
}
