import { LayoutDebug } from '../LayoutDebug.js';
import { bottom, cy, overlaps, pathHits, right, segmentHits, segmentsCross, type Box, type Point } from '../../utils/geom.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';

import type { DShape, Plane, ShapeKind } from '../../di/types.js';
import { attachedSide, defaultSides } from '../../utils/sides.js';
import { OrthogonalRouter } from './OrthogonalRouter.js';
import type { NodePlacer, Probe } from './NodePlacer.js';
import type { PlacementObstacles } from './PlacementObstacles.js';

export interface Shift {
  line: number;
  delta: number;
  within?: Box;
  frame?: string;
}

export interface Cand {
  x: number;
  centre: number;
  size: { width: number; height: number };
  penalty: number;
  /** room the new nodes that follow on the row need right of the box (chainExtent) */
  extent?: number;
  /** a row opened with the space tool before placing */
  insert?: Shift;
  /** the frame growth placing there causes (fitInFrame), for the cost estimate */
  grow?: Shift;
  /** a boundary event's path above its host: the event's spot on the host's top border */
  top?: Box;
}

const CROSSING = 300;
/** an existing line through the room the new nodes take: it is routed around them */
const LINE_HIT = 400;
/** an opened row: base, per shape it moves (capped: one crossing always costs more) */
const OPEN_ROW = 100;
const OPEN_PER_SHAPE = 3;
const OPEN_MAX_SHAPES = 40;
/** a boundary event's path above its host instead of below (the convention) */
export const TOP_ROW = 160;

/**
 * Candidate rows for a branch or exception path (free rows below or above the anchor, rows opened
 * with the space tool, rows in a lane) and the cheapest of them by a trial route and the chain.
 */
export class RowChooser {
  constructor(
    private readonly placer: NodePlacer,
    private readonly obstacles: PlacementObstacles,
  ) {}

  /**
   * Up to `count` free row centres at or below `startCy` (rows on lines are flagged). `extent`:
   * room right of the box for the chain that follows, kept free of shapes only.
   */
  freeRows(plane: Plane, frame: DShape | undefined, left: number, width: number, height: number, startCy: number, step: number, exclude: ReadonlySet<string>, count: number, extent = 0, up = false): Array<{ centre: number; onLine: boolean }> {
    const obs = this.obstacles.of(plane, frame, exclude);
    const shapesOnly = { boxes: obs.boxes, labels: [] };
    const segs = this.obstacles.edgeBoxes(plane);
    const out: Array<{ centre: number; onLine: boolean }> = [];
    for (let rowIndex = 0; rowIndex < 40 && out.length < count; rowIndex++) {
      const centre = startCy + (up ? -rowIndex : rowIndex) * step;
      const box = { x: left, y: centre - height / 2, width, height };
      if (!this.obstacles.isFree(box, obs) || (extent > 0 && !this.obstacles.isFree({ ...box, x: left + width, width: extent }, shapesOnly))) continue;
      out.push({ centre, onLine: segs.some((segment) => overlaps(segment, box, 4)) });
    }
    if (!out.length && !up) out.push({ centre: startCy, onLine: false });
    return out;
  }

  private shiftedBox(box: Box, shift: Shift | undefined): Box {
    return shift && box.y >= shift.line ? { ...box, y: box.y + shift.delta } : box;
  }

  private shiftedLine(pts: Point[], shift: Shift | undefined): Point[] {
    return shift ? pts.map((point) => (point.y >= shift.line ? { x: point.x, y: point.y + shift.delta } : point)) : pts;
  }

