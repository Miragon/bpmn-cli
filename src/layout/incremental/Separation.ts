import { LayoutDebug } from '../LayoutDebug.js';
import { bottom, right, type Box } from '../../drawing/utils/geom.js';
import { Frames } from '../../drawing/Frames.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';
import type { DShape, Plane } from '../../drawing/types.js';
import type { SpaceTool } from './SpaceTool.js';

export interface SeparateOptions {
  /** new or moved shapes: only their conflicts are resolved; a pushed unit becomes active too */
  active: Iterable<string>;
  /** default: the active ones */
  movable?: Iterable<string>;
  pinned?: Iterable<string>;
  /** e.g. shapes aligned on one column */
  locked?: { ids: Iterable<string>; axes: ReadonlyArray<'x' | 'y'> };
  gap?: number;
  grow?: boolean;
  /** a conflict already in the drawing before the edit stays unless it got worse */
  baseline?: ReadonlyMap<string, Box>;
}

export interface SeparateResult {
  moved: Set<string>;
  resized: Set<string>;
  unresolved: Array<[string, string]>;
}

type Dir = 'right' | 'down' | 'up';

/** larger conflicts are reported, not solved */
const MAX_PUSH = 400;

interface Unit {
  id: string;
  shape: DShape;
}

interface Move {
  unit: string;
  dir: Dir;
  need: number;
}

/**
 * Local overlap removal on a plane: pushes units apart until they keep a gap,
 * deterministic and bounded (gives up after a fixed number of moves and reports what is left).
 */
export class Separation {
  constructor(
    private readonly plane: Plane,
    private readonly space: SpaceTool,
  ) {}

  /** The smaller of the two axis shortfalls; <= 0 means no conflict. */
  private shortfall(a: Box, b: Box, gap: number): number {
    return Math.min(gap - this.gapX(a, b), gap - this.gapY(a, b));
  }

  private baselineBox(base: ReadonlyMap<string, Box>, id: string): Box | undefined {
    let b = base.get(id);
    if (!b) return undefined;
    for (const be of this.plane.shapes.values()) {
      if (be.hostId !== id) continue;
      const o = base.get(be.id);
      if (!o) continue;
      const x = Math.min(b.x, o.x);
      const y = Math.min(b.y, o.y);
      b = { x, y, width: Math.max(right(b), right(o)) - x, height: Math.max(bottom(b), bottom(o)) - y };
    }
    return b;
  }

  /** Boundary events fold into their host, which moves with them as one rigid unit. */
  private unitsOf(): Map<string, Unit> {
    const out = new Map<string, Unit>();
    for (const s of this.plane.shapes.values()) {
      if (!PlaneQuery.isLeaf(s) && !(s.kind === 'subProcess' && s.container)) continue;
      const host = s.hostId ? this.plane.shapes.get(s.hostId) : undefined;
      if (host && (PlaneQuery.isLeaf(host) || (host.kind === 'subProcess' && host.container))) continue;
      out.set(s.id, { id: s.id, shape: s });
    }
    return out;
  }

  private unitOf(units: Map<string, Unit>, id: string): string | undefined {
    if (units.has(id)) return id;
    const host = this.plane.shapes.get(id)?.hostId;
    return host && units.has(host) ? host : undefined;
  }

  private nested(a: DShape, b: DShape): boolean {
    const inside = (inner: DShape, outer: DShape): boolean => {
      let p = inner.parentId ?? (inner.hostId ? this.plane.shapes.get(inner.hostId)?.parentId : undefined);
      for (let i = 0; p && i < 20; i++) {
        if (p === outer.id) return true;
        p = this.plane.shapes.get(p)?.parentId;
      }
      return false;
    };
    return inside(a, b) || inside(b, a);
  }

  private gapX(a: Box, b: Box): number {
    return Math.max(b.x - right(a), a.x - right(b));
  }

  private gapY(a: Box, b: Box): number {
    return Math.max(b.y - bottom(a), a.y - bottom(b));
  }

  private readingOrder(a: Box, b: Box): number {
    return a.x + a.width / 2 - (b.x + b.width / 2) || a.y + a.height / 2 - (b.y + b.height / 2);
  }

