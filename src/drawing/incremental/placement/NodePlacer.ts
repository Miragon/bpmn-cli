import type { BpmnElement } from '../../../model/index.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { ArtifactPlacer } from './ArtifactPlacer.js';
import { BoundaryPlacer } from './BoundaryPlacer.js';
import { NeighbourPlacer } from './NeighbourPlacer.js';
import { NeighbourRoom } from './NeighbourRoom.js';
import { PlacementObstacles } from './PlacementObstacles.js';
import type { PlacementState } from './PlacementState.js';
import { RowChooser } from './RowChooser.js';

const MODES = ['after', 'boundary', 'exception', 'before', 'free'] as const;

type Mode = (typeof MODES)[number];

interface Chosen {
  id: string;
  plane: Plane;
  mode: Mode;
  preds?: PlaneShape[];
  successor?: PlaneShape;
}

interface Queue {
  pending: Set<string>;
  exception: ReadonlySet<string>;
}

export class NodePlacer {
  private static readonly FRAME_PAD = 15;

  private readonly rows: RowChooser;
  private readonly boundaries: BoundaryPlacer;
  private readonly room: NeighbourRoom;
  private readonly neighbours: NeighbourPlacer;
  private readonly artifacts: ArtifactPlacer;

  constructor(private readonly state: PlacementState) {
    const obstacles = new PlacementObstacles(state);
    this.rows = new RowChooser(state, obstacles);
    this.boundaries = new BoundaryPlacer(state, obstacles, this.rows);
    this.room = new NeighbourRoom(state, obstacles);
    this.neighbours = new NeighbourPlacer(state, obstacles, this.rows, this.boundaries, this.room);
    this.artifacts = new ArtifactPlacer(state, obstacles, this.neighbours);
    state.hooks.reattachBoundaries = (plane, host) => this.boundaries.reattachBoundaries(plane, host);
  }

  private static hostIdOf(element: BpmnElement): string | undefined {
    return element.is('bpmn:BoundaryEvent') ? element.peek<BpmnElement>('attachedToRef')?.peek<string>('id') : undefined;
  }

  changeLane(plane: Plane, id: string): boolean {
    const shape = plane.shapes.get(id);
    const lane = shape?.laneId ? plane.shapes.get(shape.laneId) : undefined;
    if (!shape || !lane) {
      return false;
    }
    const inner = Frames.interior(lane, 2);
    const inLane = (): boolean => shape.bounds.y >= inner.y && shape.bounds.bottom <= inner.bottom && shape.bounds.x >= lane.bounds.x && shape.bounds.right <= lane.bounds.right;
    if (inLane()) {
      return false;
    }
    const { width, height } = shape.bounds;
    const exclude = new Set([id, ...plane.boundariesOf(id).map((boundary) => boundary.id)]);
    const neighbours = [...this.state.semantics.predecessors(id), ...this.state.semantics.successors(id)].flatMap((neighbour) => plane.shapes.get(neighbour) ?? []).filter((neighbour) => neighbour.laneId === lane.id).map((neighbour) => Math.round(neighbour.bounds.center.y));
    const centre = this.rows.rowInLane(plane, lane, { left: shape.bounds.x, size: { width, height }, exclude }, neighbours);
    const { space } = this.state.drawing(plane);
    space.shiftShape(id, 0, Math.round(centre - height / 2 - shape.bounds.y)).forEach((movedId) => this.state.moved.add(movedId));
    if (!inLane()) {
      this.state.recordSpace(space.fitInFrame(id, NodePlacer.FRAME_PAD));
    }
    return true;
  }

  pushBehind(plane: Plane, source: PlaneShape, target: PlaneShape): boolean {
    return this.room.pushBehind(plane, source, target);
  }

  placeFlowNodes(ids: string[]): string[] {
    const queue = { pending: new Set(ids), exception: this.exceptionPaths(ids) };
    const { pending } = queue;
    let last: Chosen | undefined;
    while (this.dropDrawn(pending)) {
      if (last) {
        this.state.hooks.afterNode?.(last.plane, last.id);
      }
      last = this.choose(queue);
      if (!last) {
        break;
      }
      this.place(last, pending);
    }
    this.state.current = undefined;
    return [...pending];
  }

  placeArtifact(id: string): boolean {
    const plane = this.state.hooks.planeFor(id);
    if (plane) {
      this.artifacts.placeArtifact(plane, id);
    }
    return !!plane;
  }

  private dropDrawn(pending: Set<string>): number {
    for (const id of pending) {
      if (this.state.planes.some((plane) => plane.shapes.has(id))) {
        pending.delete(id);
      }
    }
    return pending.size;
  }

