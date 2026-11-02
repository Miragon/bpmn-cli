import type { Box } from '../../../model/index.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import type { SpaceTool } from '../space/SpaceTool.js';

export interface SeparateOptions {
  active: Iterable<string>;
  moved?: Iterable<string>;
  movable?: Iterable<string>;
  pinned?: Iterable<string>;
  locked?: { ids: Iterable<string>; axes: ReadonlyArray<'x' | 'y'> };
  gap?: number;
  grow?: boolean;
  baseline?: ReadonlyMap<string, Box>;
}

export interface SeparateResult {
  moved: Set<string>;
  resized: Set<string>;
  unresolved: Array<[string, string]>;
}

type Direction = 'right' | 'down' | 'up';

interface Move {
  unit: string;
  direction: Direction;
  need: number;
}

interface Conflict {
  first: PlaneShape;
  second: PlaneShape;
  gap: number;
}

type Boxes = ReadonlyMap<string, Box>;

export class SeparationRun {
  private static readonly MAX_PUSH = 400;
  private static readonly MAX_DEPTH = 20;
  private static readonly DEFAULT_GAP = 20;
  private static readonly LABEL_GAP = 8;
  private static readonly GROW_PAD = 10;
  private static readonly SHIFTS: Readonly<Record<Direction, readonly [number, number]>> = { right: [1, 0], down: [0, 1], up: [0, -1] };

  private readonly result: SeparateResult = { moved: new Set(), resized: new Set(), unresolved: [] };
  private readonly units: Map<string, PlaneShape>;
  private readonly active: Set<string>;
  private readonly movable: Set<string>;
  private readonly lockedX: Set<string>;
  private readonly lockedY: Set<string>;
  private readonly used = new Map<string, Set<Direction>>();
  private readonly skipped = new Set<string>();
  private readonly gap: number;
  private readonly grow: boolean;
  private readonly baseline: Boxes | undefined;

  constructor(
    private readonly plane: Plane,
    private readonly space: SpaceTool,
    options: SeparateOptions,
  ) {
    this.gap = options.gap ?? SeparationRun.DEFAULT_GAP;
    this.grow = options.grow ?? true;
    this.baseline = options.baseline;
    this.units = this.unitsOfPlane();
    this.active = new Set([...options.active].filter((id) => plane.shapes.has(id)));
    this.movable = this.toUnits(options.movable ?? this.active);
    for (const id of this.toUnits(this.active)) {
      this.movable.add(id);
    }
    for (const id of this.toUnits(options.pinned ?? [])) {
      this.movable.delete(id);
    }
    const locked = this.toUnits(options.locked?.ids ?? []);
    this.lockedX = new Set(options.locked?.axes.includes('x') ? locked : []);
    this.lockedY = new Set(options.locked?.axes.includes('y') ? locked : []);
    for (const id of this.swallowed(this.toUnits(options.moved ?? []))) {
      this.active.add(id);
      this.movable.add(id);
    }
  }

  private static gapX(first: Box, second: Box): number {
    return Math.max(second.x - first.right, first.x - second.right);
  }

  private static gapY(first: Box, second: Box): number {
    return Math.max(second.y - first.bottom, first.y - second.bottom);
  }

  private static shortfall(first: Box, second: Box, gap: number): number {
    return Math.min(gap - SeparationRun.gapX(first, second), gap - SeparationRun.gapY(first, second));
  }

  private static readingOrder(first: Box, second: Box): number {
    return first.center.x - second.center.x || first.center.y - second.center.y;
  }

  private static pairKey(first: string, second: string): string {
    return first < second ? `${first}|${second}` : `${second}|${first}`;
  }

  private static isUnit(shape: PlaneShape): boolean {
    return shape.isLeaf || (shape.kind === 'subProcess' && shape.container);
  }

