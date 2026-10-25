import { modelError } from '../shared/utils/errors.js';
import { is, type El } from '../model/utils/moddle.js';
import type { PlaceOp } from '../ops/types.js';
import { bottom, copyBox, cx, cy, inside, overlaps, right, type Box, type Point } from '../drawing/utils/geom.js';
import { Frames } from '../drawing/Frames.js';
import { PlaneQuery } from '../drawing/PlaneQuery.js';
import { idOf, raw, rawList } from '../drawing/utils/raw.js';
import type { DShape, Plane, Side } from '../drawing/types.js';
import { attachedSide } from '../drawing/utils/sides.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { FormatOps } from './FormatOps.js';
import { frameWord, outermost, unique } from './utils/frames.js';

const CLEAR = 20;

/**
 * The `place` op: moves the ids as one rigid group onto the row and / or column of a reference,
 * or with `side` moves a boundary event to the other border of its host.
 */
export class PlaceAction {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: PlaceOp,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  run(): string[] {
    if (this.op.side) return this.boundarySide(this.op.ids?.[0] ?? '', this.op.side);
    const items = unique(this.op.ids ?? []).map((id) => this.ops.movableShape(id));
    const { plane, shape: ref } = items[0]!;
    for (const it of items) this.ops.samePlane(plane, it.plane, it.shape.id, ref.id);
    const group = outermost(plane, items.map((i) => i.shape));
    const sp = PlaneQuery.spacingOf(plane);
    const refUnit = this.ops.drawing(plane).unitBox(ref);
    const fixed: DShape[] = [];
    const target = (id: string): { shape: DShape; unit: Box } => {
      const t = this.ops.drawnShape(id);
      this.ops.samePlane(plane, t.plane, ref.id, id);
      fixed.push(t.shape);
      return { shape: t.shape, unit: t.shape.container ? t.shape.bounds : this.ops.drawing(plane).unitBox(t.shape) };
    };
    let dx = 0;
    let dy = 0;
    const parts: string[] = [];
    if (this.op.rowOf) {
      dy = cy(target(this.op.rowOf).shape.bounds) - cy(ref.bounds);
      parts.push(`in the row of ${this.op.rowOf}`);
    } else if (this.op.below) {
      const t = target(this.op.below);
      const top = refUnit.y - ref.bounds.y;
      const want = Math.max(cy(t.shape.bounds) + sp.row, bottom(t.unit) + CLEAR - top + ref.bounds.height / 2);
      dy = want - cy(ref.bounds);
      parts.push(`below ${this.op.below}`);
    } else if (this.op.above) {
      const t = target(this.op.above);
      const below = bottom(refUnit) - bottom(ref.bounds);
      const want = Math.min(cy(t.shape.bounds) - sp.row, t.unit.y - CLEAR - below - ref.bounds.height / 2);
      dy = want - cy(ref.bounds);
      parts.push(`above ${this.op.above}`);
    }
    if (this.op.columnOf) {
      dx = cx(target(this.op.columnOf).shape.bounds) - cx(ref.bounds);
      parts.push(`in the column of ${this.op.columnOf}`);
    } else if (this.op.after) {
      dx = right(target(this.op.after).unit) + sp.gap - refUnit.x;
      parts.push(`after ${this.op.after}`);
    } else if (this.op.before) {
      dx = target(this.op.before).unit.x - sp.gap - right(refUnit);
      parts.push(`before ${this.op.before}`);
    }
    dx = Math.round(dx);
    dy = Math.round(dy);
    // a reference that is one of the moved shapes' own frames: the shapes cannot go beside it
    for (const t of fixed) {
      if (!t.container) continue;
      for (const s of group) {
        if (!Frames.chain(plane, s).includes(t)) continue;
        const u = this.ops.drawing(plane).unitBox(s);
        if (inside({ ...u, x: u.x + dx, y: u.y + dy }, t.bounds)) continue;
        throw modelError('E_LEAVES_CONTAINER', `Placing ${s.id} ${parts.join(' and ')} would move it out of its ${frameWord(t)} ${t.id}`, {
          element: s.id,
          related: [t.id],
          hint: `${t.id} holds ${s.id}: pick a reference inside it, or move the node out of it first (\`bpmn move <file> ${s.id} --in <scopeId>\` / \`--lane <laneId>\`).`,
        });
      }
    }
    this.ops.room(plane).checkFrames(group, dx, dy, parts.join(' and '), fixed);
    if (!dx && !dy) {
      this.notes.push(`${ref.id} is already there`);
      return [];
    }
    for (const s of group) this.ops.drawing(plane).shift(s.id, dx, dy);
    const unit = (s: DShape): Box => (s.container ? s.bounds : this.ops.drawing(plane).unitBox(s));
    const shape = (id: string): DShape => plane.shapes.get(id)!;
    const holds = (): boolean => {
      const r = this.ops.drawing(plane).unitBox(ref);
      const rowOk = this.op.rowOf ? Math.abs(cy(ref.bounds) - cy(shape(this.op.rowOf).bounds)) <= 1 : this.op.below ? r.y >= bottom(unit(shape(this.op.below))) - 1 : this.op.above ? bottom(r) <= unit(shape(this.op.above)).y + 1 : true;
      const colOk = this.op.columnOf ? Math.abs(cx(ref.bounds) - cx(shape(this.op.columnOf).bounds)) <= 1 : this.op.after ? r.x >= right(unit(shape(this.op.after))) - 1 : this.op.before ? right(r) <= unit(shape(this.op.before)).x + 1 : true;
      return rowOk && colOk;
    };
    const lock: Array<'x' | 'y'> = [...(this.op.columnOf || this.op.after || this.op.before ? ['x' as const] : []), ...(this.op.rowOf || this.op.below || this.op.above ? ['y' as const] : [])];
    this.ops.room(plane).makeRoom(group, fixed, this.snap, this.notes, parts.join(' and '), holds, lock);
    return this.ops.drawing(plane).settle(this.snap);
  }

