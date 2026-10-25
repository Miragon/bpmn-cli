import { modelError } from '../shared/utils/errors.js';
import { bottom, containsPoint, copyBox, cx, cy, inside, overlaps, right, type Box, type Point } from '../drawing/utils/geom.js';
import { Frames } from '../drawing/Frames.js';
import { PlaneQuery } from '../drawing/PlaneQuery.js';
import type { DShape, Plane } from '../drawing/types.js';
import { DrawingCheckpoint } from '../drawing/DrawingCheckpoint.js';
import { Drawing } from '../layout/incremental/Drawing.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import { frameWord } from './utils/frames.js';

/** A sub-process has no header: its border is the limit. */
const HEADER_TOLERANCE = 10;

/**
 * Makes room for shapes that place / align moved: refuses moves out of their frame, lets the
 * others give way, and refuses (E_NO_ROOM) when the request no longer holds afterwards.
 */
export class RoomMaker {
  constructor(
    private readonly plane: Plane,
    private readonly drawing: Drawing,
  ) {}

  private laneAt(poolId: string | undefined, p: Point): DShape | undefined {
    let best: DShape | undefined;
    for (const s of this.plane.shapes.values()) {
      if (s.kind !== 'lane' || s.poolId !== poolId || !containsPoint(s.bounds, p)) continue;
      if (!best || s.bounds.width * s.bounds.height < best.bounds.width * best.bounds.height) best = s;
    }
    return best;
  }

  /**
   * The lane / pool the centre would land in, the frame itself when the shape just leaves it,
   * or undefined when it stays. Past the right or last bottom edge is fine: the frame grows.
   */
  private escape(s: DShape, frame: DShape, box: Box): DShape | undefined {
    const inner = Frames.interior(frame, 0);
    const c = { x: cx(box), y: cy(box) };
    // hand drawings sit a few px into the header of a lane or pool
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
   * A sub-process never grows towards a reference outside it: it would be pushed aside by what
   * it then covers and leave its shapes behind.
   */
  checkFrames(shapes: readonly DShape[], dx: number, dy: number, target: string, refs: readonly DShape[] = []): void {
    for (const s of shapes) {
      const frame = Frames.of(this.plane, s);
      if (!frame) continue;
      const unit = this.drawing.unitBox(s);
      const box = { ...unit, x: unit.x + dx, y: unit.y + dy };
      let there = this.escape(s, frame, box);
      const farRef = !there && frame.kind === 'subProcess' && refs.length > 0 && refs.every((r) => r !== frame && !Frames.chain(this.plane, r).includes(frame)) && !inside(box, frame.bounds);
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

  /** A frame that no longer holds the reference, or one pushed away by a frame that grew. */
  private frameLeft(ref: DShape, snap: DrawingSnapshot, movedFrames: ReadonlySet<string>): DShape | undefined {
    const was = snap.bounds.get(ref.id);
    let lost: DShape | undefined;
    for (const f of Frames.chain(this.plane, ref)) {
      const fb = snap.bounds.get(f.id);
      if (!fb || !was) continue;
      const left = inside(was, fb) && !inside(ref.bounds, f.bounds);
      const pushed = !movedFrames.has(f.id) && (Math.abs(f.bounds.x - fb.x) > 0.5 || Math.abs(f.bounds.y - fb.y) > 0.5);
      if (left || pushed) lost = f; // the outermost one: a pool pushed away takes its lanes along
    }
    return lost;
  }

  private newOverlaps(snap: DrawingSnapshot): Array<[string, string]> {
    const leaves = [...this.plane.shapes.values()].filter(PlaneQuery.isLeaf);
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

  private leafIds(): string[] {
    return [...this.plane.shapes.values()].filter((s) => PlaneQuery.isLeaf(s) || (s.kind === 'subProcess' && s.container)).map((s) => s.id);
  }

  private fitLabel(s: DShape, keep: string[]): void {
    const frame = Frames.of(this.plane, s);
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
   * Moved shapes stay and the others give way, first with the references fixed, else with them
   * movable too; moved shapes still in conflict give way along the axis `lock` leaves free.
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
    const movedFrames = new Set(moved.flatMap((s) => Frames.chain(this.plane, s).map((f) => f.id)));
    const displaced = (): Array<{ ref: DShape; frame: DShape }> =>
      refs.flatMap((f) => {
        const frame = ids.includes(f.id) ? undefined : this.frameLeft(f, snap, movedFrames);
        return frame ? [{ ref: f, frame }] : [];
      });
    const swallowed = (): DShape[] =>
      refs.filter(
        (f) =>
          !ids.includes(f.id) &&
          [...this.plane.shapes.values()].some((c) => c.kind === 'subProcess' && c.container && c.id !== f.id && !within(f, c.id) && overlaps(c.bounds, f.bounds) && !overlaps(snap.bounds.get(c.id) ?? c.bounds, snap.bounds.get(f.id) ?? f.bounds)),
      );
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
    const start = new DrawingCheckpoint(this.plane);
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
