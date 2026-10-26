import { modelError } from '../../document/utils/errors.js';
import { bottom, containsPoint, copyBox, cx, cy, inside, overlaps, right, type Box, type Point } from '../utils/geom.js';
import { Frames } from '../di/Frames.js';
import { PlaneQuery } from '../di/PlaneQuery.js';
import type { DShape, Plane } from '../di/types.js';
import { DrawingCheckpoint } from '../di/DrawingCheckpoint.js';
import { Drawing } from '../layout/incremental/Drawing.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import { frameWord } from '../utils/frames.js';

/** A sub-process has no header: its border is the limit. */
const HEADER_TOLERANCE = 10;

/**
 * Makes room for shapes that place / align moved: refuses moves out of their frame, lets the
 * others give way, and refuses (E_NO_ROOM) when the request no longer holds afterwards.
 */
export class RoomService {
  constructor(
    private readonly plane: Plane,
    private readonly drawing: Drawing,
  ) {}

  private laneAt(poolId: string | undefined, point: Point): DShape | undefined {
    let best: DShape | undefined;
    for (const lane of this.plane.shapes.values()) {
      if (lane.kind !== 'lane' || lane.poolId !== poolId || !containsPoint(lane.bounds, point)) continue;
      if (!best || lane.bounds.width * lane.bounds.height < best.bounds.width * best.bounds.height) best = lane;
    }
    return best;
  }

  /**
   * The lane / pool the centre would land in, the frame itself when the shape just leaves it,
   * or undefined when it stays. Past the right or last bottom edge is fine: the frame grows.
   */
  private escape(shape: DShape, frame: DShape, box: Box): DShape | undefined {
    const inner = Frames.interior(frame, 0);
    const center = { x: cx(box), y: cy(box) };
    // hand drawings sit a few px into the header of a lane or pool
    const tol = frame.kind === 'lane' || frame.kind === 'participant' ? HEADER_TOLERANCE : 0.5;
    if (box.x < inner.x - tol || box.y < frame.bounds.y - 0.5) return frame;
    const otherPool = [...this.plane.shapes.values()].find((pool) => pool.kind === 'participant' && pool.id !== shape.poolId && containsPoint(pool.bounds, center));
    if (otherPool) return otherPool;
    if (frame.kind !== 'lane') return undefined;
    const there = this.laneAt(shape.poolId, center);
    if (there) return there.id === frame.id ? undefined : there;
    // below the lane (and right of the pool): only the last lane of the pool may grow downwards
    const below = center.y >= bottom(frame.bounds) && [...this.plane.shapes.values()].some((lane) => lane.kind === 'lane' && lane.poolId === shape.poolId && lane.bounds.y >= bottom(frame.bounds) - 1);
    return below ? frame : undefined;
  }

  /**
   * A sub-process never grows towards a reference outside it: it would be pushed aside by what
   * it then covers and leave its shapes behind.
   */
  checkFrames(shapes: readonly DShape[], dx: number, dy: number, target: string, refs: readonly DShape[] = []): void {
    for (const shape of shapes) {
      const frame = Frames.of(this.plane, shape);
      if (!frame) continue;
      const unit = this.drawing.unitBox(shape);
      const box = { ...unit, x: unit.x + dx, y: unit.y + dy };
      let there = this.escape(shape, frame, box);
      const farRef = !there && frame.kind === 'subProcess' && refs.length > 0 && refs.every((ref) => ref !== frame && !Frames.chain(this.plane, ref).includes(frame)) && !inside(box, frame.bounds);
      if (farRef) there = frame;
      if (!there) continue;
      let hint: string;
      if (frame.kind === 'lane') {
        hint =
          there.kind === 'lane' && there !== frame
            ? `That position is in lane ${there.id}. Assign the lane first (\`bpmn move <file> ${shape.id} --lane ${there.id}\`, in a batch a move op with "lane" before this op), or make room in ${frame.id} first (\`bpmn space <file> --below ${frame.id}\`).`
            : there === frame && cy(box) >= bottom(frame.bounds)
              ? `That position is below lane ${frame.id}, in no lane of its pool (another lane follows underneath ${frame.id}): pick a reference inside lane ${frame.id}, make room in it first (\`bpmn space <file> --below ${frame.id}\`), or assign another lane first (\`bpmn move <file> ${shape.id} --lane <laneId>\`).`
              : `Pick a reference inside lane ${frame.id}, or assign another lane first (\`bpmn move <file> ${shape.id} --lane <laneId>\`).`;
      } else if (frame.kind === 'subProcess') {
        hint = farRef
          ? `The reference lies outside sub-process ${frame.id}, which would have to grow out to it: pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${shape.id} --in <scopeId>\`).`
          : `Pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${shape.id} --in <scopeId>\`).`;
      } else {
        hint = `Nodes cannot leave their pool; pick a reference inside ${frame.id}.`;
      }
      throw modelError('E_LEAVES_CONTAINER', `Placing ${shape.id} ${target} would move it out of its ${frameWord(frame)} ${frame.id}${there !== frame ? ` (into ${there.kind === 'participant' ? 'pool' : 'lane'} ${there.id})` : ''}`, { element: shape.id, related: [frame.id, ...(there !== frame ? [there.id] : [])], hint });
    }
  }

