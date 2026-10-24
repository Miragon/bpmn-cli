import { modelError } from '../shared/utils/errors.js';
import { bottom, containsPoint, copyBox, cx, cy, inside, overlaps, right, type Box, type Point } from '../diagram/utils/geom.js';
import { frameInterior, frameOf, isLeaf } from '../diagram/utils/plane.js';
import type { DShape, Plane } from '../diagram/types.js';
import { PlaneCheckpoint } from '../diagram/PlaneCheckpoint.js';
import { Drawing } from '../diagram/Drawing.js';
import { DrawingSnapshot } from '../diagram/DrawingSnapshot.js';
import { frameWord, framesOf, inFrameOf } from './utils/frames.js';

/** how far a moved shape may reach into the header of its lane / pool (a sub-process has none: its border is the limit) */
const HEADER_TOLERANCE = 10;

export class RoomMaker {
  constructor(
    private readonly plane: Plane,
    private readonly drawing: Drawing,
  ) {}

  /** The innermost lane of a pool whose band contains `p`. */
  private laneAt(poolId: string | undefined, p: Point): DShape | undefined {
    let best: DShape | undefined;
    for (const s of this.plane.shapes.values()) {
      if (s.kind !== 'lane' || s.poolId !== poolId || !containsPoint(s.bounds, p)) continue;
      if (!best || s.bounds.width * s.bounds.height < best.bounds.width * best.bounds.height) best = s;
    }
    return best;
  }

  /**
   * Where a moved shape would leave its innermost frame: its box before the
   * frame's start (more than 10 px left of its interior, above its top), its centre in another
   * lane or pool, or below a lane that has a sibling lane underneath. Past the
   * right edge (and the bottom of the last lane / a pool / a sub-process) is
   * fine: the frame grows. Returns the lane / pool the centre would land in,
   * the frame itself when the shape would just leave it, or undefined when it
   * stays.
   */
  private escape(s: DShape, frame: DShape, box: Box): DShape | undefined {
    const inner = frameInterior(frame, 0);
    const c = { x: cx(box), y: cy(box) };
    // a few px into the header of a lane or pool is fine (audit #69: hand drawings sit that close)
    const tol = frame.kind === 'lane' || frame.kind === 'participant' ? HEADER_TOLERANCE : 0.5;
    if (box.x < inner.x - tol || box.y < frame.bounds.y - 0.5) return frame;
    const otherPool = [...this.plane.shapes.values()].find((p) => p.kind === 'participant' && p.id !== s.poolId && containsPoint(p.bounds, c));
    if (otherPool) return otherPool;
    if (frame.kind !== 'lane') return undefined;
    const there = this.laneAt(s.poolId, c);
    if (there) return there.id === frame.id ? undefined : there;
    // below the lane (and right of the pool): only the last lane of the pool may grow downwards
    const below = c.y >= bottom(frame.bounds) && [...this.plane.shapes.values()].some((l) => l.kind === 'lane' && l.poolId === s.poolId && l.bounds.y >= bottom(frame.bounds) - 1);
    return below ? frame : undefined;
  }

