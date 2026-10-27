import { LayoutDebug } from '../LayoutDebug.js';
import { bottom, type Box, cx, cy, right } from '../../utils/geom.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import type { DShape, Plane } from '../../di/types.js';
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
  private shortfall(first: Box, second: Box, gap: number): number {
    return Math.min(gap - this.gapX(first, second), gap - this.gapY(first, second));
  }

  private baselineBox(base: ReadonlyMap<string, Box>, id: string): Box | undefined {
    let box = base.get(id);
    if (!box) return undefined;
    for (const be of this.plane.shapes.values()) {
      if (be.hostId !== id) continue;
      const otherBox = base.get(be.id);
      if (!otherBox) continue;
      const left = Math.min(box.x, otherBox.x);
      const top = Math.min(box.y, otherBox.y);
      box = { x: left, y: top, width: Math.max(right(box), right(otherBox)) - left, height: Math.max(bottom(box), bottom(otherBox)) - top };
    }
    return box;
  }

  /** Boundary events fold into their host, which moves with them as one rigid unit. */
  private unitsOf(): Map<string, Unit> {
    const out = new Map<string, Unit>();
    for (const shape of this.plane.shapes.values()) {
      if (!PlaneQuery.isLeaf(shape) && !(shape.kind === 'subProcess' && shape.container)) continue;
      const host = shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
      if (host && (PlaneQuery.isLeaf(host) || (host.kind === 'subProcess' && host.container))) continue;
      out.set(shape.id, { id: shape.id, shape });
    }
    return out;
  }

  private unitOf(units: Map<string, Unit>, id: string): string | undefined {
    if (units.has(id)) return id;
    const host = this.plane.shapes.get(id)?.hostId;
    return host && units.has(host) ? host : undefined;
  }

  private nested(first: DShape, second: DShape): boolean {
    const inside = (inner: DShape, outer: DShape): boolean => {
      let parentId = inner.parentId ?? (inner.hostId ? this.plane.shapes.get(inner.hostId)?.parentId : undefined);
      for (let depth = 0; parentId && depth < 20; depth++) {
        if (parentId === outer.id) return true;
        parentId = this.plane.shapes.get(parentId)?.parentId;
      }
      return false;
    };
    return inside(first, second) || inside(second, first);
  }

  private gapX(first: Box, second: Box): number {
    return Math.max(second.x - right(first), first.x - right(second));
  }

  private gapY(first: Box, second: Box): number {
    return Math.max(second.y - bottom(first), first.y - bottom(second));
  }

  private readingOrder(first: Box, second: Box): number {
    return cx(first) - (cx(second)) || cy(first) - (cy(second));
  }

  private candidateMoves(unitA: Unit, unitB: Unit, boxes: Map<string, Box>, ctx: { movable: Set<string>; active: Set<string>; used: Map<string, Set<Dir>>; gap: number; lockedX: Set<string>; lockedY: Set<string> }): Move[] {
    const out: Move[] = [];
    const [first, second] = this.readingOrder(boxes.get(unitA.id)!, boxes.get(unitB.id)!) <= 0 ? [unitA, unitB] : [unitB, unitA];
    for (const [mover, obstacle] of [
      [second, first],
      [first, second],
    ] as const) {
      if (!ctx.movable.has(mover.id)) continue;
      const sb = boxes.get(mover.id)!;
      const ob = boxes.get(obstacle.id)!;
      const used = ctx.used.get(mover.id) ?? new Set<Dir>();
      if (mover === second) out.push({ unit: mover.id, dir: 'right', need: right(ob) + ctx.gap - sb.x });
      const lower = cy(sb) >= cy(ob);
      if (lower && !used.has('up')) out.push({ unit: mover.id, dir: 'down', need: bottom(ob) + ctx.gap - sb.y });
      if (!lower && ctx.active.has(mover.id) && !used.has('down')) {
        const need = bottom(sb) - (ob.y - ctx.gap);
        const frame = Frames.of(this.plane, mover.shape);
        const top = frame ? frame.bounds.y + (frame.kind === 'subProcess' ? 25 : 10) : -Infinity;
        if (sb.y - need >= top) out.push({ unit: mover.id, dir: 'up', need });
      }
    }
    return out
      .filter((move) => move.need > 0 && !(move.dir === 'right' ? ctx.lockedX : ctx.lockedY).has(move.unit))
      .sort((left, right) => left.need - right.need);
  }

  /**
   * Resolves each conflict by the smallest allowed push: right, down, or up within the frame.
   * Never left, so a new node never ends up left of its predecessor.
   * An active boundary event stays itself: only its own box is checked.
   */
  separate(opts: SeparateOptions): SeparateResult {
    const gap = opts.gap ?? 20;
    const grow = opts.grow ?? true;
    const res: SeparateResult = { moved: new Set(), resized: new Set(), unresolved: [] };
    const units = this.unitsOf();
    const toUnits = (ids: Iterable<string>): Set<string> => new Set([...ids].map((id) => this.unitOf(units, id)).filter((unitId): unitId is string => !!unitId));
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
      const boxes = new Map([...units.values()].map((unit) => [unit.id, this.space.unitBox(unit.shape)]));
      const probeBox = (id: string): Box | undefined => {
        if (units.has(id)) return boxes.get(id);
        return this.plane.shapes.get(id)?.bounds;
      };
      const order = [...active]
        .filter((id) => !!this.unitOf(units, id) && probeBox(id))
        .sort((leftId, rightId) => this.readingOrder(probeBox(leftId)!, probeBox(rightId)!) || (leftId < rightId ? -1 : 1));
      let conflict: [Unit, Unit] | undefined;
      let conflictGap = gap;
      for (const id of order) {
        const first = units.get(this.unitOf(units, id)!)!;
        const ab = probeBox(id)!;
        const need = units.has(id) ? gap : Math.min(gap, 8);
        for (const second of units.values()) {
          if (second === first || this.nested(first.shape, second.shape)) continue;
          const key = first.id < second.id ? `${first.id}|${second.id}` : `${second.id}|${first.id}`;
          if (skipped.has(key)) continue;
          const bb = boxes.get(second.id)!;
          if (this.gapX(ab, bb) < need && this.gapY(ab, bb) < need) {
            if (opts.baseline) {
              const a0 = units.has(id) ? this.baselineBox(opts.baseline, first.id) : opts.baseline.get(id);
              const b0 = this.baselineBox(opts.baseline, second.id);
              if (a0 && b0 && this.shortfall(a0, b0, need) >= this.shortfall(ab, bb, need) - 1) continue;
            }
            conflict = [first, second];
            conflictGap = need;
            break;
          }
        }
        if (conflict) break;
      }
      if (!conflict) break;
      const [unitA, unitB] = conflict;
      const move = this.candidateMoves(unitA, unitB, boxes, { movable, active, used, gap: conflictGap, lockedX, lockedY }).filter((candidate) => candidate.need <= MAX_PUSH)[0];
      if (!move) {
        skipped.add(unitA.id < unitB.id ? `${unitA.id}|${unitB.id}` : `${unitB.id}|${unitA.id}`);
        res.unresolved.push([unitA.id, unitB.id]);
        continue;
      }
      const need = Math.ceil(move.need);
      if (LayoutDebug.on()) LayoutDebug.log(`[separate] ${unitA.id} ~ ${unitB.id}: ${move.unit} ${move.dir} ${need}`);
      const dy = move.dir === 'down' ? need : move.dir === 'up' ? -need : 0;
      const dx = move.dir === 'right' ? need : 0;
      for (const id of this.space.shiftShape(move.unit, dx, dy)) res.moved.add(id);
      if (!used.has(move.unit)) used.set(move.unit, new Set());
      used.get(move.unit)!.add(move.dir);
      active.add(move.unit);
      if (grow) {
        const result = this.space.fitInFrame(move.unit, 10);
        result.moved.forEach((movedId) => res.moved.add(movedId));
        result.resized.forEach((resizedId) => res.resized.add(resizedId));
      }
    }
    return res;
  }

  /** Every given shape is active and movable (`bpmn layout --tidy`). */
  tidy(opts: { ids?: Iterable<string>; gap?: number } = {}): { moved: string[]; resized: string[]; unresolved: Array<[string, string]> } {
    const ids = opts.ids ? [...opts.ids] : [...this.plane.shapes.values()].filter(PlaneQuery.isLeaf).map((shape) => shape.id);
    const result = this.separate({ active: ids, movable: ids, ...(opts.gap !== undefined ? { gap: opts.gap } : {}) });
    return { moved: [...result.moved], resized: [...result.resized], unresolved: result.unresolved };
  }
}