  private candidateMoves(a: Unit, b: Unit, boxes: Map<string, Box>, ctx: { movable: Set<string>; active: Set<string>; used: Map<string, Set<Dir>>; gap: number; lockedX: Set<string>; lockedY: Set<string> }): Move[] {
    const out: Move[] = [];
    const [first, second] = this.readingOrder(boxes.get(a.id)!, boxes.get(b.id)!) <= 0 ? [a, b] : [b, a];
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
        const frame = Frames.of(this.plane, s.shape);
        const top = frame ? frame.bounds.y + (frame.kind === 'subProcess' ? 25 : 10) : -Infinity;
        if (sb.y - need >= top) out.push({ unit: s.id, dir: 'up', need });
      }
    }
    return out
      .filter((m) => m.need > 0 && !(m.dir === 'right' ? ctx.lockedX : ctx.lockedY).has(m.unit))
      .sort((p, q) => p.need - q.need);
  }

  /**
   * Resolves each conflict by the smallest allowed push: right, down, or up within the frame.
   * Never left, so a new node never ends up left of its predecessor.
   */
  separate(opts: SeparateOptions): SeparateResult {
    const gap = opts.gap ?? 20;
    const grow = opts.grow ?? true;
    const res: SeparateResult = { moved: new Set(), resized: new Set(), unresolved: [] };
    const units = this.unitsOf();
    const toUnits = (ids: Iterable<string>): Set<string> => new Set([...ids].map((id) => this.unitOf(units, id)).filter((x): x is string => !!x));
    // an active boundary event stays itself: only its own box is checked
    const active = new Set([...opts.active].filter((id) => this.plane.shapes.has(id)));
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
      const boxes = new Map([...units.values()].map((u) => [u.id, this.space.unitBox(u.shape)]));
      const probeBox = (id: string): Box | undefined => {
        if (units.has(id)) return boxes.get(id);
        return this.plane.shapes.get(id)?.bounds;
      };
      const order = [...active]
        .filter((id) => !!this.unitOf(units, id) && probeBox(id))
        .sort((p, q) => this.readingOrder(probeBox(p)!, probeBox(q)!) || (p < q ? -1 : 1));
      let conflict: [Unit, Unit] | undefined;
      let conflictGap = gap;
      for (const id of order) {
        const a = units.get(this.unitOf(units, id)!)!;
        const ab = probeBox(id)!;
        const need = units.has(id) ? gap : Math.min(gap, 8);
        for (const b of units.values()) {
          if (b === a || this.nested(a.shape, b.shape)) continue;
          const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (skipped.has(key)) continue;
          const bb = boxes.get(b.id)!;
          if (this.gapX(ab, bb) < need && this.gapY(ab, bb) < need) {
            if (opts.baseline) {
              const a0 = units.has(id) ? this.baselineBox(opts.baseline, a.id) : opts.baseline.get(id);
              const b0 = this.baselineBox(opts.baseline, b.id);
              if (a0 && b0 && this.shortfall(a0, b0, need) >= this.shortfall(ab, bb, need) - 1) continue;
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
      const move = this.candidateMoves(a, b, boxes, { movable, active, used, gap: conflictGap, lockedX, lockedY }).filter((m) => m.need <= MAX_PUSH)[0];
      if (!move) {
        skipped.add(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
        res.unresolved.push([a.id, b.id]);
        continue;
      }
      const need = Math.ceil(move.need);
      if (LayoutDebug.on()) LayoutDebug.log(`[separate] ${a.id} ~ ${b.id}: ${move.unit} ${move.dir} ${need}`);
      const dy = move.dir === 'down' ? need : move.dir === 'up' ? -need : 0;
      const dx = move.dir === 'right' ? need : 0;
      for (const id of this.space.shiftShape(move.unit, dx, dy)) res.moved.add(id);
      if (!used.has(move.unit)) used.set(move.unit, new Set());
      used.get(move.unit)!.add(move.dir);
      active.add(move.unit);
      if (grow) {
        const r = this.space.fitInFrame(move.unit, 10);
        r.moved.forEach((x) => res.moved.add(x));
        r.resized.forEach((x) => res.resized.add(x));
      }
    }
    return res;
  }

  /** Every given shape is active and movable (`bpmn layout --tidy`). */
  tidy(opts: { ids?: Iterable<string>; gap?: number } = {}): { moved: string[]; resized: string[]; unresolved: Array<[string, string]> } {
    const ids = opts.ids ? [...opts.ids] : [...this.plane.shapes.values()].filter(PlaneQuery.isLeaf).map((s) => s.id);
    const r = this.separate({ active: ids, movable: ids, ...(opts.gap !== undefined ? { gap: opts.gap } : {}) });
    return { moved: [...r.moved], resized: [...r.resized], unresolved: r.unresolved };
  }
}