  /**
   * Refuses a move that takes a shape out of its innermost frame
   * (E_LEAVES_CONTAINER, see escape). A sub-process grows towards a reference
   * inside it (past its right / bottom edge), never towards one outside it:
   * with every reference (`refs`) outside the shape's sub-process, the shape
   * must land inside the sub-process as it is drawn (a sub-process grown
   * towards a far reference is pushed aside by what it then covers and leaves
   * the shapes it holds behind: outsideSub).
   */
  checkFrames(shapes: readonly DShape[], dx: number, dy: number, target: string, refs: readonly DShape[] = []): void {
    for (const s of shapes) {
      const frame = frameOf(this.plane, s);
      if (!frame) continue;
      const unit = this.drawing.unitBox(s);
      const box = { ...unit, x: unit.x + dx, y: unit.y + dy };
      let there = this.escape(s, frame, box);
      const farRef = !there && frame.kind === 'subProcess' && refs.length > 0 && refs.every((r) => r !== frame && !inFrameOf(this.plane, r, frame)) && !inside(box, frame.bounds);
      if (farRef) there = frame;
      if (!there) continue;
      let hint: string;
      if (frame.kind === 'lane') {
        hint =
          there.kind === 'lane' && there !== frame
            ? `That position is in lane ${there.id}. Assign the lane first (\`bpmn move <file> ${s.id} --lane ${there.id}\`, in a batch a move op with "lane" before this op), or make room in ${frame.id} first (\`bpmn space <file> --below ${frame.id}\`).`
            : there === frame && cy(box) >= bottom(frame.bounds)
              ? `That position is below lane ${frame.id}, in no lane of its pool (another lane follows underneath ${frame.id}): pick a reference inside lane ${frame.id}, make room in it first (\`bpmn space <file> --below ${frame.id}\`), or assign another lane first (\`bpmn move <file> ${s.id} --lane <laneId>\`).`
              : `Pick a reference inside lane ${frame.id}, or assign another lane first (\`bpmn move <file> ${s.id} --lane <laneId>\`).`;
      } else if (frame.kind === 'subProcess') {
        hint = farRef
          ? `The reference lies outside sub-process ${frame.id}, which would have to grow out to it: pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${s.id} --in <scopeId>\`).`
          : `Pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${s.id} --in <scopeId>\`).`;
      } else {
        hint = `Nodes cannot leave their pool; pick a reference inside ${frame.id}.`;
      }
      throw modelError('E_LEAVES_CONTAINER', `Placing ${s.id} ${target} would move it out of its ${frameWord(frame)} ${frame.id}${there !== frame ? ` (into ${there.kind === 'participant' ? 'pool' : 'lane'} ${there.id})` : ''}`, { element: s.id, related: [frame.id, ...(there !== frame ? [there.id] : [])], hint });
    }
  }

  /**
   * The frame a reference lost: one that held it before the op and no longer
   * does, or one holding none of the moved shapes that moved (pushed away by
   * a frame that grew). Undefined when its frames are intact.
   */
  private frameLeft(ref: DShape, snap: DrawingSnapshot, movedFrames: ReadonlySet<string>): DShape | undefined {
    const was = snap.bounds.get(ref.id);
    let lost: DShape | undefined;
    for (const f of framesOf(this.plane, ref)) {
      const fb = snap.bounds.get(f.id);
      if (!fb || !was) continue;
      const left = inside(was, fb) && !inside(ref.bounds, f.bounds);
      const pushed = !movedFrames.has(f.id) && (Math.abs(f.bounds.x - fb.x) > 0.5 || Math.abs(f.bounds.y - fb.y) > 0.5);
      if (left || pushed) lost = f; // the outermost one: a pool pushed away takes its lanes along
    }
    return lost;
  }

