import { LayoutDebug } from '../LayoutDebug.js';
import { bottom, cy, overlaps, pathHits, right, segmentHits, segmentsCross, type Box, type Point } from '../../drawing/utils/geom.js';
import { Frames } from '../../drawing/Frames.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';

import type { DShape, Plane, ShapeKind } from '../../drawing/types.js';
import { attachedSide, defaultSides } from '../../drawing/utils/sides.js';
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
  c: number;
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
  freeRows(plane: Plane, frame: DShape | undefined, x: number, width: number, height: number, startCy: number, step: number, exclude: ReadonlySet<string>, count: number, extent = 0, up = false): Array<{ c: number; onLine: boolean }> {
    const obs = this.obstacles.of(plane, frame, exclude);
    const shapesOnly = { boxes: obs.boxes, labels: [] };
    const segs = this.obstacles.edgeBoxes(plane);
    const out: Array<{ c: number; onLine: boolean }> = [];
    for (let k = 0; k < 40 && out.length < count; k++) {
      const c = startCy + (up ? -k : k) * step;
      const box = { x, y: c - height / 2, width, height };
      if (!this.obstacles.isFree(box, obs) || (extent > 0 && !this.obstacles.isFree({ ...box, x: x + width, width: extent }, shapesOnly))) continue;
      out.push({ c, onLine: segs.some((sg) => overlaps(sg, box, 4)) });
    }
    if (!out.length && !up) out.push({ c: startCy, onLine: false });
    return out;
  }

  private shiftedBox(b: Box, sh: Shift | undefined): Box {
    return sh && b.y >= sh.line ? { ...b, y: b.y + sh.delta } : b;
  }

  private shiftedLine(pts: Point[], sh: Shift | undefined): Point[] {
    return sh ? pts.map((p) => (p.y >= sh.line ? { x: p.x, y: p.y + sh.delta } : p)) : pts;
  }

  /**
   * A trial route from `from` to a candidate box, charged for cut shapes, crossed lines, labels
   * hit, bends and length. `shift` approximates a row opened by the space tool.
   */
  private connectionCost(plane: Plane, from: DShape, to: Box, toKind: ShapeKind, shift?: Shift): number {
    const host = from.hostId ? plane.shapes.get(from.hostId) : undefined;
    const obstacles: Box[] = [];
    for (const o of plane.shapes.values()) {
      if (o.id === from.id || o.kind === 'group') continue;
      if (PlaneQuery.isLeaf(o) || (o.kind === 'subProcess' && o.container && o.id !== from.parentId)) obstacles.push(this.shiftedBox(o.bounds, shift));
    }
    const flows = [...plane.edges.values()].map((e) => this.shiftedLine(e.points, shift)).filter((p) => p.length >= 2);
    const lines = this.placer.drawing(plane).routingLines().map((l) => this.shiftedLine(l, shift));
    const hostBox = host ? this.shiftedBox(host.bounds, shift) : undefined;
    const sourceSides = from.kind === 'boundary' && hostBox ? [attachedSide(from.bounds, hostBox)] : defaultSides(from.kind, 'source');
    const pts = OrthogonalRouter.route({ source: from.bounds, target: to, sourceSides, targetSides: defaultSides(toKind, 'target'), obstacles, lines });
    let cost = 0;
    for (let i = 0; i + 1 < pts.length; i++) cost += Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
    cost = cost * 0.5 + (pts.length - 2) * 30;
    for (const o of obstacles) if (o !== hostBox && pathHits(pts, o)) cost += 2000;
    for (const line of flows) {
      for (let i = 0; i + 1 < pts.length; i++) {
        for (let j = 0; j + 1 < line.length; j++) if (segmentsCross(pts[i]!, pts[i + 1]!, line[j]!, line[j + 1]!)) cost += CROSSING;
      }
    }
    const labels = [...plane.shapes.values(), ...plane.edges.values()].map((x) => x.label).filter((l): l is Box => !!l);
    for (const l of labels) for (let i = 0; i + 1 < pts.length; i++) if (segmentHits(pts[i]!, pts[i + 1]!, this.shiftedBox(l, shift), 0)) cost += 60;
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
    for (const e of plane.edges.values()) {
      const line = this.shiftedLine(e.points, shift);
      for (let j = 0; j + 1 < line.length; j++) {
        const p = line[j]!;
        const q = line[j + 1]!;
        if (run && segmentsCross(run[0], run[1], p, q)) {
          cost += CROSSING;
          if (LayoutDebug.on()) LayoutDebug.log(`[place]   chain at c=${cand.c} crosses ${e.id}`);
        } else if ((rest && segmentHits(p, q, rest, 2)) || (head && segmentHits(p, q, head, 2))) {
          cost += LINE_HIT;
          if (LayoutDebug.on()) LayoutDebug.log(`[place]   chain at c=${cand.c} is hit by ${e.id}`);
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
      const box = { x: cand.x, y: cand.c - cand.size.height / 2, ...cand.size };
      const source = { ...from, bounds: cand.top ?? this.shiftedBox(from.bounds, cand.insert ?? cand.grow) };
      const cost = this.connectionCost(plane, source, box, kind, cand.insert ?? cand.grow) + this.chainCost(plane, box, cand) + cand.penalty;
      if (LayoutDebug.on()) LayoutDebug.log(`[place] from ${from.id} x=${cand.x} c=${cand.c} penalty=${Math.round(cand.penalty)} cost=${Math.round(cost)}${cand.insert ? ` insert ${cand.insert.delta}` : ''}${cand.grow ? ` grow ${cand.grow.delta}` : ''}${cand.top ? ' top' : ''}`);
      ranked.push({ cand, cost });
    }
    // stable: equal costs keep the candidates' order
    ranked.sort((a, b) => a.cost - b.cost);
    (this.placer.heads ??= new Map()).set(id, ranked.length);
    const k = Math.min(this.placer.skip?.get(id) ?? 0, ranked.length - 1);
    if (k > 0 && LayoutDebug.on()) LayoutDebug.log(`[place] ${id}: candidate ${k + 1} of ${ranked.length} (the local repair retries the chain)`);
    return ranked[k]?.cand ?? cands[0]!;
  }

  /**
   * Horizontal segments between `floor` and `below` over [x0, x1] that a route from the anchor
   * down to a row would cross (bypass and loop-back lines), and the shapes they dock on.
   */
  private linesUnder(plane: Plane, x0: number, x1: number, floor: number, below: number): number[] {
    const out: number[] = [];
    for (const e of plane.edges.values()) {
      const n = e.points.length;
      for (let i = 0; i + 1 < n; i++) {
        const p = e.points[i]!;
        const q = e.points[i + 1]!;
        if (Math.abs(p.y - q.y) > 0.5 || p.y <= floor + 0.5 || p.y > below) continue;
        if (Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1) continue;
        out.push(p.y);
        // a segment docking on a shape below the anchor: the shape moves with it
        for (const end of [i === 0 ? e.sourceId : undefined, i + 1 === n - 1 ? e.targetId : undefined]) {
          const s = end ? plane.shapes.get(end) : undefined;
          if (s && PlaneQuery.isLeaf(s) && s.bounds.y > floor + 0.5) out.push(s.bounds.y);
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
  rowCandidates(plane: Plane, probe: Pick<DShape, 'parentId' | 'poolId'>, frame: DShape | undefined, x: number, size: { width: number; height: number }, extent: number, first: number, step: number, floor: number, exclude: ReadonlySet<string>, basePenalty = 0, anchor?: DShape, descend?: number): Cand[] {
    const rows = this.freeRows(plane, frame, x, size.width, size.height, first, step, exclude, 3, extent);
    const band = this.obstacles.spaceBand(plane, probe, anchor);
    const moving = (line: number): number => [...plane.shapes.values()].filter((s) => PlaneQuery.isLeaf(s) && s.bounds.y >= line && (!band.within || (s.bounds.x < right(band.within) && right(s.bounds) > band.within.x))).length;
    const cands: Cand[] = rows.map((r, k) => {
      const cand: Cand = { x, c: r.c, size, extent, penalty: basePenalty + 60 * k + (r.onLine ? 700 : 0) + Math.max(0, (r.c - first) / step - 1) * 40 };
      /**
       * a row below the frame's interior grows the frame: content below it moves away (the shape
       * keeps clear of the frame's boundary events on its bottom border, SpaceTool borderPad)
       */
      const pad = frame ? Math.max(15, this.placer.drawing(plane).borderPad(frame, { x, y: r.c - size.height / 2, ...size }, 'y')) : 15;
      if (frame && r.c + size.height / 2 + pad > bottom(frame.bounds)) {
        const line = bottom(frame.bounds) - 1;
        const delta = Math.ceil(r.c + size.height / 2 + pad - bottom(frame.bounds));
        cand.grow = { line, delta, ...band };
        cand.penalty += 10 * moving(line) + delta * 0.3;
      }
      return cand;
    });
    const box = { x, y: first - size.height / 2, width: size.width + extent, height: size.height };
    const x0 = Math.min(descend ?? x, x) - 10;
    const lines = this.linesUnder(plane, x0, right(box) + 10, floor, bottom(box) + 20);
    const clean = rows.some((r) => Math.abs(r.c - first) < 1 && !r.onLine);
    if (clean && !lines.length) return cands;
    const blockers = this.obstacles.of(plane, frame, exclude).boxes.filter((b) => overlaps(b, box, 20));
    const tops = [...blockers.map((b) => b.y), ...lines];
    if (!tops.length) return cands;
    const top = Math.min(...tops);
    if (top <= floor) return cands;
    const insert: Shift = { line: top - 0.5, delta: Math.ceil(bottom(box) + 20 - top), ...band };
    if (LayoutDebug.on()) LayoutDebug.log(`[place] open row c=${first} floor=${Math.round(floor)} line=${insert.line} delta=${insert.delta} lines=${lines.join(',')} blockers=${blockers.map((b) => b.y).join(',')}`);
    const n = Math.min(OPEN_MAX_SHAPES, moving(insert.line));
    cands.push({ x, c: first, size, extent, penalty: basePenalty + OPEN_ROW + OPEN_PER_SHAPE * n + insert.delta * 0.2, insert });
    return cands;
  }

  /**
   * Up to two free rows at or above `startCy` inside the frame's interior. A first row sticking
   * out at the top gets room at the frame's top first (an `insert`, costing like an opened row).
   * `top`: a boundary event's spot on the host's top border (moved down with the room).
   */
  rowsAbove(plane: Plane, probe: Probe, frame: DShape | undefined, anchor: DShape, x: number, size: { width: number; height: number }, extent: number, startCy: number, step: number, exclude: ReadonlySet<string>, penalty: number, top?: Box): Cand[] {
    const inner = frame ? Frames.interior(frame, 15) : undefined;
    const out: Cand[] = [];
    this.freeRows(plane, frame, x, size.width, size.height, startCy, step, exclude, 2, extent, true).forEach((r, k) => {
      if (inner && r.c + size.height / 2 > bottom(inner)) return;
      if (!inner || r.c - size.height / 2 >= inner.y) {
        out.push({ x, c: r.c, size, extent, penalty: penalty + 60 * k + (r.onLine ? 700 : 0), ...(top ? { top } : {}) });
        return;
      }
      if (k || Math.abs(r.c - startCy) > 0.5) return;
      const delta = Math.ceil(inner.y - (r.c - size.height / 2));
      const band = this.obstacles.spaceBand(plane, probe, anchor);
      const insert: Shift = { line: frame!.bounds.y + 1, delta, ...band };
      const moving = [...plane.shapes.values()].filter((s) => PlaneQuery.isLeaf(s) && s.bounds.y >= insert.line && (!band.within || (s.bounds.x < right(band.within) && right(s.bounds) > band.within.x))).length;
      const shifted = top ? { ...top, y: top.y + delta } : undefined;
      out.push({ x, c: r.c + delta, size, extent, insert, penalty: penalty + OPEN_ROW + OPEN_PER_SHAPE * Math.min(OPEN_MAX_SHAPES, moving) + delta * 0.2 + (r.onLine ? 700 : 0), ...(shifted ? { top: shifted } : {}) });
    });
    return out;
  }

  /** Row centres used in a lane (clustered node centres), most populated first. */
  private laneRows(plane: Plane, lane: DShape, tol: number, exclude: ReadonlySet<string>): number[] {
    const centres = [...plane.shapes.values()].filter((s) => PlaneQuery.isLeaf(s) && s.kind !== 'boundary' && s.laneId === lane.id && !exclude.has(s.id)).map((s) => cy(s.bounds)).sort((a, b) => a - b);
    const clusters: Array<{ c: number; n: number }> = [];
    for (const c of centres) {
      const last = clusters[clusters.length - 1];
      if (last && c - last.c <= tol) {
        last.c = (last.c * last.n + c) / (last.n + 1);
        last.n++;
      } else clusters.push({ c, n: 1 });
    }
    return clusters.sort((a, b) => b.n - a.n || a.c - b.c).map((k) => Math.round(k.c));
  }

  /**
   * A free row centre in `lane`: rows of `prefer` (neighbours) first, then the lane's rows (most
   * populated first), its centre when empty, else a new row below its content.
   */
  rowInLane(plane: Plane, lane: DShape, x: number, width: number, height: number, prefer: number[], exclude: ReadonlySet<string>): number {
    const sp = this.placer.spacingFor(plane);
    const obs = this.obstacles.of(plane, lane, exclude);
    const inner = Frames.interior(lane, 10);
    const fitsIn = (c: number, b: Box): boolean => c - height / 2 >= b.y - 0.5 && c + height / 2 <= bottom(b) + 0.5;
    const rows = this.laneRows(plane, lane, sp.rowTol, exclude);
    // the lane's own rows are used as tightly as the drawing does; others keep 10 px off borders
    const candidates = [...prefer.filter((c) => fitsIn(c, inner)), ...rows.filter((c) => fitsIn(c, lane.bounds))];
    if (!rows.length) candidates.push(Math.round(cy(inner)));
    for (const c of candidates) {
      if (this.obstacles.isFree({ x, y: c - height / 2, width, height }, obs)) return c;
    }
    const below = this.obstacles.contentBottom(plane, lane, exclude);
    return Math.round((below ?? inner.y) + Math.max(30, sp.row - 80) + height / 2);
  }

  /**
   * Moves a candidate into the node's own lane when its anchor sits in another lane (one of a
   * same-lane anchor may reach below the lane: it grows).
   */
  intoOwnLane(plane: Plane, probe: Probe, x: number, c: number, size: { width: number; height: number }, prefer: number[], anchor?: DShape): number {
    const lane = probe.laneId ? plane.shapes.get(probe.laneId) : undefined;
    if (!lane || (anchor && anchor.laneId === probe.laneId && c - size.height / 2 >= Frames.interior(lane, 5).y)) return c;
    const inner = Frames.interior(lane, 5);
    if (c - size.height / 2 >= inner.y && c + size.height / 2 <= bottom(inner)) return c;
    return this.rowInLane(plane, lane, x, size.width, size.height, prefer, new Set([probe.id]));
  }
}