  /**
   * The nodes only the event leads to, beyond the host's `side` border in the host's own frame.
   * A node in another lane keeps its place: mirrored, it would leave its lane.
   */
  private exceptionPath(plane: Plane, event: DShape, host: DShape, side: Side): DShape[] {
    const home = Frames.of(plane, host);
    const beyond = (b: Box): boolean => (side === 'bottom' ? b.y >= bottom(host.bounds) - 0.5 : side === 'top' ? bottom(b) <= host.bounds.y + 0.5 : false);
    const flowsOf = (id: string, prop: 'incoming' | 'outgoing'): El[] => rawList(this.ops.sem.byId.get(id), prop).filter((f) => is(f, 'bpmn:SequenceFlow'));
    const path: DShape[] = [];
    const inPath = new Set([event.id]);
    const queue = [event.id];
    while (queue.length) {
      for (const f of flowsOf(queue.shift()!, 'outgoing')) {
        const n = plane.shapes.get(idOf(raw(f, 'targetRef')) ?? '');
        if (!n || inPath.has(n.id) || n.id === host.id || !PlaneQuery.isLeaf(n) || n.kind === 'boundary' || !beyond(n.bounds) || Frames.of(plane, n) !== home) continue;
        if (!flowsOf(n.id, 'incoming').every((g) => inPath.has(idOf(raw(g, 'sourceRef')) ?? ''))) continue;
        inPath.add(n.id);
        path.push(n);
        queue.push(n.id);
      }
    }
    return path;
  }

