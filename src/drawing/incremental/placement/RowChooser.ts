import { Box } from '../../../model/index.js';
import type { DShape, ShapeKind } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import type { ShapeSize } from '../../plane/ShapeSizes.js';
import type { PlacementObstacles, SpaceBand } from './PlacementObstacles.js';
import type { PlacementState, Probe } from './PlacementState.js';
import { RowCosts, type Cand, type Shift } from './RowCosts.js';

export interface FreeRow {
  centre: number;
  onLine: boolean;
}

export interface RowSearch {
  left: number;
  size: ShapeSize;
  extent: number;
  exclude: ReadonlySet<string>;
}

export interface OpenedRows {
  first: number;
  step: number;
  floor: number;
  basePenalty?: number;
  anchor?: DShape | undefined;
  descend?: number;
}

export interface RowsAbove {
  anchor: DShape;
  start: number;
  step: number;
  penalty: number;
  top?: Box;
}

export class RowChooser {
  static readonly TOP_ROW = 160;

  private static readonly MAX_ROWS = 40;
  private static readonly ROW_CLEARANCE = 20;
  private static readonly LINE_MARGIN = 4;
  private static readonly RANK_PENALTY = 60;
  private static readonly ON_LINE_PENALTY = 700;
  private static readonly ROW_STEP_PENALTY = 40;
  private static readonly OPEN_ROW = 100;
  private static readonly OPEN_PER_SHAPE = 3;
  private static readonly OPEN_MAX_SHAPES = 40;
  private static readonly FRAME_PAD = 15;

  private readonly costs: RowCosts;

  constructor(
    private readonly state: PlacementState,
    private readonly obstacles: PlacementObstacles,
  ) {
    this.costs = new RowCosts(state);
  }

  private static movingBelow(plane: Plane, line: number, band: SpaceBand): number {
    const { within } = band;
    return [...plane.shapes.values()].filter(({ isLeaf, bounds }) => isLeaf && bounds.y >= line && (!within || (bounds.x < within.right && bounds.right > within.x))).length;
  }

  private static openPenalty(base: number, moving: number, delta: number): number {
    return base + RowChooser.OPEN_ROW + RowChooser.OPEN_PER_SHAPE * Math.min(RowChooser.OPEN_MAX_SHAPES, moving) + delta * 0.2;
  }

  freeRows(plane: Plane, frame: DShape | undefined, { left, size, extent, exclude }: RowSearch, start: { centre: number; step: number; count: number; up?: boolean }): FreeRow[] {
    const { width, height } = size;
    const { centre: startCentre, step, count, up } = start;
    const blockers = this.obstacles.of(plane, frame, exclude);
    const shapesOnly = { boxes: blockers.boxes, labels: [] };
    const segments = this.obstacles.edgeBoxes(plane);
    const rows: FreeRow[] = [];
    for (let rowIndex = 0; rowIndex < RowChooser.MAX_ROWS && rows.length < count; rowIndex++) {
      const centre = startCentre + (up ? -rowIndex : rowIndex) * step;
      const box = new Box(left, centre - height / 2, width, height);
      if (this.obstacles.isFree(box, blockers) && (extent <= 0 || this.obstacles.isFree(new Box(left + width, box.y, extent, height), shapesOnly))) {
        rows.push({ centre, onLine: segments.some((segment) => segment.overlaps(box, RowChooser.LINE_MARGIN)) });
      }
    }
    if (!rows.length && !up) {
      rows.push({ centre: startCentre, onLine: false });
    }
    return rows;
  }

  cheapest(id: string, plane: Plane, from: DShape, kind: ShapeKind, cands: Cand[]): Cand {
    const ranked = cands.map((cand) => ({ cand, cost: this.costs.ofCandidate(plane, from, kind, cand) }));
    ranked.sort((first, second) => first.cost - second.cost);
    this.state.heads.set(id, ranked.length);
    const chosenIndex = Math.min(this.state.skip.get(id) ?? 0, ranked.length - 1);
    return ranked[chosenIndex]?.cand ?? cands[0]!;
  }

