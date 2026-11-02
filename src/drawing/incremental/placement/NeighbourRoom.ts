import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, type BpmnElement } from '../../../model/index.js';
import { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import type { ShapeSize } from '../../plane/ShapeSizes.js';
import type { Obstacles, PlacementObstacles } from './PlacementObstacles.js';
import type { PlacementState } from './PlacementState.js';
import { PushSet, type PushRequest } from './PushSet.js';

export interface LabelReach {
  side: 'above' | 'below';
  left: number;
  right: number;
}

export class NeighbourRoom {
  private static readonly LABEL_APART = 4;
  private static readonly MAX_FIXED = 500;
  private static readonly SHAPE_ROOM = 20;
  private static readonly LABEL_ROOM = 4;
  private static readonly BEND_ROOM = 10;

  constructor(
    private readonly state: PlacementState,
    private readonly obstacles: PlacementObstacles,
  ) {}

  push(plane: Plane, anchor: PlaneShape, scope: Pick<PlaneShape, 'parentId' | 'poolId'>, request: PushRequest): void {
    const band = this.obstacles.spaceBand(plane, scope, anchor);
    const space = this.state.drawing(plane).space;
    const push = band.frame ? undefined : new PushSet(plane, request, (shape) => space.unitBox(shape)).collect();
    const keep = request.fixed?.size ? { keep: request.fixed } : {};
    const line = band.within && band.frame ? Math.max(request.line, band.within.x + 1) : request.line;
    this.state.recordSpace(space.makeSpace({ axis: 'x', line, delta: request.delta, anchors: [anchor.id, scope.parentId], ...band, ...(push ? { push } : {}), ...keep }));
  }

  pushBehind(plane: Plane, source: PlaneShape, target: PlaneShape): boolean {
    if (target.bounds.center.x >= source.bounds.x || this.state.leadsTo(target.id, source.id)) {
      return false;
    }
    const fixed = this.leadingTo(plane, source);
    if (fixed.has(target.id)) {
      return false;
    }
    const delta = Math.ceil(source.bounds.right + this.state.spacingWithout(plane, [source.id, target.id]).gap - target.bounds.x);
    this.push(plane, source, target, { line: target.bounds.x - 0.5, delta, successor: target, fixed });
    return true;
  }

  localShift(plane: Plane, box: Box, line: number, blockers: Obstacles, successor: PlaneShape | undefined, gap: number): number | undefined {
    let need = 0;
    const clear = (obstacle: Box, room: number): boolean => {
      if (!obstacle.overlaps(box, room)) {
        return true;
      }
      need = Math.max(need, box.right + room - obstacle.x);
      return obstacle.x >= line;
    };
    const bends = [...plane.edges.values()].flatMap((edge) => edge.points.slice(1, -1)).map(({ x, y }) => new Box(x, y, 0, 0));
    const clearOfAll = blockers.boxes.every((obstacle) => clear(obstacle, NeighbourRoom.SHAPE_ROOM)) && blockers.labels.every((label) => clear(label, NeighbourRoom.LABEL_ROOM)) && bends.every((bend) => clear(bend, NeighbourRoom.BEND_ROOM));
    if (!clearOfAll) {
      return undefined;
    }
    if (successor && successor.bounds.x >= line && Math.abs(successor.bounds.center.y - box.center.y) <= box.height / 2 + successor.bounds.height / 2) {
      need = Math.max(need, box.right + gap - successor.bounds.x);
    }
    return Math.ceil(need);
  }

  reachOf(shape: PlaneShape): LabelReach | undefined {
    const side = shape.labelSide();
    if (!shape.label || (side !== 'above' && side !== 'below')) {
      return undefined;
    }
    return { side, left: shape.bounds.x - shape.label.x, right: shape.label.right - shape.bounds.right };
  }

  newReach(id: string, size: ShapeSize): LabelReach | undefined {
    const element = this.state.semantics.byId.get(id);
    const kind = element ? PlaneReader.shapeKind(element) : undefined;
    const name = element?.peek<string>('name')?.trim();
    if (!kind || !name || kind === 'boundary' || !PlaneShape.hasExternalLabel(kind)) {
      return undefined;
    }
    const side = PlaneShape.defaultLabelSide(kind);
    const over = (TextMetrics.labelSize(name).width - size.width) / 2;
    return side === 'above' || side === 'below' ? { side, left: over, right: over } : undefined;
  }

  labelRoom(left: LabelReach | undefined, right: LabelReach | undefined): number {
    return left && right && left.side === right.side ? Math.ceil(Math.max(0, left.right) + Math.max(0, right.left) + NeighbourRoom.LABEL_APART) : 0;
  }

  private leadingTo(plane: Plane, source: PlaneShape): Set<string> {
    const fixed = new Set<string>();
    const queue = [source.id];
    for (let current = queue.shift(); current && fixed.size <= NeighbourRoom.MAX_FIXED; current = queue.shift()) {
      if (fixed.has(current)) {
        continue;
      }
      fixed.add(current);
      plane.boundariesOf(current).forEach((boundary) => fixed.add(boundary.id));
      const host = this.state.semantics.byId.get(current)?.peek<BpmnElement>('attachedToRef')?.peek<string>('id');
      queue.push(...this.state.semantics.predecessors(current), ...(host ? [host] : []));
    }
    return fixed;
  }
}