  /** A frame that no longer holds the reference, or one pushed away by a frame that grew. */
  private frameLeft(ref: DShape, snap: DrawingSnapshot, movedFrames: ReadonlySet<string>): DShape | undefined {
    const was = snap.bounds.get(ref.id);
    let lost: DShape | undefined;
    for (const frame of Frames.chain(this.plane, ref)) {
      const fb = snap.bounds.get(frame.id);
      if (!fb || !was) continue;
      const left = inside(was, fb) && !inside(ref.bounds, frame.bounds);
      const pushed = !movedFrames.has(frame.id) && (Math.abs(frame.bounds.x - fb.x) > 0.5 || Math.abs(frame.bounds.y - fb.y) > 0.5);
      if (left || pushed) lost = frame; // the outermost one: a pool pushed away takes its lanes along
    }
    return lost;
  }

  private newOverlaps(snap: DrawingSnapshot): Array<[string, string]> {
    const leaves = [...this.plane.shapes.values()].filter(PlaneQuery.isLeaf);
    const out: Array<[string, string]> = [];
    for (let outerIndex = 0; outerIndex < leaves.length; outerIndex++) {
      for (let innerIndex = outerIndex + 1; innerIndex < leaves.length; innerIndex++) {
        const first = leaves[outerIndex]!;
        const second = leaves[innerIndex]!;
        if (first.hostId === second.id || second.hostId === first.id || !overlaps(first.bounds, second.bounds)) continue;
        const was = [snap.bounds.get(first.id), snap.bounds.get(second.id)];
        if (was[0] && was[1] && overlaps(was[0], was[1])) continue;
        out.push([first.id, second.id]);
      }
    }
    return out;
  }

  private leafIds(): string[] {
    return [...this.plane.shapes.values()].filter((shape) => PlaneQuery.isLeaf(shape) || (shape.kind === 'subProcess' && shape.container)).map((shape) => shape.id);
  }

  private fitLabel(shape: DShape, keep: string[]): void {
    const frame = Frames.of(this.plane, shape);
    if (!frame || !shape.label) return;
    const sub = frame.kind === 'subProcess';
    const over = bottom(shape.label) + 5 - bottom(frame.bounds);
    if (over > 0.5) this.drawing.makeSpace({ axis: 'y', line: bottom(frame.bounds) - 1, delta: Math.ceil(over), keep: new Set(keep), ...(sub ? { within: copyBox(frame.bounds), frame: frame.id } : {}) });
    const overRight = right(shape.label) + 5 - right(frame.bounds);
    if (overRight <= 0.5) return;
    const pool = frame.kind === 'participant' ? frame : frame.poolId ? this.plane.shapes.get(frame.poolId) : undefined;
    this.drawing.makeSpace({ axis: 'x', line: right(frame.bounds) - 1, delta: Math.ceil(overRight), keep: new Set(keep), ...(sub ? { within: copyBox(frame.bounds), frame: frame.id } : pool ? { within: copyBox(pool.bounds) } : {}) });
  }

