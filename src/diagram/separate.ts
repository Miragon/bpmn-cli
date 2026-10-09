/**
 * Local overlap removal on a plane (src/diagram/plane.ts).
 *
 * CONTRACT
 *  separate(plane, {active, movable, gap?, grow?})
 *   - units are leaf shapes and expanded sub-processes; a host and its
 *     boundary events form one rigid unit (their union box). Two units conflict when they are closer than
 *     `gap` (default 20) on both axes.
 *   - only conflicts involving an ACTIVE unit are resolved (new / moved
 *     shapes); a unit pushed out of the way becomes active itself, so the push
 *     propagates. Only MOVABLE units are ever moved: everything else stays
 *     exactly where it is. PINNED units never move, even when active (the
 *     shapes a format op put somewhere on request: the others give way).
 *     LOCKED units move only along the free axis (x locked: no moves right;
 *     y locked: no moves up or down), e.g. shapes aligned on one column.
 *   - a conflict is resolved by the smallest displacement among the allowed
 *     moves: the later unit in reading order to the right, either unit down
 *     when it is the lower one, an active unit up when it is the upper one and
 *     stays in its frame. Nothing is pushed to the left, so a new node never
 *     ends up left of its predecessor; a unit never reverses a direction it
 *     already moved in.
 *   - a moved unit that sticks out of its lane / pool / expanded sub-process
 *     grows that frame (space tool) instead of leaving it (`grow`, default
 *     true).
 *   - conflicts that already existed in `baseline` (the drawing before the
 *     edit) are left alone unless they got worse; no single push exceeds
 *     MAX_PUSH px
 *   - deterministic (units in reading order); bounded (gives up after a fixed
 *     number of moves and reports the conflicts left).
 *  tidy(plane, {ids?, gap?}) removes overlaps and gaps < `gap` among the
 *   given shapes (default: all leaf shapes of the plane) with the same rules,
 *   every unit active and movable. For `bpmn layout --tidy` and the `tidy`
 *   format op.
 */
import { layoutDebug, layoutDebugOn } from '../debug.js';
import { bottom, right, type Box } from './geom.js';
import { frameOf, isLeaf, type DShape, type Plane } from './plane.js';
import { fitInFrame, shiftShape, unitBox } from './space.js';

export interface SeparateOptions {
  /** shapes whose conflicts are resolved (new / moved ones) */
  active: Iterable<string>;
  /** shapes that may move (default: the active ones) */
  movable?: Iterable<string>;
  /** shapes that never move, even when active */
  pinned?: Iterable<string>;
  /** shapes that keep their position on these axes */
  locked?: { ids: Iterable<string>; axes: ReadonlyArray<'x' | 'y'> };
  /** minimum gap between units, default 20 */
  gap?: number;
  /** grow frames a unit would stick out of, default true */
  grow?: boolean;
  /**
   * shape bounds before the edit: a conflict that already existed there is
   * left alone unless it got worse (hand drawings may overlap on purpose)
   */
  baseline?: ReadonlyMap<string, Box>;
}

export interface SeparateResult {
  moved: Set<string>;
  resized: Set<string>;
  /** conflicts that could not be resolved */
  unresolved: Array<[string, string]>;
}

type Dir = 'right' | 'down' | 'up';

/** the largest single push separation makes (larger conflicts are reported, not solved) */
const MAX_PUSH = 400;

/** How deep two boxes violate the gap: the smaller of the two axis shortfalls (<= 0: no conflict). */
function shortfall(a: Box, b: Box, gap: number): number {
  return Math.min(gap - gapX(a, b), gap - gapY(a, b));
}

/** The box a unit had in the baseline (host plus the boundary events it already had). */
function baselineBox(plane: Plane, base: ReadonlyMap<string, Box>, id: string): Box | undefined {
  let b = base.get(id);
  if (!b) return undefined;
  for (const be of plane.shapes.values()) {
    if (be.hostId !== id) continue;
    const o = base.get(be.id);
    if (!o) continue;
    const x = Math.min(b.x, o.x);
    const y = Math.min(b.y, o.y);
    b = { x, y, width: Math.max(right(b), right(o)) - x, height: Math.max(bottom(b), bottom(o)) - y };
  }
  return b;
}