  run(): SeparateResult {
    const limit = 40 + 8 * this.units.size;
    for (let step = 0; step < limit; step++) {
      const boxes = new Map([...this.units.values()].map((unit) => [unit.id, this.space.unitBox(unit)] as const));
      const conflict = this.firstConflict(boxes);
      if (!conflict) {
        break;
      }
      this.resolve(conflict, boxes);
    }
    return this.result;
  }

  private unitsOfPlane(): Map<string, PlaneShape> {
    const units = new Map<string, PlaneShape>();
    for (const shape of this.plane.shapes.values()) {
      const host = shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
      if (SeparationRun.isUnit(shape) && !(host && SeparationRun.isUnit(host))) {
        units.set(shape.id, shape);
      }
    }
    return units;
  }

  private unitOf(id: string): string | undefined {
    if (this.units.has(id)) {
      return id;
    }
    const host = this.plane.shapes.get(id)?.hostId;
    return host && this.units.has(host) ? host : undefined;
  }

  private toUnits(ids: Iterable<string>): Set<string> {
    return new Set([...ids].flatMap((id) => this.unitOf(id) ?? []));
  }

  private inside(inner: PlaneShape, outer: PlaneShape): boolean {
    let parentId = inner.parentId ?? (inner.hostId ? this.plane.shapes.get(inner.hostId)?.parentId : undefined);
    for (let depth = 0; parentId && depth < SeparationRun.MAX_DEPTH; depth++) {
      if (parentId === outer.id) {
        return true;
      }
      parentId = this.plane.shapes.get(parentId)?.parentId;
    }
    return false;
  }

  private nested(first: PlaneShape, second: PlaneShape): boolean {
    return this.inside(first, second) || this.inside(second, first);
  }

  private swallows(frame: PlaneShape, other: PlaneShape): boolean {
    const [frameBefore, otherBefore] = [this.baseline?.get(frame.id), this.baseline?.get(other.id)];
    const overlapsNow = frame !== other && frame.container && other.kind !== 'annotation' && !this.nested(frame, other) && frame.bounds.overlaps(other.bounds);
    return overlapsNow && !(frameBefore && otherBefore?.overlaps(frameBefore));
  }

  private swallowed(moved: ReadonlySet<string>): string[] {
    const units = [...this.units.values()];
    const pairs = units.flatMap((frame) => units.filter((other) => this.swallows(frame, other)).flatMap((other) => [frame.id, other.id]));
    return pairs.filter((id) => moved.has(id));
  }

  private baselineBox(id: string): Box | undefined {
    const { baseline } = this;
    const box = baseline?.get(id);
    if (!baseline || !box) {
      return undefined;
    }
    return [...this.plane.shapes.values()].reduce((unit, shape) => {
      const boundary = shape.hostId === id ? baseline.get(shape.id) : undefined;
      return boundary ? unit.union(boundary) : unit;
    }, box);
  }

  private probeBox(id: string, boxes: Boxes): Box | undefined {
    return this.units.has(id) ? boxes.get(id) : this.plane.shapes.get(id)?.bounds;
  }

  private firstConflict(boxes: Boxes): Conflict | undefined {
    const order = [...this.active]
      .filter((id) => !!this.unitOf(id) && this.probeBox(id, boxes))
      .sort((left, right) => SeparationRun.readingOrder(this.probeBox(left, boxes)!, this.probeBox(right, boxes)!) || (left < right ? -1 : 1));
    for (const id of order) {
      const conflict = this.conflictOf(id, boxes);
      if (conflict) {
        return conflict;
      }
    }
    return undefined;
  }

  private conflictOf(id: string, boxes: Boxes): Conflict | undefined {
    const first = this.units.get(this.unitOf(id)!)!;
    const box = this.probeBox(id, boxes)!;
    const gap = this.units.has(id) ? this.gap : Math.min(this.gap, SeparationRun.LABEL_GAP);
    for (const second of this.units.values()) {
      if (second === first || this.nested(first, second) || this.skipped.has(SeparationRun.pairKey(first.id, second.id))) {
        continue;
      }
      const secondBox = boxes.get(second.id)!;
      if (SeparationRun.gapX(box, secondBox) < gap && SeparationRun.gapY(box, secondBox) < gap && !this.noWorseThanBaseline(id, first, second, box, secondBox, gap)) {
        return { first, second, gap };
      }
    }
    return undefined;
  }