  rowCandidates(plane: Plane, probe: Pick<DShape, 'parentId' | 'poolId'>, frame: DShape | undefined, search: RowSearch, opened: OpenedRows): Cand[] {
    const { left, size, extent, exclude } = search;
    const { first, step, floor, basePenalty = 0, anchor, descend } = opened;
    const rows = this.freeRows(plane, frame, search, { centre: first, step, count: 3 });
    const band = this.obstacles.spaceBand(plane, probe, anchor);
    const cands = rows.map((row, rowIndex) => this.belowCandidate(plane, frame, search, band, { row, rowIndex, first, step, basePenalty }));
    const box = new Box(left, first - size.height / 2, size.width + extent, size.height);
    const lines = this.linesUnder(plane, Math.min(descend ?? left, left) - 10, box.right + 10, floor, box.bottom + RowChooser.ROW_CLEARANCE);
    if (rows.some((row) => Math.abs(row.centre - first) < 1 && !row.onLine) && !lines.length) {
      return cands;
    }
    const blockers = this.obstacles.of(plane, frame, exclude).boxes.filter((blocker) => blocker.overlaps(box, RowChooser.ROW_CLEARANCE));
    const tops = [...blockers.map((blocker) => blocker.y), ...lines];
    const top = tops.length ? Math.min(...tops) : undefined;
    if (top === undefined || top <= floor) {
      return cands;
    }
    const insert: Shift = { line: top - 0.5, delta: Math.ceil(box.bottom + RowChooser.ROW_CLEARANCE - top), ...band };
    return [...cands, { x: left, centre: first, size, extent, penalty: RowChooser.openPenalty(basePenalty, RowChooser.movingBelow(plane, insert.line, band), insert.delta), insert }];
  }

  rowsAbove(plane: Plane, probe: Probe, frame: DShape | undefined, search: RowSearch, above: RowsAbove): Cand[] {
    const { left, size, extent } = search;
    const { start, step, penalty, top } = above;
    const inner = frame ? Frames.interior(frame, RowChooser.FRAME_PAD) : undefined;
    const cands: Cand[] = [];
    this.freeRows(plane, frame, search, { centre: start, step, count: 2, up: true }).forEach((row, rowIndex) => {
      const linePenalty = row.onLine ? RowChooser.ON_LINE_PENALTY : 0;
      if (inner && row.centre + size.height / 2 > inner.bottom) {
        return;
      }
      if (!inner || row.centre - size.height / 2 >= inner.y) {
        cands.push({ x: left, centre: row.centre, size, extent, penalty: penalty + RowChooser.RANK_PENALTY * rowIndex + linePenalty, ...(top ? { top } : {}) });
      } else if (!rowIndex && Math.abs(row.centre - start) <= 0.5) {
        cands.push(this.openedAtFrameTop(plane, probe, frame!, search, { row, inner, above, linePenalty }));
      }
    });
    return cands;
  }

  rowInLane(plane: Plane, lane: DShape, { left, size, exclude }: Pick<RowSearch, 'left' | 'size' | 'exclude'>, prefer: readonly number[]): number {
    const { width, height } = size;
    const { rowTol, row } = this.state.spacingFor(plane);
    const blockers = this.obstacles.of(plane, lane, exclude);
    const inner = Frames.interior(lane, 10);
    const fitsIn = (centre: number, box: Box): boolean => centre - height / 2 >= box.y - 0.5 && centre + height / 2 <= box.bottom + 0.5;
    const rows = this.laneRows(plane, lane, rowTol, exclude);
    const candidates = [...prefer.filter((centre) => fitsIn(centre, inner)), ...rows.filter((centre) => fitsIn(centre, lane.bounds))];
    if (!rows.length) {
      candidates.push(Math.round(inner.center.y));
    }
    const free = candidates.find((centre) => this.obstacles.isFree(new Box(left, centre - height / 2, width, height), blockers));
    if (free !== undefined) {
      return free;
    }
    const below = this.obstacles.contentBottom(plane, lane, exclude);
    return Math.round((below ?? inner.y) + Math.max(30, row - 80) + height / 2);
  }

  intoOwnLane(plane: Plane, probe: Probe, left: number, centre: number, size: ShapeSize, prefer: readonly number[], anchor?: DShape): number {
    const lane = probe.laneId ? plane.shapes.get(probe.laneId) : undefined;
    if (!lane) {
      return centre;
    }
    const inner = Frames.interior(lane, 5);
    const top = centre - size.height / 2;
    if ((anchor?.laneId === probe.laneId && !!anchor && top >= inner.y) || (top >= inner.y && centre + size.height / 2 <= inner.bottom)) {
      return centre;
    }
    return this.rowInLane(plane, lane, { left, size, exclude: new Set([probe.id]) }, prefer);
  }