  private exceptionPaths(ids: readonly string[]): Set<string> {
    const pending = new Set(ids);
    const exception = new Set<string>();
    const walk = ids.filter((id) => this.state.semantics.byId.get(id)?.is('bpmn:BoundaryEvent'));
    while (walk.length) {
      for (const successor of this.state.semantics.successors(walk.shift()!)) {
        if (pending.has(successor) && !exception.has(successor)) {
          exception.add(successor);
          walk.push(successor);
        }
      }
    }
    return exception;
  }

  private choose(queue: Queue): Chosen | undefined {
    for (const mode of MODES) {
      for (const id of queue.pending) {
        const plane = this.state.hooks.planeFor(id);
        const chosen = plane ? this.chosenIn(mode, id, plane, queue) : undefined;
        if (chosen) {
          return chosen;
        }
      }
    }
    return undefined;
  }

  private chosenIn(mode: Mode, id: string, plane: Plane, { pending, exception }: Queue): Chosen | undefined {
    const element = this.state.semantics.byId.get(id)!;
    const hostId = NodePlacer.hostIdOf(element);
    if (mode === 'boundary') {
      return hostId && plane.shapes.has(hostId) ? { id, plane, mode } : undefined;
    }
    if (hostId && pending.has(hostId)) {
      return undefined;
    }
    if (mode === 'free') {
      return { id, plane, mode };
    }
    if (mode === 'before') {
      const successor = this.state.semantics.successors(id).flatMap((successorId) => plane.shapes.get(successorId) ?? [])[0];
      return successor ? { id, plane, mode, successor } : undefined;
    }
    if (element.is('bpmn:BoundaryEvent') || exception.has(id) !== (mode === 'exception')) {
      return undefined;
    }
    const preds = this.state.semantics.predecessors(id).flatMap((predId) => plane.shapes.get(predId) ?? []);
    return preds.length ? { id, plane, mode, preds } : undefined;
  }

  private place(chosen: Chosen, pending: Set<string>): void {
    const { id, plane } = chosen;
    pending.delete(id);
    this.state.current = id;
    this.state.spacing.delete(plane);
    this.placeByMode(chosen, pending);
    this.pullPlacedJoins(plane, id, pending);
    this.pushTargets(plane, id, pending);
  }

  private placeByMode({ id, plane, mode, preds, successor }: Chosen, pending: ReadonlySet<string>): void {
    if (mode === 'after' || mode === 'exception') {
      this.neighbours.placeAfter(plane, id, preds!, pending);
    } else if (mode === 'before') {
      this.neighbours.placeBefore(plane, id, successor!);
    } else if (!this.state.semantics.byId.get(id)?.is('bpmn:BoundaryEvent') || !this.boundaries.placeBoundary(plane, id)) {
      this.neighbours.placeUnconnected(plane, id);
    }
  }

  private pullPlacedJoins(plane: Plane, id: string, pending: ReadonlySet<string>): void {
    for (const joinId of this.state.semantics.successors(id)) {
      const join = plane.shapes.get(joinId);
      const preds = this.state.semantics.predecessors(joinId).map((pred) => plane.shapes.get(pred));
      const successors = this.state.semantics.successors(joinId);
      const successor = successors.length === 1 ? plane.shapes.get(successors[0]!) : undefined;
      const placedJoin = this.state.placed.has(joinId) && !pending.has(joinId);
      if (join?.el.is('bpmn:Gateway') && placedJoin && successor && preds.length >= 2 && preds.every((pred): pred is PlaneShape => !!pred) && this.joinsBackwards(join, preds, successor)) {
        plane.shapes.delete(joinId);
        this.state.joins.set(joinId, successor.id);
        this.state.current = joinId;
        this.state.spacing.delete(plane);
        this.neighbours.placeAfter(plane, joinId, preds, pending);
      }
    }
  }

  private joinsBackwards(join: PlaneShape, preds: readonly PlaneShape[], successor: PlaneShape): boolean {
    const sameFrame = (shape: PlaneShape): boolean => shape.poolId === join.poolId && shape.parentId === join.parentId;
    const rightmost = Math.max(...preds.map((pred) => pred.bounds.right));
    if (!preds.every(sameFrame) || !sameFrame(successor) || (successor.bounds.x <= rightmost && successor.bounds.x < join.bounds.right)) {
      return false;
    }
    return preds.some((pred) => join.bounds.center.x < pred.bounds.x && !this.state.leadsTo(join.id, pred.id));
  }

  private pushTargets(plane: Plane, id: string, pending: ReadonlySet<string>): void {
    const source = plane.shapes.get(id);
    if (!source) {
      return;
    }
    for (const targetId of this.state.semantics.successors(id)) {
      const target = plane.shapes.get(targetId);
      if (target && !pending.has(targetId) && this.state.spliced.get(id) !== targetId && this.state.joins.get(id) !== targetId && target.poolId === source.poolId && target.parentId === source.parentId) {
        this.room.pushBehind(plane, source, target);
      }
    }
  }
}