  /**
   * A trial route from `from` to a candidate box, charged for cut shapes, crossed lines, labels
   * hit, bends and length. `shift` approximates a row opened by the space tool.
   */
  private connectionCost(plane: Plane, from: DShape, to: Box, toKind: ShapeKind, shift?: Shift): number {
    const host = from.hostId ? plane.shapes.get(from.hostId) : undefined;
    const obstacles: Box[] = [];
    for (const other of plane.shapes.values()) {
      if (other.id === from.id || other.kind === 'group') continue;
      if (PlaneQuery.isLeaf(other) || (other.kind === 'subProcess' && other.container && other.id !== from.parentId)) obstacles.push(this.shiftedBox(other.bounds, shift));
    }
    const flows = [...plane.edges.values()].map((edge) => this.shiftedLine(edge.points, shift)).filter((points) => points.length >= 2);
    const lines = this.placer.drawing(plane).routingLines().map((line) => this.shiftedLine(line, shift));
    const hostBox = host ? this.shiftedBox(host.bounds, shift) : undefined;
    const sourceSides = from.kind === 'boundary' && hostBox ? [attachedSide(from.bounds, hostBox)] : defaultSides(from.kind, 'source');
    const pts = OrthogonalRouter.route({ source: from.bounds, target: to, sourceSides, targetSides: defaultSides(toKind, 'target'), obstacles, lines });
    let cost = 0;
    for (let index = 0; index + 1 < pts.length; index++) cost += Math.abs(pts[index + 1]!.x - pts[index]!.x) + Math.abs(pts[index + 1]!.y - pts[index]!.y);
    cost = cost * 0.5 + (pts.length - 2) * 30;
    for (const obstacle of obstacles) if (obstacle !== hostBox && pathHits(pts, obstacle)) cost += 2000;
    for (const line of flows) {
      for (let index = 0; index + 1 < pts.length; index++) {
        for (let lineIndex = 0; lineIndex + 1 < line.length; lineIndex++) if (segmentsCross(pts[index]!, pts[index + 1]!, line[lineIndex]!, line[lineIndex + 1]!)) cost += CROSSING;
      }
    }
    const labels = [...plane.shapes.values(), ...plane.edges.values()].map((owner) => owner.label).filter((label): label is Box => !!label);
    for (const label of labels) for (let index = 0; index + 1 < pts.length; index++) if (segmentHits(pts[index]!, pts[index + 1]!, this.shiftedBox(label, shift), 0)) cost += 60;
    return cost;
  }

  /**
   * The rest of the chain on the candidate's row: a line crossing its run costs a crossing, a line
   * through the room it takes (or through the box of an opened or top row) costs LINE_HIT.
   */
  private chainCost(plane: Plane, box: Box, cand: Cand): number {
    const shift = cand.insert ?? cand.grow;
    const extent = cand.extent ?? 0;
    const run = extent > 0 ? ([{ x: right(box), y: cy(box) }, { x: right(box) + extent, y: cy(box) }] as const) : undefined;
    const rest = extent > 0 ? { x: right(box), y: box.y, width: extent, height: box.height } : undefined;
    const head = cand.insert || cand.top ? box : undefined;
    let cost = 0;
    for (const edge of plane.edges.values()) {
      const line = this.shiftedLine(edge.points, shift);
      for (let index = 0; index + 1 < line.length; index++) {
        const segmentStart = line[index]!;
        const segmentEnd = line[index + 1]!;
        if (run && segmentsCross(run[0], run[1], segmentStart, segmentEnd)) {
          cost += CROSSING;
          if (LayoutDebug.on()) LayoutDebug.log(`[place]   chain at c=${cand.centre} crosses ${edge.id}`);
        } else if ((rest && segmentHits(segmentStart, segmentEnd, rest, 2)) || (head && segmentHits(segmentStart, segmentEnd, head, 2))) {
          cost += LINE_HIT;
          if (LayoutDebug.on()) LayoutDebug.log(`[place]   chain at c=${cand.centre} is hit by ${edge.id}`);
        }
      }
    }
    return cost;
  }