  /**
   * Moved shapes stay and the others give way, first with the references fixed, else with them
   * movable too; moved shapes still in conflict give way along the axis `lock` leaves free.
   */
  makeRoom(moved: readonly DShape[], refs: readonly DShape[], snap: DrawingSnapshot, notes: string[], target: string, holds: () => boolean, lock: ReadonlyArray<'x' | 'y'>): void {
    const ids = moved.flatMap((shape) => [shape.id, ...[...this.plane.shapes.values()].filter((boundary) => boundary.hostId === shape.id).map((boundary) => boundary.id)]);
    const refIds = refs.map((ref) => ref.id).filter((id) => !ids.includes(id));
    const all = this.leafIds();
    const within = (shape: DShape, subId: string): boolean => {
      let parentId = shape.parentId ?? (shape.hostId ? this.plane.shapes.get(shape.hostId)?.parentId : undefined);
      for (let depth = 0; parentId && depth < 20; depth++) {
        if (parentId === subId) return true;
        parentId = this.plane.shapes.get(parentId)?.parentId;
      }
      return shape.hostId === subId;
    };
    const movedFrames = new Set(moved.flatMap((shape) => Frames.chain(this.plane, shape).map((frame) => frame.id)));
    const displaced = (): Array<{ ref: DShape; frame: DShape }> =>
      refs.flatMap((ref) => {
        const frame = ids.includes(ref.id) ? undefined : this.frameLeft(ref, snap, movedFrames);
        return frame ? [{ ref, frame }] : [];
      });
    const swallowed = (): DShape[] =>
      refs.filter(
        (ref) =>
          !ids.includes(ref.id) &&
          [...this.plane.shapes.values()].some((sub) => sub.kind === 'subProcess' && sub.container && sub.id !== ref.id && !within(ref, sub.id) && overlaps(sub.bounds, ref.bounds) && !overlaps(snap.bounds.get(sub.id) ?? sub.bounds, snap.bounds.get(ref.id) ?? ref.bounds)),
      );
    const strayed = (): Array<{ shape: DShape; frame: DShape }> => {
      const out: Array<{ shape: DShape; frame: DShape }> = [];
      for (const shape of this.plane.shapes.values()) {
        if (shape.kind === 'participant' || shape.kind === 'lane') continue;
        const was = snap.bounds.get(shape.id);
        if (!was) continue;
        for (const fid of [shape.parentId, shape.hostId ? undefined : shape.laneId, shape.poolId]) {
          const frame = fid ? this.plane.shapes.get(fid) : undefined;
          const fb = frame ? snap.bounds.get(frame.id) : undefined;
          if (!frame || !fb || (frame.kind === 'subProcess' && !frame.container)) continue;
          if (inside(was, fb) && !inside(shape.bounds, frame.bounds)) out.push({ shape, frame });
        }
      }
      return out;
    };
    const attempt = (fixed: string[]): { ok: boolean; notes: string[]; swallowed: DShape[]; displaced: Array<{ ref: DShape; frame: DShape }>; collided: Array<[string, string]>; strayed: Array<{ shape: DShape; frame: DShape }> } => {
      const out: string[] = [];
      for (const shape of moved) {
        this.drawing.fitInFrame(shape.id, 15, undefined, [...ids, ...fixed]);
        this.fitLabel(shape, [...ids, ...fixed]);
      }
      const first = this.drawing.separate({ active: ids, movable: all, pinned: [...ids, ...fixed], baseline: snap.bounds });
      const stuck = first.unresolved.filter(([one, other]) => ids.includes(one) || ids.includes(other));
      let left = false;
      if (stuck.length) {
        // the moved shapes give way along the axis the request leaves free
        const second = this.drawing.separate({ active: ids, movable: all, pinned: fixed, locked: { ids, axes: lock }, baseline: snap.bounds });
        left = second.unresolved.some(([one, other]) => ids.includes(one) || ids.includes(other));
        if (!left) out.push(`moved ${moved.map((shape) => shape.id).join(', ')} ${lock.includes('x') ? 'down' : 'right'} a little to clear ${stuck.map(([one, other]) => (ids.includes(one) ? other : one)).join(', ')}`);
      }
      const covered = swallowed();
      const gone = displaced();
      const collided = this.newOverlaps(snap);
      const stray = strayed();
      return { ok: !covered.length && !gone.length && !collided.length && !stray.length && !left && holds(), notes: out, swallowed: covered, displaced: gone, collided, strayed: stray };
    };
    const start = new DrawingCheckpoint(this.plane);
    let result = attempt(refIds);
    if (!result.ok && refIds.length) {
      start.restore();
      result = attempt([]);
    }
    if (!result.ok) {
      const names = moved.map((shape) => shape.id).join(', ');
      const why = result.swallowed.length
        ? `its frame would have to grow over ${result.swallowed.map((frame) => frame.id).join(', ')}`
        : result.displaced.length
          ? `its frame would have to push away ${result.displaced.map((pushed) => `${frameWord(pushed.frame)} ${pushed.frame.id} of ${pushed.ref.id}`).join(', ')}`
          : result.collided.length
            ? `making room would put ${result.collided.map(([first, second]) => `${first} onto ${second}`).join(', ')}`
            : result.strayed.length
              ? `making room would take ${result.strayed.map((stray) => `${stray.shape.id} out of its ${frameWord(stray.frame)} ${stray.frame.id}`).join(', ')}`
              : 'what is in the way cannot give way without moving the reference or the shapes off it';
      throw modelError('E_NO_ROOM', `There is no room to put ${names} ${target}: ${why}`, {
        element: moved[0]!.id,
        related: result.swallowed.length
          ? result.swallowed.map((frame) => frame.id)
          : result.displaced.length
            ? result.displaced.flatMap((pushed) => [pushed.ref.id, pushed.frame.id])
            : result.collided.length
              ? [...new Set(result.collided.flat())]
              : result.strayed.length
                ? [...new Set(result.strayed.flatMap((stray) => [stray.shape.id, stray.frame.id]))]
                : refs.map((ref) => ref.id),
        hint: 'Use a reference inside the same lane / sub-process, or make room first (`bpmn space <file> --after <id>` / `--below <id>`) and place it again.',
      });
    }
    notes.push(...result.notes);
  }
}