  /**
   * Moves the event to the free spot nearest its centre on the other border; its exception path
   * follows, mirrored about the host's centre row, with room made in the frame first.
   */
  private boundarySide(id: string, side: 'top' | 'bottom'): string[] {
    const { plane, shape: event } = this.ops.drawnShape(id);
    const host = event.hostId ? plane.shapes.get(event.hostId) : undefined;
    if (event.kind !== 'boundary' || !host) {
      throw modelError('E_WRONG_KIND', `"${id}" is ${event.kind === 'boundary' ? 'a boundary event without a drawn host' : `a ${event.kind}`}: side moves a boundary event to a border of its host`, {
        element: id,
        hint: 'Give the boundary event (`bpmn show <file> <hostId>` lists them); other shapes take a row and / or a column: --row-of, --below, --above, --column-of, --after, --before.',
      });
    }
    const from = attachedSide(event.bounds, host.bounds);
    if (from === side) {
      this.notes.push(`${id} is already on the ${side} border of ${host.id}`);
      return [];
    }
    const path = from === 'top' || from === 'bottom' ? this.exceptionPath(plane, event, host, from) : [];
    const mirror = (n: DShape): number => Math.round(2 * cy(host.bounds) - 2 * cy(n.bounds));
    const frame = Frames.of(plane, host);
    if (side === 'top' && path.length && frame) {
      const same = path.filter((n) => Frames.of(plane, n) === frame);
      const top = Math.min(...same.map((n) => this.ops.drawing(plane).unitBox(n).y + mirror(n)));
      const deficit = Math.ceil(Frames.interior(frame, 15).y - top);
      if (same.length && deficit > 0) {
        const sub = frame.kind === 'subProcess';
        this.ops.drawing(plane).makeSpace({ axis: 'y', line: frame.bounds.y + 1, delta: deficit, anchors: [host.id], ...(sub ? { frame: frame.id, within: copyBox(frame.bounds) } : {}) });
        this.notes.push(`made ${deficit} px of room above ${host.id} in its ${frameWord(frame)} ${frame.id}`);
      }
    }
    // a pool, a sub-process and the last lane grow on their own; other lanes do not
    if (side === 'bottom' && path.length && frame?.kind === 'lane' && [...plane.shapes.values()].some((l) => l.kind === 'lane' && l !== frame && l.poolId === frame.poolId && l.bounds.y >= bottom(frame.bounds) - 1)) {
      const same = path.filter((n) => Frames.of(plane, n) === frame);
      const low = Math.max(...same.map((n) => bottom(this.ops.drawing(plane).unitBox(n)) + mirror(n)));
      const deficit = Math.ceil(low - bottom(Frames.interior(frame, 15)));
      if (same.length && deficit > 0) {
        this.ops.drawing(plane).makeSpace({ axis: 'y', line: bottom(frame.bounds) - 1, delta: deficit, anchors: [frame.id] });
        this.notes.push(`made ${deficit} px of room below ${host.id} in its lane ${frame.id}`);
      }
    }
    const hb = host.bounds;
    const size = { width: event.bounds.width, height: event.bounds.height };
    const y = Math.round((side === 'top' ? hb.y : bottom(hb)) - size.height / 2);
    const others = [...plane.shapes.values()].filter((b) => b.hostId === host.id && b.id !== id).map((b) => b.bounds);
    const docks: Point[] = [];
    for (const e of plane.edges.values()) {
      if (e.points.length < 2 || e.sourceId === id || e.targetId === id) continue;
      if (e.sourceId === host.id) docks.push(e.points[0]!);
      if (e.targetId === host.id) docks.push(e.points[e.points.length - 1]!);
    }
    const free = (b: Box): boolean => !others.some((o) => overlaps(o, b, 4)) && !docks.some((p) => p.x > b.x - 4 && p.x < right(b) + 4 && p.y > b.y - 4 && p.y < bottom(b) + 4);
    // else a spot reaching over a corner: hand drawings put a third event there
    let spot: Box | undefined;
    for (const [lo, hi] of [
      [hb.x + size.width / 2, right(hb) - size.width / 2],
      [hb.x - size.width / 2 + 4, right(hb) + size.width / 2 - 4],
    ] as const) {
      const start = Math.min(hi, Math.max(lo, cx(event.bounds)));
      for (let d = 0; !spot && d <= hb.width; d += 4) {
        for (const c of d ? [start + d, start - d] : [start]) {
          const b = { x: Math.round(c - size.width / 2), y, ...size };
          if (c >= lo - 0.5 && c <= hi + 0.5 && free(b)) {
            spot = b;
            break;
          }
        }
      }
      if (spot) break;
    }
    if (!spot) {
      throw modelError('E_NO_ROOM', `There is no room for ${id} on the ${side} border of ${host.id}: other boundary events and docking connections take it`, {
        element: id,
        related: [host.id],
        hint: `Move another boundary event of ${host.id} first, or route the connections docking there to another side (\`bpmn route <file> <flowId> --entry left\`).`,
      });
    }
    const dx = spot.x - event.bounds.x;
    const dy = spot.y - event.bounds.y;
    event.bounds = { ...event.bounds, x: spot.x, y: spot.y };
    if (event.label) {
      event.label.x += dx;
      event.label.y += dy;
    }
    const shifts = path.map((n) => ({ n, dy: mirror(n) }));
    for (const { n, dy: ny } of shifts) this.ops.room(plane).checkFrames([n], 0, ny, `on the ${side} side of ${host.id}`, [host]);
    for (const { n, dy: ny } of shifts) this.ops.drawing(plane).shift(n.id, 0, ny);
    const holds = (): boolean => attachedSide(event.bounds, host.bounds) === side && path.every((n) => (side === 'top' ? bottom(n.bounds) <= hb.y : n.bounds.y >= bottom(hb)));
    if (path.length) this.ops.room(plane).makeRoom(path, [host], this.snap, this.notes, `on the ${side} side of ${host.id}`, holds, ['y']);
    if (event.label) this.ops.drawing(plane).placeShapeLabel(event);
    const rerouted = this.ops.drawing(plane).settle(this.snap);
    for (const e of plane.edges.values()) {
      if (e.sourceId !== id || rerouted.includes(e.id)) continue;
      if (this.ops.drawing(plane).reroute(e)) rerouted.push(e.id);
    }
    this.notes.push(`${id} moved to the ${side} border of ${host.id}${path.length ? `; its path followed (${path.map((n) => n.id).join(', ')})` : ''}`);
    return rerouted;
  }
}