interface Unit {
  id: string;
  shape: DShape;
}

/** Units: leaf shapes and expanded sub-processes, boundary events folded into their host (which sits on their border). */
function unitsOf(plane: Plane): Map<string, Unit> {
  const out = new Map<string, Unit>();
  for (const s of plane.shapes.values()) {
    if (!isLeaf(s) && !(s.kind === 'subProcess' && s.container)) continue;
    const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
    if (host && (isLeaf(host) || (host.kind === 'subProcess' && host.container))) continue;
    out.set(s.id, { id: s.id, shape: s });
  }
  return out;
}

function unitOf(plane: Plane, units: Map<string, Unit>, id: string): string | undefined {
  if (units.has(id)) return id;
  const host = plane.shapes.get(id)?.hostId;
  return host && units.has(host) ? host : undefined;
}

/** One unit lies inside the other (content of an expanded sub-process). */
function nested(plane: Plane, a: DShape, b: DShape): boolean {
  const inside = (inner: DShape, outer: DShape): boolean => {
    let p = inner.parentId ?? (inner.hostId ? plane.shapes.get(inner.hostId)?.parentId : undefined);
    for (let i = 0; p && i < 20; i++) {
      if (p === outer.id) return true;
      p = plane.shapes.get(p)?.parentId;
    }
    return false;
  };
  return inside(a, b) || inside(b, a);
}

function gapX(a: Box, b: Box): number {
  return Math.max(b.x - right(a), a.x - right(b));
}

function gapY(a: Box, b: Box): number {
  return Math.max(b.y - bottom(a), a.y - bottom(b));
}

function readingOrder(a: Box, b: Box): number {
  return a.x + a.width / 2 - (b.x + b.width / 2) || a.y + a.height / 2 - (b.y + b.height / 2);
}

interface Move {
  unit: string;
  dir: Dir;
  need: number;
}

function candidateMoves(plane: Plane, a: Unit, b: Unit, boxes: Map<string, Box>, ctx: { movable: Set<string>; active: Set<string>; used: Map<string, Set<Dir>>; gap: number; lockedX: Set<string>; lockedY: Set<string> }): Move[] {
  const out: Move[] = [];
  const [first, second] = readingOrder(boxes.get(a.id)!, boxes.get(b.id)!) <= 0 ? [a, b] : [b, a];
  for (const [s, o] of [
    [second, first],
    [first, second],
  ] as const) {
    if (!ctx.movable.has(s.id)) continue;
    const sb = boxes.get(s.id)!;
    const ob = boxes.get(o.id)!;
    const used = ctx.used.get(s.id) ?? new Set<Dir>();
    if (s === second) out.push({ unit: s.id, dir: 'right', need: right(ob) + ctx.gap - sb.x });
    const lower = sb.y + sb.height / 2 >= ob.y + ob.height / 2;
    if (lower && !used.has('up')) out.push({ unit: s.id, dir: 'down', need: bottom(ob) + ctx.gap - sb.y });
    if (!lower && ctx.active.has(s.id) && !used.has('down')) {
      const need = bottom(sb) - (ob.y - ctx.gap);
      const frame = frameOf(plane, s.shape);
      const top = frame ? frame.bounds.y + (frame.kind === 'subProcess' ? 25 : 10) : -Infinity;
      if (sb.y - need >= top) out.push({ unit: s.id, dir: 'up', need });
    }
  }
  return out
    .filter((m) => m.need > 0 && !(m.dir === 'right' ? ctx.lockedX : ctx.lockedY).has(m.unit))
    .sort((p, q) => p.need - q.need);
}

