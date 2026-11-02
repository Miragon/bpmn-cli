import type { Box } from '../../../model/index.js';
import type { Drawing } from '../../incremental/Drawing.js';
import type { OperationBefore } from '../../incremental/OperationBefore.js';
import type { Axis } from '../../plane/BoxAxis.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';

export interface RoomRequest {
  moved: readonly PlaneShape[];
  references: readonly PlaneShape[];
  before: OperationBefore;
  target: string;
  holds(): boolean;
  lock: readonly Axis[];
}

export interface DisplacedFrame {
  reference: PlaneShape;
  frame: PlaneShape;
}

export interface StrayShape {
  shape: PlaneShape;
  frame: PlaneShape;
}

export interface RoomOutcome {
  ok: boolean;
  notes: string[];
  swallowed: PlaneShape[];
  displaced: DisplacedFrame[];
  collided: Array<[string, string]>;
  strayed: StrayShape[];
}

export class RoomTrial {
  private static readonly FRAME_PAD = 15;
  private static readonly LABEL_PAD = 5;
  private static readonly MAX_DEPTH = 20;

  readonly movedIds: string[];
  readonly referenceIds: string[];
  private readonly frames: Frames;
  private readonly movable: string[];
  private readonly movedFrames: ReadonlySet<string>;

  constructor(
    private readonly plane: Plane,
    private readonly drawing: Drawing,
    private readonly request: RoomRequest,
  ) {
    this.frames = new Frames(plane);
    const { moved, references } = request;
    this.movedIds = moved.flatMap((shape) => [shape.id, ...plane.boundariesOf(shape.id).map((boundary) => boundary.id)]);
    this.referenceIds = references.map((reference) => reference.id).filter((id) => !this.movedIds.includes(id));
    this.movable = this.shapes().filter((shape) => shape.isLeaf || (shape.kind === 'subProcess' && shape.container)).map((shape) => shape.id);
    this.movedFrames = new Set(moved.flatMap((shape) => this.frames.chain(shape).map((frame) => frame.id)));
  }

  attempt(fixed: readonly string[]): RoomOutcome {
    const { moved } = this.request;
    const pinned = [...this.movedIds, ...fixed];
    for (const shape of moved) {
      this.drawing.space.fitInFrame(shape.id, RoomTrial.FRAME_PAD, undefined, pinned);
      this.fitLabel(shape, pinned);
    }
    const { notes, stuck } = this.separate(fixed, pinned);
    const swallowed = this.swallowed();
    const displaced = this.displaced();
    const collided = this.newOverlaps();
    const strayed = this.strayed();
    const clear = !swallowed.length && !displaced.length && !collided.length && !strayed.length;
    return { ok: clear && !stuck && this.request.holds(), notes, swallowed, displaced, collided, strayed };
  }

  private separate(fixed: readonly string[], pinned: readonly string[]): { notes: string[]; stuck: boolean } {
    const { movedIds: ids, movable } = this;
    const { moved, before, lock } = this.request;
    const touchesMoved = ([one, other]: [string, string]): boolean => ids.includes(one) || ids.includes(other);
    const { separation } = this.drawing;
    const stuck = separation.separate({ active: ids, movable, pinned: [...pinned], baseline: before.bounds }).unresolved.filter(touchesMoved);
    if (!stuck.length) {
      return { notes: [], stuck: false };
    }
    const second = separation.separate({ active: ids, movable, pinned: [...fixed], locked: { ids, axes: [...lock] }, baseline: before.bounds });
    if (second.unresolved.some(touchesMoved)) {
      return { notes: [], stuck: true };
    }
    const names = moved.map((shape) => shape.id).join(', ');
    const cleared = stuck.map(([one, other]) => (ids.includes(one) ? other : one)).join(', ');
    return { notes: [`moved ${names} ${lock.includes('x') ? 'down' : 'right'} a little to clear ${cleared}`], stuck: false };
  }

  private fitLabel(shape: PlaneShape, pinned: readonly string[]): void {
    const { label } = shape;
    const frame = this.frames.of(shape);
    if (!frame || !label) {
      return;
    }
    const keep = new Set(pinned);
    const inSubProcess = frame.kind === 'subProcess';
    const over = label.bottom + RoomTrial.LABEL_PAD - frame.bounds.bottom;
    if (over > 0.5) {
      this.drawing.space.makeSpace({ axis: 'y', line: frame.bounds.bottom - 1, delta: Math.ceil(over), keep, ...(inSubProcess ? { within: frame.bounds.copy(), frame: frame.id } : {}) });
    }
    const overRight = label.right + RoomTrial.LABEL_PAD - frame.bounds.right;
    if (overRight > 0.5) {
      const within = this.bandOfFrame(frame);
      this.drawing.space.makeSpace({ axis: 'x', line: frame.bounds.right - 1, delta: Math.ceil(overRight), keep, ...(within ? { within } : {}), ...(inSubProcess ? { frame: frame.id } : {}) });
    }
  }