  /**
   * The cheapest candidate, or the one the local repair asked for (skip). The head and its number
   * of candidates are recorded (heads), so the repair knows what it can retry.
   */
  cheapest(id: string, plane: Plane, from: DShape, kind: ShapeKind, cands: Cand[]): Cand {
    const ranked: Array<{ cand: Cand; cost: number }> = [];
    for (const cand of cands) {
      const box = { x: cand.x, y: cand.centre - cand.size.height / 2, ...cand.size };
      const source = { ...from, bounds: cand.top ?? this.shiftedBox(from.bounds, cand.insert ?? cand.grow) };
      const cost = this.connectionCost(plane, source, box, kind, cand.insert ?? cand.grow) + this.chainCost(plane, box, cand) + cand.penalty;
      if (LayoutDebug.on()) LayoutDebug.log(`[place] from ${from.id} x=${cand.x} c=${cand.centre} penalty=${Math.round(cand.penalty)} cost=${Math.round(cost)}${cand.insert ? ` insert ${cand.insert.delta}` : ''}${cand.grow ? ` grow ${cand.grow.delta}` : ''}${cand.top ? ' top' : ''}`);
      ranked.push({ cand, cost });
    }
    // stable: equal costs keep the candidates' order
    ranked.sort((first, second) => first.cost - second.cost);
    (this.placer.heads ??= new Map()).set(id, ranked.length);
    const chosenIndex = Math.min(this.placer.skip?.get(id) ?? 0, ranked.length - 1);
    if (chosenIndex > 0 && LayoutDebug.on()) LayoutDebug.log(`[place] ${id}: candidate ${chosenIndex + 1} of ${ranked.length} (the local repair retries the chain)`);
    return ranked[chosenIndex]?.cand ?? cands[0]!;
  }

  /**
   * Horizontal segments between `floor` and `below` over [x0, x1] that a route from the anchor
   * down to a row would cross (bypass and loop-back lines), and the shapes they dock on.
   */
  private linesUnder(plane: Plane, x0: number, x1: number, floor: number, below: number): number[] {
    const out: number[] = [];
    for (const edge of plane.edges.values()) {
      const pointCount = edge.points.length;
      for (let index = 0; index + 1 < pointCount; index++) {
        const segmentStart = edge.points[index]!;
        const segmentEnd = edge.points[index + 1]!;
        if (Math.abs(segmentStart.y - segmentEnd.y) > 0.5 || segmentStart.y <= floor + 0.5 || segmentStart.y > below) continue;
        if (Math.max(segmentStart.x, segmentEnd.x) < x0 || Math.min(segmentStart.x, segmentEnd.x) > x1) continue;
        out.push(segmentStart.y);
        // a segment docking on a shape below the anchor: the shape moves with it
        for (const end of [index === 0 ? edge.sourceId : undefined, index + 1 === pointCount - 1 ? edge.targetId : undefined]) {
          const shape = end ? plane.shapes.get(end) : undefined;
          if (shape && PlaneQuery.isLeaf(shape) && shape.bounds.y > floor + 0.5) out.push(shape.bounds.y);
        }
      }
    }
    return out;
  }

