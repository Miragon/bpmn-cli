import { Box } from '../../../model/index.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import type { PlacementState } from './PlacementState.js';

export interface Obstacles {
  boxes: Box[];
  labels: Box[];
}

export interface SpaceBand {
  within?: Box;
  frame?: string;
}

export class PlacementObstacles {
  private static readonly CLEARANCE = 20;
  private static readonly LABEL_CLEARANCE = 4;

  constructor(private readonly state: PlacementState) {}

  private static centreIn(box: Box, frame: PlaneShape | undefined): boolean {
    if (!frame) {
      return true;
    }
    const { x, y } = box.center;
    const { bounds } = frame;
    return x > bounds.x && x < bounds.right && y > bounds.y && y < bounds.bottom;
  }

  within(plane: Plane, shape: PlaneShape, frame: PlaneShape | undefined): boolean {
    return new Frames(plane).within(shape, frame);
  }

  of(plane: Plane, frame: PlaneShape | undefined, exclude: ReadonlySet<string>, plain = true): Obstacles {
    const found: Obstacles = { boxes: [], labels: [] };
    const shapes = [...plane.shapes.values()].filter((shape) => !exclude.has(shape.id) && shape !== frame);
    for (const shape of shapes) {
      if (shape.kind !== 'group') {
        this.noteShape(plane, shape, frame, found);
      } else if (plain) {
        found.boxes.push(shape.bounds);
      }
    }
    if (plain) {
      found.labels.push(...[...plane.edges.values()].flatMap((edge) => edge.label ?? []));
    }
    return found;
  }

  homeGroups(plane: Plane, anchors: ReadonlyArray<PlaneShape | undefined>): string[] {
    const centreInside = (anchor: PlaneShape | undefined, group: PlaneShape): boolean => !!anchor && PlacementObstacles.centreIn(anchor.bounds, group);
    return [...plane.shapes.values()].filter((group) => group.kind === 'group' && anchors.some((anchor) => centreInside(anchor, group))).map((group) => group.id);
  }

  isFree(box: Box, obstacles: Obstacles, clearance = PlacementObstacles.CLEARANCE): boolean {
    return !obstacles.boxes.some((obstacle) => obstacle.overlaps(box, clearance)) && !obstacles.labels.some((label) => label.overlaps(box, PlacementObstacles.LABEL_CLEARANCE));
  }

  spaceBand(plane: Plane, shape: Pick<PlaneShape, 'parentId' | 'poolId'>, anchor?: PlaneShape): SpaceBand {
    const sub = shape.parentId ? plane.shapes.get(shape.parentId) : undefined;
    if (sub) {
      return { within: sub.bounds.copy(), frame: sub.id };
    }
    const pool = shape.poolId ? plane.shapes.get(shape.poolId) : undefined;
    if (pool) {
      return { within: pool.bounds.copy() };
    }
    const groups = anchor ? this.homeGroups(plane, [anchor]).map((id) => plane.shapes.get(id)!) : [];
    const [smallest] = groups.sort((first, second) => first.bounds.width * first.bounds.height - second.bounds.width * second.bounds.height);
    return smallest ? { within: smallest.bounds.copy() } : {};
  }

  contentBottom(plane: Plane, frame: PlaneShape | undefined, exclude: ReadonlySet<string>): number | undefined {
    const { boxes, labels } = this.of(plane, frame, exclude, false);
    const member = (id: string | undefined): boolean => {
      const shape = id ? plane.shapes.get(id) : undefined;
      return !!shape && shape !== frame && this.within(plane, shape, frame);
    };
    const edgeLabels = [...plane.edges.values()].flatMap(({ label, sourceId, targetId }) => (label && ((member(sourceId) && member(targetId)) || PlacementObstacles.centreIn(label, frame)) ? [label] : []));
    const groups = [...plane.shapes.values()].filter((group) => group.kind === 'group' && !exclude.has(group.id) && PlacementObstacles.centreIn(group.bounds, frame)).map((group) => group.bounds);
    const all = [...boxes, ...labels, ...edgeLabels, ...groups];
    return all.length ? Math.max(...all.map((box) => box.bottom)) : undefined;
  }

  edgeBoxes(plane: Plane): Box[] {
    return [...plane.edges.values()].flatMap(({ points }) => points.slice(1).map((end, index) => {
      const start = points[index]!;
      return new Box(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(start.x - end.x), Math.abs(start.y - end.y));
    }));
  }

  private noteShape(plane: Plane, shape: PlaneShape, frame: PlaneShape | undefined, found: Obstacles): void {
    const solid = shape.isLeaf || (shape.kind === 'subProcess' && shape.container);
    const member = this.within(plane, shape, frame);
    const drawnIn = !member && !!frame && solid && shape.bounds.overlaps(frame.bounds) && !new Frames(plane).within(frame, shape);
    if (!member && !drawnIn) {
      if (frame && shape.label?.overlaps(frame.bounds)) {
        found.labels.push(shape.label);
      }
      return;
    }
    if (solid) {
      found.boxes.push(shape.isLeaf && !shape.hostId ? this.state.drawing(plane).space.unitBox(shape) : shape.bounds);
    }
    if (shape.label) {
      found.labels.push(shape.label);
    }
  }
}