/** Local overlap removal (see module contract). */
export function separate(plane: Plane, opts: SeparateOptions): SeparateResult {
  const gap = opts.gap ?? 20;
  const grow = opts.grow ?? true;
  const res: SeparateResult = { moved: new Set(), resized: new Set(), unresolved: [] };
  const units = unitsOf(plane);
  const toUnits = (ids: Iterable<string>): Set<string> => new Set([...ids].map((id) => unitOf(plane, units, id)).filter((x): x is string => !!x));
  // active shapes (a boundary event stays itself: only its own box is checked)
  const active = new Set([...opts.active].filter((id) => plane.shapes.has(id)));
  const movable = opts.movable ? toUnits(opts.movable) : toUnits(active);
  for (const id of toUnits(active)) movable.add(id);
  for (const id of toUnits(opts.pinned ?? [])) movable.delete(id);
  const lockedIds = toUnits(opts.locked?.ids ?? []);
  const lockedX = new Set(opts.locked?.axes.includes('x') ? lockedIds : []);
  const lockedY = new Set(opts.locked?.axes.includes('y') ? lockedIds : []);
  const used = new Map<string, Set<Dir>>();
  const skipped = new Set<string>();
  const limit = 40 + 8 * units.size;
  for (let step = 0; step < limit; step++) {
    const boxes = new Map([...units.values()].map((u) => [u.id, unitBox(plane, u.shape)]));
    // an active boundary event only brings its own box (its host did not move); anything else its whole unit
    const probeBox = (id: string): Box | undefined => {
      if (units.has(id)) return boxes.get(id);
      return plane.shapes.get(id)?.bounds;
    };
    const order = [...active]
      .filter((id) => !!unitOf(plane, units, id) && probeBox(id))
      .sort((p, q) => readingOrder(probeBox(p)!, probeBox(q)!) || (p < q ? -1 : 1));
    let conflict: [Unit, Unit] | undefined;
    let conflictGap = gap;
    for (const id of order) {
      const a = units.get(unitOf(plane, units, id)!)!;
      const ab = probeBox(id)!;
      const need = units.has(id) ? gap : Math.min(gap, 8);
      for (const b of units.values()) {
        if (b === a || nested(plane, a.shape, b.shape)) continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (skipped.has(key)) continue;
        const bb = boxes.get(b.id)!;
        if (gapX(ab, bb) < need && gapY(ab, bb) < need) {
          if (opts.baseline) {
            const a0 = units.has(id) ? baselineBox(plane, opts.baseline, a.id) : opts.baseline.get(id);
            const b0 = baselineBox(plane, opts.baseline, b.id);
            if (a0 && b0 && shortfall(a0, b0, need) >= shortfall(ab, bb, need) - 1) continue;
          }
          conflict = [a, b];
          conflictGap = need;
          break;
        }
      }
      if (conflict) break;
    }
    if (!conflict) break;
    const [a, b] = conflict;
    const move = candidateMoves(plane, a, b, boxes, { movable, active, used, gap: conflictGap, lockedX, lockedY }).filter((m) => m.need <= MAX_PUSH)[0];
    if (!move) {
      skipped.add(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
      res.unresolved.push([a.id, b.id]);
      continue;
    }
    const need = Math.ceil(move.need);
    if (layoutDebugOn()) layoutDebug(`[separate] ${a.id} ~ ${b.id}: ${move.unit} ${move.dir} ${need}`);
    const dy = move.dir === 'down' ? need : move.dir === 'up' ? -need : 0;
    const dx = move.dir === 'right' ? need : 0;
    for (const id of shiftShape(plane, move.unit, dx, dy)) res.moved.add(id);
    if (!used.has(move.unit)) used.set(move.unit, new Set());
    used.get(move.unit)!.add(move.dir);
    active.add(move.unit);
    if (grow) {
      const r = fitInFrame(plane, move.unit, 10);
      r.moved.forEach((x) => res.moved.add(x));
      r.resized.forEach((x) => res.resized.add(x));
    }
  }
  return res;
}

/** Overlap / gap removal among the given shapes, every one of them active and movable. */
export function tidy(plane: Plane, opts: { ids?: Iterable<string>; gap?: number } = {}): { moved: string[]; resized: string[]; unresolved: Array<[string, string]> } {
  const ids = opts.ids ? [...opts.ids] : [...plane.shapes.values()].filter(isLeaf).map((s) => s.id);
  const r = separate(plane, { active: ids, movable: ids, ...(opts.gap !== undefined ? { gap: opts.gap } : {}) });
  return { moved: [...r.moved], resized: [...r.resized], unresolved: r.unresolved };
}