  /**
   * Rows at or below `first`: the first free rows and, when the first row is taken or a line runs
   * between the anchor (left downwards at `descend`) and it, that row opened with the space tool.
   * An opened row costs less than one crossing.
   */
  rowCandidates(plane: Plane, probe: Pick<DShape, 'parentId' | 'poolId'>, frame: DShape | undefined, left: number, size: { width: number; height: number }, extent: number, first: number, step: number, floor: number, exclude: ReadonlySet<string>, basePenalty = 0, anchor?: DShape, descend?: number): Cand[] {
    const rows = this.freeRows(plane, frame, left, size.width, size.height, first, step, exclude, 3, extent);
    const band = this.obstacles.spaceBand(plane, probe, anchor);
    const moving = (line: number): number => [...plane.shapes.values()].filter((shape) => PlaneQuery.isLeaf(shape) && shape.bounds.y >= line && (!band.within || (shape.bounds.x < right(band.within) && right(shape.bounds) > band.within.x))).length;
    const cands: Cand[] = rows.map((row, rowIndex) => {
      const cand: Cand = { x: left, centre: row.centre, size, extent, penalty: basePenalty + 60 * rowIndex + (row.onLine ? 700 : 0) + Math.max(0, (row.centre - first) / step - 1) * 40 };
      /**
       * a row below the frame's interior grows the frame: content below it moves away (the shape
       * keeps clear of the frame's boundary events on its bottom border, SpaceTool borderPad)
       */
      const pad = frame ? Math.max(15, this.placer.drawing(plane).borderPad(frame, { x: left, y: row.centre - size.height / 2, ...size }, 'y')) : 15;
      if (frame && row.centre + size.height / 2 + pad > bottom(frame.bounds)) {
        const line = bottom(frame.bounds) - 1;
        const delta = Math.ceil(row.centre + size.height / 2 + pad - bottom(frame.bounds));
        cand.grow = { line, delta, ...band };
        cand.penalty += 10 * moving(line) + delta * 0.3;
      }
      return cand;
    });
    const box = { x: left, y: first - size.height / 2, width: size.width + extent, height: size.height };
    const x0 = Math.min(descend ?? left, left) - 10;
    const lines = this.linesUnder(plane, x0, right(box) + 10, floor, bottom(box) + 20);
    const clean = rows.some((row) => Math.abs(row.centre - first) < 1 && !row.onLine);
    if (clean && !lines.length) return cands;
    const blockers = this.obstacles.of(plane, frame, exclude).boxes.filter((blocker) => overlaps(blocker, box, 20));
    const tops = [...blockers.map((blocker) => blocker.y), ...lines];
    if (!tops.length) return cands;
    const top = Math.min(...tops);
    if (top <= floor) return cands;
    const insert: Shift = { line: top - 0.5, delta: Math.ceil(bottom(box) + 20 - top), ...band };
    if (LayoutDebug.on()) LayoutDebug.log(`[place] open row c=${first} floor=${Math.round(floor)} line=${insert.line} delta=${insert.delta} lines=${lines.join(',')} blockers=${blockers.map((blocker) => blocker.y).join(',')}`);
    const movingCount = Math.min(OPEN_MAX_SHAPES, moving(insert.line));
    cands.push({ x: left, centre: first, size, extent, penalty: basePenalty + OPEN_ROW + OPEN_PER_SHAPE * movingCount + insert.delta * 0.2, insert });
    return cands;
  }

  /**
   * Up to two free rows at or above `startCy` inside the frame's interior. A first row sticking
   * out at the top gets room at the frame's top first (an `insert`, costing like an opened row).
   * `top`: a boundary event's spot on the host's top border (moved down with the room).
   */
  rowsAbove(plane: Plane, probe: Probe, frame: DShape | undefined, anchor: DShape, left: number, size: { width: number; height: number }, extent: number, startCy: number, step: number, exclude: ReadonlySet<string>, penalty: number, top?: Box): Cand[] {
    const inner = frame ? Frames.interior(frame, 15) : undefined;
    const out: Cand[] = [];
    this.freeRows(plane, frame, left, size.width, size.height, startCy, step, exclude, 2, extent, true).forEach((row, rowIndex) => {
      if (inner && row.centre + size.height / 2 > bottom(inner)) return;
      if (!inner || row.centre - size.height / 2 >= inner.y) {
        out.push({ x: left, centre: row.centre, size, extent, penalty: penalty + 60 * rowIndex + (row.onLine ? 700 : 0), ...(top ? { top } : {}) });
        return;
      }
      if (rowIndex || Math.abs(row.centre - startCy) > 0.5) return;
      const delta = Math.ceil(inner.y - (row.centre - size.height / 2));
      const band = this.obstacles.spaceBand(plane, probe, anchor);
      const insert: Shift = { line: frame!.bounds.y + 1, delta, ...band };
      const moving = [...plane.shapes.values()].filter((shape) => PlaneQuery.isLeaf(shape) && shape.bounds.y >= insert.line && (!band.within || (shape.bounds.x < right(band.within) && right(shape.bounds) > band.within.x))).length;
      const shifted = top ? { ...top, y: top.y + delta } : undefined;
      out.push({ x: left, centre: row.centre + delta, size, extent, insert, penalty: penalty + OPEN_ROW + OPEN_PER_SHAPE * Math.min(OPEN_MAX_SHAPES, moving) + delta * 0.2 + (row.onLine ? 700 : 0), ...(shifted ? { top: shifted } : {}) });
    });
    return out;
  }