  private bandOfFrame(frame: PlaneShape): Box | undefined {
    if (frame.kind === 'subProcess' || frame.kind === 'participant') {
      return frame.bounds.copy();
    }
    return frame.poolId ? this.plane.shapes.get(frame.poolId)?.bounds.copy() : undefined;
  }

  private displaced(): DisplacedFrame[] {
    return this.request.references.flatMap((reference) => {
      const frame = this.movedIds.includes(reference.id) ? undefined : this.frameLeft(reference);
      return frame ? [{ reference, frame }] : [];
    });
  }

  private frameLeft(reference: PlaneShape): PlaneShape | undefined {
    const { bounds } = this.request.before;
    const was = bounds.get(reference.id);
    let lost: PlaneShape | undefined;
    for (const frame of this.frames.chain(reference)) {
      const box = bounds.get(frame.id);
      if (!box || !was) {
        continue;
      }
      const left = was.isInside(box) && !reference.bounds.isInside(frame.bounds);
      const pushed = !this.movedFrames.has(frame.id) && (Math.abs(frame.bounds.x - box.x) > 0.5 || Math.abs(frame.bounds.y - box.y) > 0.5);
      if (left || pushed) {
        lost = frame;
      }
    }
    return lost;
  }

  private swallowed(): PlaneShape[] {
    const subProcesses = this.shapes().filter((shape) => shape.kind === 'subProcess' && shape.container);
    return this.request.references.filter((reference) => !this.movedIds.includes(reference.id) && subProcesses.some((subProcess) => this.covers(subProcess, reference)));
  }

  private covers(subProcess: PlaneShape, reference: PlaneShape): boolean {
    const { bounds } = this.request.before;
    if (subProcess.id === reference.id || this.isInside(reference, subProcess.id) || !subProcess.bounds.overlaps(reference.bounds)) {
      return false;
    }
    return !(bounds.get(subProcess.id) ?? subProcess.bounds).overlaps(bounds.get(reference.id) ?? reference.bounds);
  }

  private isInside(shape: PlaneShape, subProcessId: string): boolean {
    let parentId = shape.parentId ?? (shape.hostId ? this.plane.shapes.get(shape.hostId)?.parentId : undefined);
    for (let depth = 0; parentId && depth < RoomTrial.MAX_DEPTH; depth++) {
      if (parentId === subProcessId) {
        return true;
      }
      parentId = this.plane.shapes.get(parentId)?.parentId;
    }
    return shape.hostId === subProcessId;
  }

  private newOverlaps(): Array<[string, string]> {
    const leaves = this.plane.leaves();
    const collided: Array<[string, string]> = [];
    for (const [index, first] of leaves.entries()) {
      for (const second of leaves.slice(index + 1)) {
        const hosted = first.hostId === second.id || second.hostId === first.id;
        if (!hosted && this.newlyOverlap(first, second)) {
          collided.push([first.id, second.id]);
        }
      }
    }
    return [...collided, ...this.newFrameIntrusions(leaves)];
  }

  private newFrameIntrusions(leaves: readonly PlaneShape[]): Array<[string, string]> {
    const subProcesses = this.shapes().filter((shape) => shape.kind === 'subProcess' && shape.container);
    return subProcesses.flatMap((frame) => leaves.filter((leaf) => !this.isInside(leaf, frame.id) && this.newlyOverlap(leaf, frame)).map((leaf): [string, string] => [leaf.id, frame.id]));
  }

  private newlyOverlap(first: PlaneShape, second: PlaneShape): boolean {
    const { bounds } = this.request.before;
    const was = [bounds.get(first.id), bounds.get(second.id)] as const;
    return first.bounds.overlaps(second.bounds) && !(was[0] && was[1] && was[0].overlaps(was[1]));
  }

  private strayed(): StrayShape[] {
    return this.shapes()
      .filter((shape) => shape.kind !== 'participant' && shape.kind !== 'lane')
      .flatMap((shape) => this.framesLeftBy(shape).map((frame) => ({ shape, frame })));
  }

  private framesLeftBy(shape: PlaneShape): PlaneShape[] {
    const { bounds } = this.request.before;
    const was = bounds.get(shape.id);
    if (!was) {
      return [];
    }
    const frameIds = [shape.parentId, shape.hostId ? undefined : shape.laneId, shape.poolId];
    return frameIds.flatMap((id) => {
      const frame = id ? this.plane.shapes.get(id) : undefined;
      const box = frame ? bounds.get(frame.id) : undefined;
      const open = frame && (frame.kind !== 'subProcess' || frame.container);
      return open && box && was.isInside(box) && !shape.bounds.isInside(frame.bounds) ? [frame] : [];
    });
  }

  private shapes(): PlaneShape[] {
    return [...this.plane.shapes.values()];
  }
}