  private noWorseThanBaseline(id: string, first: PlaneShape, second: PlaneShape, box: Box, secondBox: Box, gap: number): boolean {
    if (!this.baseline) {
      return false;
    }
    const firstBefore = this.units.has(id) ? this.baselineBox(first.id) : this.baseline.get(id);
    const secondBefore = this.baselineBox(second.id);
    return !!firstBefore && !!secondBefore && SeparationRun.shortfall(firstBefore, secondBefore, gap) >= SeparationRun.shortfall(box, secondBox, gap) - 1;
  }

  private movesOf(mover: PlaneShape, obstacle: PlaneShape, sideways: boolean, boxes: Boxes, gap: number): Move[] {
    const box = boxes.get(mover.id)!;
    const other = boxes.get(obstacle.id)!;
    const used = this.used.get(mover.id);
    const lower = box.center.y >= other.center.y;
    const moves: Move[] = sideways ? [{ unit: mover.id, direction: 'right', need: other.right + gap - box.x }] : [];
    if (lower && !used?.has('up')) {
      moves.push({ unit: mover.id, direction: 'down', need: other.bottom + gap - box.y });
    }
    if (!lower && this.active.has(mover.id) && !used?.has('down')) {
      const need = box.bottom - (other.y - gap);
      if (box.y - need >= this.topOf(mover)) {
        moves.push({ unit: mover.id, direction: 'up', need });
      }
    }
    return moves;
  }

  private topOf(mover: PlaneShape): number {
    const frame = new Frames(this.plane).of(mover);
    return frame ? frame.bounds.y + (frame.kind === 'subProcess' ? 25 : 10) : Number.NEGATIVE_INFINITY;
  }

  private candidateMoves(one: PlaneShape, other: PlaneShape, boxes: Boxes, gap: number): Move[] {
    const [first, second] = SeparationRun.readingOrder(boxes.get(one.id)!, boxes.get(other.id)!) <= 0 ? [one, other] : [other, one];
    const pairs = [
      [second, first],
      [first, second],
    ] as const;
    return pairs
      .flatMap(([mover, obstacle]) => (this.movable.has(mover.id) ? this.movesOf(mover, obstacle, mover === second, boxes, gap) : []))
      .filter((move) => move.need > 0 && !(move.direction === 'right' ? this.lockedX : this.lockedY).has(move.unit))
      .sort((left, right) => left.need - right.need);
  }

  private resolve({ first, second, gap }: Conflict, boxes: Boxes): void {
    const move = this.candidateMoves(first, second, boxes, gap).find((candidate) => candidate.need <= SeparationRun.MAX_PUSH);
    if (!move) {
      this.skipped.add(SeparationRun.pairKey(first.id, second.id));
      this.result.unresolved.push([first.id, second.id]);
      return;
    }
    this.apply(move);
  }

  private apply({ unit, direction, need }: Move): void {
    const { result } = this;
    const distance = Math.ceil(need);
    const [dx, dy] = SeparationRun.SHIFTS[direction];
    for (const id of this.space.shiftShape(unit, dx * distance, dy * distance)) {
      result.moved.add(id);
    }
    this.used.set(unit, (this.used.get(unit) ?? new Set()).add(direction));
    this.active.add(unit);
    this.skipped.clear();
    if (this.grow) {
      const { moved, resized } = this.space.fitInFrame(unit, SeparationRun.GROW_PAD);
      moved.forEach((id) => result.moved.add(id));
      resized.forEach((id) => result.resized.add(id));
    }
  }
}