  /** Row centres used in a lane (clustered node centres), most populated first. */
  private laneRows(plane: Plane, lane: DShape, tol: number, exclude: ReadonlySet<string>): number[] {
    const centres = [...plane.shapes.values()].filter((shape) => PlaneQuery.isLeaf(shape) && shape.kind !== 'boundary' && shape.laneId === lane.id && !exclude.has(shape.id)).map((shape) => cy(shape.bounds)).sort((first, second) => first - second);
    const clusters: Array<{ centre: number; count: number }> = [];
    for (const centre of centres) {
      const last = clusters[clusters.length - 1];
      if (last && centre - last.centre <= tol) {
        last.centre = (last.centre * last.count + centre) / (last.count + 1);
        last.count++;
      } else clusters.push({ centre, count: 1 });
    }
    return clusters.sort((first, second) => second.count - first.count || first.centre - second.centre).map((cluster) => Math.round(cluster.centre));
  }

  /**
   * A free row centre in `lane`: rows of `prefer` (neighbours) first, then the lane's rows (most
   * populated first), its centre when empty, else a new row below its content.
   */
  rowInLane(plane: Plane, lane: DShape, left: number, width: number, height: number, prefer: number[], exclude: ReadonlySet<string>): number {
    const sp = this.placer.spacingFor(plane);
    const obs = this.obstacles.of(plane, lane, exclude);
    const inner = Frames.interior(lane, 10);
    const fitsIn = (centre: number, box: Box): boolean => centre - height / 2 >= box.y - 0.5 && centre + height / 2 <= bottom(box) + 0.5;
    const rows = this.laneRows(plane, lane, sp.rowTol, exclude);
    // the lane's own rows are used as tightly as the drawing does; others keep 10 px off borders
    const candidates = [...prefer.filter((centre) => fitsIn(centre, inner)), ...rows.filter((centre) => fitsIn(centre, lane.bounds))];
    if (!rows.length) candidates.push(Math.round(cy(inner)));
    for (const centre of candidates) {
      if (this.obstacles.isFree({ x: left, y: centre - height / 2, width, height }, obs)) return centre;
    }
    const below = this.obstacles.contentBottom(plane, lane, exclude);
    return Math.round((below ?? inner.y) + Math.max(30, sp.row - 80) + height / 2);
  }

  /**
   * Moves a candidate into the node's own lane when its anchor sits in another lane (one of a
   * same-lane anchor may reach below the lane: it grows).
   */
  intoOwnLane(plane: Plane, probe: Probe, left: number, centre: number, size: { width: number; height: number }, prefer: number[], anchor?: DShape): number {
    const lane = probe.laneId ? plane.shapes.get(probe.laneId) : undefined;
    if (!lane || (anchor && anchor.laneId === probe.laneId && centre - size.height / 2 >= Frames.interior(lane, 5).y)) return centre;
    const inner = Frames.interior(lane, 5);
    if (centre - size.height / 2 >= inner.y && centre + size.height / 2 <= bottom(inner)) return centre;
    return this.rowInLane(plane, lane, left, size.width, size.height, prefer, new Set([probe.id]));
  }
}