  private belowCandidate(plane: Plane, frame: DShape | undefined, { left, size, extent }: RowSearch, band: SpaceBand, at: { row: FreeRow; rowIndex: number; first: number; step: number; basePenalty: number }): Cand {
    const { row, rowIndex, first, step, basePenalty } = at;
    const cand: Cand = { x: left, centre: row.centre, size, extent, penalty: basePenalty + RowChooser.RANK_PENALTY * rowIndex + (row.onLine ? RowChooser.ON_LINE_PENALTY : 0) + Math.max(0, (row.centre - first) / step - 1) * RowChooser.ROW_STEP_PENALTY };
    if (!frame) {
      return cand;
    }
    const bottom = row.centre + size.height / 2;
    const pad = Math.max(RowChooser.FRAME_PAD, this.state.drawing(plane).space.borderPad(frame, new Box(left, row.centre - size.height / 2, size.width, size.height), 'y'));
    if (bottom + pad > frame.bounds.bottom) {
      const line = frame.bounds.bottom - 1;
      const delta = Math.ceil(bottom + pad - frame.bounds.bottom);
      cand.grow = { line, delta, ...band };
      cand.penalty += 10 * RowChooser.movingBelow(plane, line, band) + delta * 0.3;
    }
    return cand;
  }

  private openedAtFrameTop(plane: Plane, probe: Probe, frame: DShape, { left, size, extent }: RowSearch, { row, inner, above, linePenalty }: { row: FreeRow; inner: Box; above: RowsAbove; linePenalty: number }): Cand {
    const { anchor, penalty, top } = above;
    const delta = Math.ceil(inner.y - (row.centre - size.height / 2));
    const band = this.obstacles.spaceBand(plane, probe, anchor);
    const insert: Shift = { line: frame.bounds.y + 1, delta, ...band };
    const moved = top ? new Box(top.x, top.y + delta, top.width, top.height) : undefined;
    return { x: left, centre: row.centre + delta, size, extent, insert, penalty: RowChooser.openPenalty(penalty, RowChooser.movingBelow(plane, insert.line, band), delta) + linePenalty, ...(moved ? { top: moved } : {}) };
  }

  private linesUnder(plane: Plane, from: number, to: number, floor: number, below: number): number[] {
    const tops: number[] = [];
    for (const edge of plane.edges.values()) {
      const last = edge.points.length - 1;
      edge.points.slice(1).forEach((end, index) => {
        const start = edge.points[index]!;
        if (Math.abs(start.y - end.y) > 0.5 || start.y <= floor + 0.5 || start.y > below || Math.max(start.x, end.x) < from || Math.min(start.x, end.x) > to) {
          return;
        }
        tops.push(start.y);
        const ends = [index === 0 ? edge.sourceId : undefined, index + 1 === last ? edge.targetId : undefined];
        tops.push(...ends.flatMap((id) => this.shapeTopBelow(plane, id, floor)));
      });
    }
    return tops;
  }

  private shapeTopBelow(plane: Plane, id: string | undefined, floor: number): number[] {
    const shape = id ? plane.shapes.get(id) : undefined;
    return shape?.isLeaf && shape.bounds.y > floor + 0.5 ? [shape.bounds.y] : [];
  }

  private laneRows(plane: Plane, lane: DShape, tolerance: number, exclude: ReadonlySet<string>): number[] {
    const centres = [...plane.shapes.values()].filter((shape) => shape.isLeaf && shape.kind !== 'boundary' && shape.laneId === lane.id && !exclude.has(shape.id)).map((shape) => shape.bounds.center.y).sort((first, second) => first - second);
    const clusters: Array<{ centre: number; count: number }> = [];
    for (const centre of centres) {
      const last = clusters.at(-1);
      if (last && centre - last.centre <= tolerance) {
        last.centre = (last.centre * last.count + centre) / (last.count + 1);
        last.count++;
      } else {
        clusters.push({ centre, count: 1 });
      }
    }
    return clusters.sort((first, second) => second.count - first.count || first.centre - second.centre).map((cluster) => Math.round(cluster.centre));
  }
}