  /**
   * Pairs of leaf shapes that overlap now but did not before the op (a
   * boundary event on its own host does not count): making room must never
   * push one shape onto another, e.g. onto a reference that stayed while the
   * shapes around it made room.
   */
  private newOverlaps(snap: DrawingSnapshot): Array<[string, string]> {
    const leaves = [...this.plane.shapes.values()].filter(isLeaf);
    const out: Array<[string, string]> = [];
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i]!;
        const b = leaves[j]!;
        if (a.hostId === b.id || b.hostId === a.id || !overlaps(a.bounds, b.bounds)) continue;
        const was = [snap.bounds.get(a.id), snap.bounds.get(b.id)];
        if (was[0] && was[1] && overlaps(was[0], was[1])) continue;
        out.push([a.id, b.id]);
      }
    }
    return out;
  }

  /** Every leaf shape of a plane (the units separate may push aside). */
  private leafIds(): string[] {
    return [...this.plane.shapes.values()].filter((s) => isLeaf(s) || (s.kind === 'subProcess' && s.container)).map((s) => s.id);
  }

  /**
   * Grows the frame of a moved shape when its external label hangs out at the
   * bottom (lanes below, pools below make room) or at the right (the pool and
   * its lanes get wider; audit #71).
   */
  private fitLabel(s: DShape, keep: string[]): void {
    const frame = frameOf(this.plane, s);
    if (!frame || !s.label) return;
    const sub = frame.kind === 'subProcess';
    const over = bottom(s.label) + 5 - bottom(frame.bounds);
    if (over > 0.5) this.drawing.makeSpace({ axis: 'y', line: bottom(frame.bounds) - 1, delta: Math.ceil(over), keep: new Set(keep), ...(sub ? { within: copyBox(frame.bounds), frame: frame.id } : {}) });
    const overRight = right(s.label) + 5 - right(frame.bounds);
    if (overRight <= 0.5) return;
    const pool = frame.kind === 'participant' ? frame : frame.poolId ? this.plane.shapes.get(frame.poolId) : undefined;
    this.drawing.makeSpace({ axis: 'x', line: right(frame.bounds) - 1, delta: Math.ceil(overRight), keep: new Set(keep), ...(sub ? { within: copyBox(frame.bounds), frame: frame.id } : pool ? { within: copyBox(pool.bounds) } : {}) });
  }

  /**
   * Shapes moved on request stay; the others give way (diagram/Separation.ts). First the
   * references stay too; when the request then does not hold (`holds`, e.g.
   * "same row as R"), or two shapes ended up on each other, the references may
   * give way as well (a row reference sliding right keeps its row). When a
   * conflict with a moved shape is left, the moved shapes may give way a
   * little (noted). Refused (E_NO_ROOM, the batch fails) when the request holds
   * in neither way, a new overlap is left, or a sub-process grew over a
   * reference.
   */
  makeRoom(moved: readonly DShape[], refs: readonly DShape[], snap: DrawingSnapshot, notes: string[], target: string, holds: () => boolean, lock: ReadonlyArray<'x' | 'y'>): void {
    const ids = moved.flatMap((s) => [s.id, ...[...this.plane.shapes.values()].filter((b) => b.hostId === s.id).map((b) => b.id)]);
    const refIds = refs.map((f) => f.id).filter((id) => !ids.includes(id));
    const all = this.leafIds();
    const within = (f: DShape, subId: string): boolean => {
      let p = f.parentId ?? (f.hostId ? this.plane.shapes.get(f.hostId)?.parentId : undefined);
      for (let i = 0; p && i < 20; i++) {
        if (p === subId) return true;
        p = this.plane.shapes.get(p)?.parentId;
      }
      return f.hostId === subId;
    };
    // a reference pushed out of a frame that held it, or whose own frame (one the moved shapes are not in) was pushed away
    const movedFrames = new Set(moved.flatMap((s) => framesOf(this.plane, s).map((f) => f.id)));
    const displaced = (): Array<{ ref: DShape; frame: DShape }> =>
      refs.flatMap((f) => {
        const frame = ids.includes(f.id) ? undefined : this.frameLeft(f, snap, movedFrames);
        return frame ? [{ ref: f, frame }] : [];
      });
    // a reference drawn over by a sub-process that grew
    const swallowed = (): DShape[] =>
      refs.filter(
        (f) =>
          !ids.includes(f.id) &&
          [...this.plane.shapes.values()].some((c) => c.kind === 'subProcess' && c.container && c.id !== f.id && !within(f, c.id) && overlaps(c.bounds, f.bounds) && !overlaps(snap.bounds.get(c.id) ?? c.bounds, snap.bounds.get(f.id) ?? f.bounds)),
      );
    // a shape out of a frame that held it before the op (its expanded sub-process, its lane, its pool): outsideSub / outsideLane / outsidePool
    const strayed = (): Array<{ shape: DShape; frame: DShape }> => {
      const out: Array<{ shape: DShape; frame: DShape }> = [];
      for (const sh of this.plane.shapes.values()) {
        if (sh.kind === 'participant' || sh.kind === 'lane') continue;
        const was = snap.bounds.get(sh.id);
        if (!was) continue;
        for (const fid of [sh.parentId, sh.hostId ? undefined : sh.laneId, sh.poolId]) {
          const f = fid ? this.plane.shapes.get(fid) : undefined;
          const fb = f ? snap.bounds.get(f.id) : undefined;
          if (!f || !fb || (f.kind === 'subProcess' && !f.container)) continue;
          if (inside(was, fb) && !inside(sh.bounds, f.bounds)) out.push({ shape: sh, frame: f });
        }
      }
      return out;
    };
    const attempt = (fixed: string[]): { ok: boolean; notes: string[]; swallowed: DShape[]; displaced: Array<{ ref: DShape; frame: DShape }>; collided: Array<[string, string]>; strayed: Array<{ shape: DShape; frame: DShape }> } => {
      const out: string[] = [];
      for (const s of moved) {
        this.drawing.fitInFrame(s.id, 15, undefined, [...ids, ...fixed]);
        this.fitLabel(s, [...ids, ...fixed]);
      }
      const first = this.drawing.separate({ active: ids, movable: all, pinned: [...ids, ...fixed], baseline: snap.bounds });
      const stuck = first.unresolved.filter(([a, b]) => ids.includes(a) || ids.includes(b));
      let left = false;
      if (stuck.length) {
        // the moved shapes give way along the axis the request leaves free
        const second = this.drawing.separate({ active: ids, movable: all, pinned: fixed, locked: { ids, axes: lock }, baseline: snap.bounds });
        left = second.unresolved.some(([a, b]) => ids.includes(a) || ids.includes(b));
        if (!left) out.push(`moved ${moved.map((s) => s.id).join(', ')} ${lock.includes('x') ? 'down' : 'right'} a little to clear ${stuck.map(([a, b]) => (ids.includes(a) ? b : a)).join(', ')}`);
      }
      const sw = swallowed();
      const gone = displaced();
      const collided = this.newOverlaps(snap);
      const stray = strayed();
      return { ok: !sw.length && !gone.length && !collided.length && !stray.length && !left && holds(), notes: out, swallowed: sw, displaced: gone, collided, strayed: stray };
    };
    const start = new PlaneCheckpoint(this.plane);
    let r = attempt(refIds);
    if (!r.ok && refIds.length) {
      start.restore();
      r = attempt([]);
    }
    if (!r.ok) {
      const names = moved.map((s) => s.id).join(', ');
      const why = r.swallowed.length
        ? `its frame would have to grow over ${r.swallowed.map((f) => f.id).join(', ')}`
        : r.displaced.length
          ? `its frame would have to push away ${r.displaced.map((d) => `${frameWord(d.frame)} ${d.frame.id} of ${d.ref.id}`).join(', ')}`
          : r.collided.length
            ? `making room would put ${r.collided.map(([a, b]) => `${a} onto ${b}`).join(', ')}`
            : r.strayed.length
              ? `making room would take ${r.strayed.map((x) => `${x.shape.id} out of its ${frameWord(x.frame)} ${x.frame.id}`).join(', ')}`
              : 'what is in the way cannot give way without moving the reference or the shapes off it';
      throw modelError('E_NO_ROOM', `There is no room to put ${names} ${target}: ${why}`, {
        element: moved[0]!.id,
        related: r.swallowed.length
          ? r.swallowed.map((f) => f.id)
          : r.displaced.length
            ? r.displaced.flatMap((d) => [d.ref.id, d.frame.id])
            : r.collided.length
              ? [...new Set(r.collided.flat())]
              : r.strayed.length
                ? [...new Set(r.strayed.flatMap((x) => [x.shape.id, x.frame.id]))]
                : refs.map((f) => f.id),
        hint: 'Use a reference inside the same lane / sub-process, or make room first (`bpmn space <file> --after <id>` / `--below <id>`) and place it again.',
      });
    }
    notes.push(...r.notes);
  }
}
