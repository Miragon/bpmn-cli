import { LayoutDebug } from '../LayoutDebug.js';
import { bottom, type Box, containsPoint, cx, cy, overlaps, right, translateEdge, translateShape } from '../../utils/geom.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import { defaultLabelSide, hasExternalLabel, labelAt } from '../../utils/labels.js';
import { raw } from '../../utils/raw.js';
import { labelSize } from '../../utils/text.js';
import type { DShape, Plane } from '../../di/types.js';
import { bandOf, beyondBand, centreInBand, far, near, overlapsBand, pointInBand, resize, shiftBox, type Axis } from '../../utils/bands.js';

export interface SpaceRequest {
  axis: Axis;
  line: number;
  delta: number;
  /** restricts the effect to this box's band on the other axis */
  within?: Box;
  frame?: string;
  keep?: ReadonlySet<string>;
  /** growing only: crossed sub-processes holding none of these move or stay whole, never grow */
  anchors?: ReadonlyArray<string | undefined>;
  /**
   * Beyond the line only these shapes move (boundary events with their host, content with its
   * container) and only connections touching a changed shape or listed here bend; groups the line
   * crosses grow only when listed. Pools and lanes keep the usual rules.
   */
  push?: ReadonlySet<string>;
}

export interface SpaceResult {
  moved: Set<string>;
  resized: Set<string>;
}

type Decision = 'move' | 'resize' | 'stay';

const FRAME_GAP = 20;
const FRAME_PAD = 10;

/**
 * Frame mode: room is made inside `frame`. An ancestor grows when grown content sticks out of it;
 * a frame that would cover a foreign shape makes the room one level further out instead.
 */
interface FrameScope {
  frame: DShape;
  ancestors: Set<string>;
  grow: Set<string>;
}

interface Pass {
  plane: Plane;
  axis: Axis;
  line: number;
  delta: number;
  band: [number, number] | undefined;
  keep: ReadonlySet<string>;
  before: Map<string, Box>;
  held: Set<string> | undefined;
  push: ReadonlySet<string> | undefined;
  scope?: FrameScope;
}

const LABEL_PAD = 5;

export interface StripRequest {
  axis: Axis;
  from: number;
  to: number;
  gap: number;
  within?: Box;
  /** edges whose bends do not count (they are rerouted anyway) */
  ignore?: ReadonlySet<string>;
  keep?: ReadonlySet<string>;
}

/**
 * The modeler's space tool on a plane: shapes beyond a line move, containers the line crosses
 * grow, and connections and labels follow. Also closes strips and fits shapes into their frames.
 */
export class SpaceTool {
  constructor(private readonly plane: Plane) {}

  shiftShape(id: string, dx: number, dy: number): string[] {
    const shape = this.plane.shapes.get(id);
    if (!shape || (!dx && !dy)) return [];
    const moved = [id];
    const move = (moving: DShape): void => translateShape(moving, dx, dy);
    move(shape);
    for (const boundary of PlaneQuery.boundariesOf(this.plane, id)) {
      move(boundary);
      moved.push(boundary.id);
    }
    if (shape.container && shape.kind === 'subProcess') {
      const { shapes, edges } = PlaneQuery.contentOf(this.plane, id);
      for (const child of shapes) {
        move(child);
        moved.push(child.id);
      }
      const inside = new Set(shapes.map((child) => child.id));
      for (const edge of edges) {
        if (!(edge.sourceId && inside.has(edge.sourceId)) || !(edge.targetId && inside.has(edge.targetId))) {
          continue;
        }
        translateEdge(edge, dx, dy);
      }
    }
    return moved;
  }

  /**
   * Pools that ended with a grown one grow with it, never shrinking past their content or the
   * message flows docking on them.
   */
  private alignPoolsAndLanes(before: Map<string, Box>, res: SpaceResult): void {
    const pools = [...this.plane.shapes.values()].filter((shape) => shape.kind === 'participant');
    const grown = pools.filter((pool) => res.resized.has(pool.id));
    if (!grown.length) return;
    for (const grownPool of grown) {
      const old = before.get(grownPool.id)!;
      for (const pool of pools) {
        if (pool === grownPool || res.resized.has(pool.id) || res.moved.has(pool.id)) {
          continue;
        }
        if (Math.abs(right(before.get(pool.id)!) - right(old)) > 2) continue;
        const target = right(grownPool.bounds);
        if (target < right(pool.bounds)) {
          const content = [...this.plane.shapes.values()].filter((shape) => shape.poolId === pool.id && shape.kind !== 'lane').map((shape) => right(shape.bounds) + 15);
          const docks = [...this.plane.edges.values()].flatMap((edge) => [edge.sourceId === pool.id ? edge.points[0] : undefined, edge.targetId === pool.id ? edge.points[edge.points.length - 1] : undefined]).filter((dock): dock is { x: number; y: number } => !!dock).map((dock) => dock.x + 15);
          if (Math.max(-Infinity, ...content, ...docks) > target) continue;
        }
        pool.bounds.width = target - pool.bounds.x;
        res.resized.add(pool.id);
      }
    }
    for (const lane of this.plane.shapes.values()) {
      if (lane.kind !== 'lane' || !lane.poolId) continue;
      const pool = this.plane.shapes.get(lane.poolId);
      const oldPool = pool && before.get(pool.id);
      const oldLane = before.get(lane.id);
      if (!pool || !oldPool || !oldLane || !res.resized.has(pool.id)) continue;
      if (Math.abs(right(oldLane) - right(oldPool)) <= 2 && Math.abs(right(lane.bounds) - right(pool.bounds)) > 0.5) {
        lane.bounds.width = right(pool.bounds) - lane.bounds.x;
        res.resized.add(lane.id);
      }
    }
  }

  /** For shapes without a semantic pool (collaboration-level artifacts): by their centre. */
  private geometricPool(shape: DShape, before: ReadonlyMap<string, Box>): string | undefined {
    if (shape.poolId || shape.kind === 'participant' || shape.kind === 'lane' || shape.kind === 'group' || shape.hostId || shape.parentId) {
      return shape.poolId;
    }
    const centre = { x: cx(shape.bounds), y: cy(shape.bounds) };
    for (const pool of this.plane.shapes.values()) {
      if (pool.kind !== 'participant') continue;
      const poolBox = before.get(pool.id) ?? pool.bounds;
      if (centre.x >= poolBox.x && centre.x <= right(poolBox) && centre.y >= poolBox.y && centre.y <= bottom(poolBox)) {
        return pool.id;
      }
    }
    return undefined;
  }

  /** For shapes no lane lists (data objects, annotations): the innermost lane at their centre. */
  private geometricLane(shape: DShape, before: ReadonlyMap<string, Box>): string | undefined {
    if (shape.laneId || shape.hostId || shape.parentId || shape.kind === 'participant' || shape.kind === 'lane' || shape.kind === 'group') {
      return shape.laneId;
    }
    const centre = { x: cx(shape.bounds), y: cy(shape.bounds) };
    let best: Box | undefined;
    let id: string | undefined;
    for (const lane of this.plane.shapes.values()) {
      if (lane.kind !== 'lane' || (shape.poolId && lane.poolId !== shape.poolId)) {
        continue;
      }
      const laneBox = before.get(lane.id) ?? lane.bounds;
      if (centre.x < laneBox.x || centre.x > right(laneBox) || centre.y < laneBox.y || centre.y > bottom(laneBox)) {
        continue;
      }
      if (!best || laneBox.width * laneBox.height < best.width * best.height) {
        best = laneBox;
        id = lane.id;
      }
    }
    return id;
  }

  /**
   * Whether one of `lanes` holds `shape` (or its host): by its frame, else (artifacts, groups,
   * nodes no lane lists) by where its centre was drawn.
   */
  private inLanes(lanes: DShape[], shape: DShape, before: ReadonlyMap<string, Box>): boolean {
    const owner = shape.hostId ? this.plane.shapes.get(shape.hostId) ?? shape : shape;
    if (Frames.of(this.plane, owner)) {
      return lanes.some((lane) => Frames.within(this.plane, owner, lane));
    }
    const box = before.get(owner.id) ?? owner.bounds;
    return lanes.some((lane) => containsPoint(before.get(lane.id)!, { x: cx(box), y: cy(box) }));
  }

  /** A shrunk container keeps `pad` beyond its members and never ends further out than before. */
  private capShrink(container: DShape, axis: Axis, before: Box, pad = 10): void {
    let need = -Infinity;
    for (const shape of this.plane.shapes.values()) {
      if (shape === container || shape.kind === 'participant' || shape.kind === 'lane' || shape.kind === 'group') {
        continue;
      }
      if (!Frames.within(this.plane, shape, container)) continue;
      need = Math.max(need, far(shape.bounds, axis) + (shape.kind === 'boundary' ? 0 : pad));
    }
    const limit = Math.min(need, far(before, axis));
    if (far(container.bounds, axis) >= limit) return;
    if (axis === 'x') {
      container.bounds.width = limit - container.bounds.x;
    } else {
      container.bounds.height = limit - container.bounds.y;
    }
  }

  /**
   * With a push set a crossed pool or lane grows only as far as its content now reaches, keeping
   * the margin it had; a lane that ended with its pool ends with it again. Without a pool the lanes
   * that ended with a grown top lane grow like a pool, also holding the groups drawn in them.
   */
  private capGrowth(pass: Pass, res: SpaceResult): void {
    const { axis, delta, before } = pass;
    const setFar = (container: DShape, to: number): void => {
      if (axis === 'x') {
        container.bounds.width = to - container.bounds.x;
      } else {
        container.bounds.height = to - container.bounds.y;
      }
      if (Math.abs(to - far(before.get(container.id)!, axis)) < 0.5) {
        res.resized.delete(container.id);
      } else {
        res.resized.add(container.id);
      }
    };
    const cap = (frames: DShape[], holds: (shape: DShape) => boolean): void => {
      let farBefore = -Infinity;
      let farNow = -Infinity;
      for (const shape of this.plane.shapes.values()) {
        if (shape.kind === 'participant' || shape.kind === 'lane' || !holds(shape)) {
          continue;
        }
        const shift = res.moved.has(shape.id) ? delta : 0;
        farBefore = Math.max(farBefore, far(before.get(shape.id)!, axis), shape.label ? far(shape.label, axis) - shift : -Infinity);
        farNow = Math.max(farNow, far(shape.bounds, axis), shape.label ? far(shape.label, axis) : -Infinity);
      }
      const old = Math.max(...frames.map((frame) => far(before.get(frame.id)!, axis)));
      if (Number.isFinite(farNow)) {
        for (const frame of frames) {
          setFar(frame, old + Math.min(delta, Math.max(0, farNow + Math.max(0, old - farBefore) - old)));
        }
      }
    };
    const containers = [...res.resized].map((id) => this.plane.shapes.get(id)!).filter((shape) => shape.kind === 'participant' || shape.kind === 'lane');
    for (const pool of containers.filter((shape) => shape.kind === 'participant')) {
      cap([pool], (shape) => shape.kind !== 'group' && Frames.within(this.plane, shape, pool));
    }
    const free = [...this.plane.shapes.values()].filter((shape) => shape.kind === 'lane' && !shape.poolId);
    /** a lane beyond the line moved: the lanes do not end where the line crosses them */
    const tops = free.some((lane) => res.moved.has(lane.id)) ? [] : free.filter((lane) => !lane.laneId && res.resized.has(lane.id));
    const done = new Set<DShape>();
    for (const top of tops) {
      if (done.has(top)) continue;
      const end = far(before.get(top.id)!, axis);
      const set = free.filter((lane) => Math.abs(far(before.get(lane.id)!, axis) - end) <= 2);
      set.forEach((lane) => done.add(lane));
      cap(set, (shape) => this.inLanes(set, shape, before));
    }
    for (const lane of containers.filter((shape) => shape.kind === 'lane')) {
      const pool = lane.poolId ? this.plane.shapes.get(lane.poolId) : undefined;
      if (pool && Math.abs(far(before.get(lane.id)!, axis) - far(before.get(pool.id)!, axis)) <= 2) {
        setFar(lane, far(pool.bounds, axis));
      }
    }
  }

  private holders(anchors: ReadonlyArray<string | undefined>): Set<string> {
    const out = new Set<string>();
    for (const id of anchors) {
      let cur = id ? this.plane.shapes.get(id) : undefined;
      if (cur?.hostId) cur = this.plane.shapes.get(cur.hostId) ?? cur;
      for (let depth = 0; cur && depth < 20; depth++) {
        out.add(cur.id);
        cur = cur.parentId ? this.plane.shapes.get(cur.parentId) : undefined;
      }
    }
    return out;
  }

  private nearestSegment(pts: ReadonlyArray<{ x: number; y: number }>, box: Box): number {
    const centre = { x: cx(box), y: cy(box) };
    let best = 0;
    let dist = Infinity;
    for (let index = 0; index + 1 < pts.length; index++) {
      const segStart = pts[index]!;
      const segEnd = pts[index + 1]!;
      const dx = segEnd.x - segStart.x;
      const dy = segEnd.y - segStart.y;
      const len = dx * dx + dy * dy;
      const projection = len ? Math.max(0, Math.min(1, ((centre.x - segStart.x) * dx + (centre.y - segStart.y) * dy) / len)) : 0;
      const distance = Math.hypot(centre.x - (segStart.x + projection * dx), centre.y - (segStart.y + projection * dy));
      if (distance < dist - 1e-9) {
        dist = distance;
        best = index;
      }
    }
    return best;
  }

  private frameChain(shape: DShape): DShape[] {
    const out: DShape[] = [];
    let cur = shape.hostId ? this.plane.shapes.get(shape.hostId) ?? shape : shape;
    if (cur !== shape) out.push(cur);
    for (let depth = 0; depth < 16; depth++) {
      const frame = Frames.of(this.plane, cur);
      if (!frame || out.includes(frame)) break;
      out.push(frame);
      cur = frame;
    }
    return out;
  }

  /** Without a push set everything beyond the line may move. */
  private pushed(pass: Pass, shape: DShape): boolean {
    return !pass.push || shape.kind === 'participant' || shape.kind === 'lane' || pass.push.has(shape.id);
  }

  private rigid(pass: Pass, candidate: DShape): boolean {
    if (!pass.held || candidate.kind !== 'subProcess' || !candidate.container || pass.held.has(candidate.id) || pass.keep.has(candidate.id)) {
      return false;
    }
    const box = pass.before.get(candidate.id)!;
    return near(box, pass.axis) < pass.line && far(box, pass.axis) > pass.line && overlapsBand(box, pass.band, pass.axis);
  }

  private rigidAround(pass: Pass, shape: DShape): DShape | undefined {
    let out: DShape | undefined;
    let cur = shape.parentId ? pass.plane.shapes.get(shape.parentId) : undefined;
    for (let depth = 0; cur && depth < 20; depth++) {
      if (this.rigid(pass, cur)) out = cur;
      cur = cur.parentId ? pass.plane.shapes.get(cur.parentId) : undefined;
    }
    return out;
  }

  private insideFrame(pass: Pass, shape: DShape): boolean {
    const scope = pass.scope!;
    if (this.frameChain(shape).includes(scope.frame)) return true;
    if (shape.container || shape.kind === 'group' || scope.ancestors.has(shape.id)) {
      return false;
    }
    const box = pass.before.get(shape.id)!;
    const frameBox = pass.before.get(scope.frame.id)!;
    const centre = { x: cx(box), y: cy(box) };
    return centre.x > frameBox.x && centre.x < right(frameBox) && centre.y > frameBox.y && centre.y < bottom(frameBox);
  }

  /** Undefined for the frame and its content, which follow the usual rules. */
  private scopeDecision(pass: Pass, shape: DShape): Decision | undefined {
    const scope = pass.scope;
    if (!scope || shape === scope.frame || this.insideFrame(pass, shape)) {
      return undefined;
    }
    if (!scope.ancestors.has(shape.id) || !scope.grow.has(shape.id)) return 'stay';
    const box = pass.before.get(shape.id)!;
    return near(box, pass.axis) < pass.line && far(box, pass.axis) > pass.line ? 'resize' : 'stay';
  }

  /**
   * Top-down: the content of a container beyond the line goes with its container.
   * Boundary events of a resized host stay on its border, which moves only beyond the line. A pool
   * or lane reaching beyond the band holds content that stays, so it never shrinks.
   */
  private decideAll(pass: Pass): Map<string, Decision> {
    const { plane, axis, line, delta, band, keep, before } = pass;
    const decision = new Map<string, Decision>();
    const decide = (shape: DShape, depth = 0): Decision => {
      const known = decision.get(shape.id);
      if (known) return known;
      let verdict: Decision = 'stay';
      const host = shape.hostId ? plane.shapes.get(shape.hostId) : undefined;
      /**
       * collaboration-level artifacts go with the pool they are drawn in,
       * shapes no lane lists with the lane they are drawn in
       */
      const carrier = [shape.kind === 'participant' ? undefined : this.geometricPool(shape, before), this.geometricLane(shape, before), shape.parentId]
        .map((id) => (id ? plane.shapes.get(id) : undefined))
        .find((carrierShape) => !!carrierShape && near(before.get(carrierShape.id)!, axis) >= line);
      const hostDecision = host && depth < 20 ? decide(host, depth + 1) : undefined;
      const scoped = host ? undefined : this.scopeDecision(pass, shape);
      const block = pass.held && !host && !carrier ? this.rigidAround(pass, shape) : undefined;
      if (keep.has(shape.id)) {
        verdict = 'stay';
      } else if (host && hostDecision && (!host.container || hostDecision !== 'resize')) {
        verdict = hostDecision === 'move' ? 'move' : 'stay';
      } else if (host && hostDecision === 'resize') {
        const eb = before.get(shape.id)!;
        verdict = (axis === 'x' ? cx(eb) : cy(eb)) >= line ? 'move' : 'stay';
      } else if (scoped) {
        verdict = scoped;
      } else if (carrier && depth < 20) {
        verdict = decide(carrier, depth + 1) === 'move' ? 'move' : 'stay';
      } else if (block && depth < 20) {
        verdict = decide(block, depth + 1) === 'move' ? 'move' : 'stay';
      } else if (this.rigid(pass, shape)) {
        const box = before.get(shape.id)!;
        verdict = (axis === 'x' ? cx(box) : cy(box)) >= line && this.pushed(pass, shape) ? 'move' : 'stay';
      } else {
        const ref = before.get(shape.id)!;
        if (near(ref, axis) >= line) {
          verdict = overlapsBand(ref, band, axis) && this.pushed(pass, shape) ? 'move' : 'stay';
        } else if ((shape.container || (shape.kind === 'group' && this.pushed(pass, shape))) && far(ref, axis) > line && overlapsBand(ref, band, axis)) {
          verdict = delta < 0 && beyondBand(ref, band, axis) ? 'stay' : 'resize';
        }
      }
      decision.set(shape.id, verdict);
      return verdict;
    };
    for (const shape of plane.shapes.values()) {
      decide(shape);
    }
    return decision;
  }

  /**
   * Connections inside a rigid sub-process move or stay with it as a whole; an edge label goes with
   * the segment nearest to it.
   */
  private applyPass(pass: Pass, decision: ReadonlyMap<string, Decision>): SpaceResult {
    const { plane, axis, line, delta, band, keep, before } = pass;
    const res: SpaceResult = { moved: new Set(), resized: new Set() };
    for (const shape of plane.shapes.values()) {
      const verdict = decision.get(shape.id);
      if (verdict === 'move') {
        shiftBox(shape.bounds, axis, delta);
        if (shape.label) shiftBox(shape.label, axis, delta);
        res.moved.add(shape.id);
      } else if (verdict === 'resize') {
        resize(shape.bounds, axis, delta);
        res.resized.add(shape.id);
      }
    }
    if (delta < 0) {
      for (const id of res.resized) {
        const container = plane.shapes.get(id)!;
        if (container.container) this.capShrink(container, axis, before.get(id)!);
      }
    }
    if (pass.push && delta > 0) this.capGrowth(pass, res);
    if (axis === 'x') this.alignPoolsAndLanes(before, res);

    const blockOf = new Map<string, string>();
    if (pass.held) {
      for (const shape of plane.shapes.values()) {
        if (!this.rigid(pass, shape) || this.rigidAround(pass, shape)) continue;
        blockOf.set(shape.id, shape.id);
        for (const boundary of PlaneQuery.boundariesOf(plane, shape.id)) {
          blockOf.set(boundary.id, shape.id);
        }
        for (const child of PlaneQuery.contentOf(plane, shape.id).shapes) {
          blockOf.set(child.id, shape.id);
        }
      }
    }
    const changed = (id: string | undefined): boolean => !!id && (res.moved.has(id) || res.resized.has(id));
    const outside = (id: string | undefined): boolean => {
      const shape = id ? plane.shapes.get(id) : undefined;
      return !shape || (shape !== pass.scope!.frame && !this.insideFrame(pass, shape));
    };

    for (const edge of plane.edges.values()) {
      if (edge.sourceId && edge.targetId && keep.has(edge.sourceId) && keep.has(edge.targetId)) {
        continue;
      }
      if (pass.scope && !changed(edge.sourceId) && !changed(edge.targetId) && outside(edge.sourceId) && outside(edge.targetId)) {
        continue;
      }
      const pointCount = edge.points.length;
      const bends = !pass.push || pass.push.has(edge.id) || changed(edge.sourceId) || changed(edge.targetId);
      const block = edge.sourceId && edge.targetId ? blockOf.get(edge.sourceId) : undefined;
      const inBlock = !!block && blockOf.get(edge.targetId!) === block;
      const seg = edge.label && pointCount >= 2 ? this.nearestSegment(edge.points, edge.label) : -1;
      const shifted: boolean[] = [];
      edge.points.forEach((pt, index) => {
        const endId = index === 0 ? edge.sourceId : index === pointCount - 1 ? edge.targetId : undefined;
        const end = endId ? plane.shapes.get(endId) : undefined;
        const beyond = (axis === 'x' ? pt.x : pt.y) >= line;
        let shift: boolean;
        if (inBlock) {
          shift = res.moved.has(block);
        } else if (end && res.moved.has(end.id)) {
          shift = true;
        } else if (end && res.resized.has(end.id)) {
          shift = beyond;
        } else if (end) {
          shift = false;
        } else {
          shift = beyond && bends && pointInBand(pt, band, axis);
        }
        shifted.push(shift);
        if (shift) {
          if (axis === 'x') {
            pt.x += delta;
          } else {
            pt.y += delta;
          }
        }
      });
      if (!edge.label) continue;
      const startShifted = seg >= 0 ? shifted[seg] : undefined;
      const endShifted = seg >= 0 ? shifted[seg + 1] : undefined;
      const follow = startShifted !== undefined && startShifted === endShifted ? startShifted : bends && near(edge.label, axis) >= line && (seg >= 0 || centreInBand(edge.label, band, axis));
      if (follow) shiftBox(edge.label, axis, delta);
    }
    return res;
  }

  private outgrown(pass: Pass, decision: ReadonlyMap<string, Decision>): string[] {
    const scope = pass.scope!;
    const out = new Set<string>();
    for (const shape of pass.plane.shapes.values()) {
      const verdict = decision.get(shape.id);
      if (verdict !== 'move' && verdict !== 'resize') continue;
      const reach = far(pass.before.get(shape.id)!, pass.axis) + pass.delta + (shape.kind === 'boundary' || shape.kind === 'lane' ? 0 : FRAME_PAD);
      for (const ancestor of this.frameChain(shape)) {
        if (!scope.ancestors.has(ancestor.id) || scope.grow.has(ancestor.id) || out.has(ancestor.id)) {
          continue;
        }
        if (reach > far(pass.before.get(ancestor.id)!, pass.axis) + 0.5) {
          out.add(ancestor.id);
        }
      }
    }
    return [...out];
  }

  private growthRegion(pass: Pass, box: Box): Box {
    const from = far(box, pass.axis);
    const len = pass.delta + FRAME_GAP;
    return pass.axis === 'x' ? { x: from, y: box.y, width: len, height: box.height } : { x: box.x, y: from, width: box.width, height: len };
  }

  private swallowers(pass: Pass, decision: ReadonlyMap<string, Decision>): DShape[] {
    const scope = pass.scope!;
    const out: DShape[] = [];
    for (const resized of pass.plane.shapes.values()) {
      if (decision.get(resized.id) !== 'resize' || (resized !== scope.frame && !scope.grow.has(resized.id))) {
        continue;
      }
      const rb = pass.before.get(resized.id)!;
      const region = this.growthRegion(pass, rb);
      const around = new Set(this.frameChain(resized).map((frame) => frame.id));
      const hit = [...pass.plane.shapes.values()].some((shape) => {
        if (shape === resized || shape.kind === 'group' || pass.keep.has(shape.id) || decision.get(shape.id) !== 'stay' || around.has(shape.id) || shape.hostId === resized.id) {
          return false;
        }
        if (this.frameChain(shape).includes(resized)) return false;
        const sb = pass.before.get(shape.id)!;
        return overlaps(sb, region) && !overlaps(sb, rb);
      });
      if (hit) out.push(resized);
    }
    return out;
  }

  /** The parent sub-process, else the pool, never a lane; undefined above the pool. */
  private frameUp(shape: DShape): DShape | undefined {
    if (shape.kind === 'participant') return undefined;
    const parent = shape.kind === 'subProcess' && shape.parentId ? this.plane.shapes.get(shape.parentId) : undefined;
    if (parent) return parent;
    return shape.poolId ? this.plane.shapes.get(shape.poolId) : undefined;
  }

  private widen(scope: FrameScope, grown: DShape[]): FrameScope | undefined {
    const targets = grown.map((shape) => this.frameUp(shape));
    if (targets.some((target) => !target)) return undefined;
    const next = (targets as DShape[]).sort((first, second) => this.frameChain(first).length - this.frameChain(second).length)[0]!;
    return this.scopeFor(next, scope.grow);
  }

  private scopeFor(frame: DShape, grow: Set<string> = new Set()): FrameScope {
    const ancestors = new Set(this.frameChain(frame).map((frameShape) => frameShape.id));
    return { frame, ancestors, grow: new Set([...grow].filter((id) => ancestors.has(id))) };
  }

  private spaceInFrame(base: Omit<Pass, 'band' | 'scope'>, frame: DShape): SpaceResult {
    let scope: FrameScope | undefined = this.scopeFor(frame);
    for (let guard = 0; scope && guard < 40; guard++) {
      const pass: Pass = { ...base, band: bandOf(base.before.get(scope.frame.id)!, base.axis), scope };
      const decision = this.decideAll(pass);
      const grow = this.outgrown(pass, decision);
      if (grow.length) {
        grow.forEach((id) => scope!.grow.add(id));
        continue;
      }
      const over = this.swallowers(pass, decision);
      if (!over.length) return this.applyPass(pass, decision);
      if (LayoutDebug.on()) {
        LayoutDebug.log(`[space] ${over.map((shape) => shape.id).join(',')} would grow over a shape: room one level out`);
      }
      scope = this.widen(scope, over);
    }
    const pass: Pass = { ...base, band: undefined };
    return this.applyPass(pass, this.decideAll(pass));
  }

  /**
   * Shapes from `line` on move by `delta`, crossed containers grow (or shrink for a negative
   * delta, never past their members). Returns the moved and the resized shape ids.
   */
  makeSpace(req: SpaceRequest): SpaceResult {
    const { axis, line, delta } = req;
    if (!delta) return { moved: new Set(), resized: new Set() };
    const before = new Map<string, Box>();
    for (const shape of this.plane.shapes.values()) {
      before.set(shape.id, { ...shape.bounds });
    }
    const keep = req.keep ?? new Set<string>();
    const held = req.anchors && delta > 0 ? this.holders(req.anchors) : undefined;
    const base = { plane: this.plane, axis, line, delta, keep, before, held, push: req.push };
    const frame = req.frame ? this.plane.shapes.get(req.frame) : undefined;
    const fb = frame && before.get(frame.id)!;
    if (frame && fb && frame.container && delta > 0 && near(fb, axis) < line && far(fb, axis) > line) {
      return this.spaceInFrame(base, frame);
    }
    const within = req.within ?? (frame ? frame.bounds : undefined);
    const pass: Pass = { ...base, band: bandOf(within, axis) };
    return this.applyPass(pass, this.decideAll(pass));
  }

  unitBox(shape: DShape): Box {
    let unit = { ...shape.bounds };
    for (const be of PlaneQuery.boundariesOf(this.plane, shape.id)) {
      const left = Math.min(unit.x, be.bounds.x);
      const top = Math.min(unit.y, be.bounds.y);
      unit = { x: left, y: top, width: Math.max(right(unit), right(be.bounds)) - left, height: Math.max(bottom(unit), bottom(be.bounds)) - top };
    }
    return unit;
  }

  /** A sub-process grows in frame mode, so it never grows over foreign shapes. */
  private growthScope(frame: DShape, axis: Axis): { within?: Box; frame?: string } {
    if (frame.kind === 'subProcess' && frame.container) return { frame: frame.id };
    if (axis === 'y') return {};
    if (frame.kind === 'participant') return this.withinOf(frame.bounds);
    return this.withinOf(frame.poolId ? this.plane.shapes.get(frame.poolId)?.bounds : undefined);
  }

  /** Keeps a shape 10 px clear of the frame's own boundary events on that border (audit #63). */
  borderPad(frame: DShape, box: Box, axis: Axis): number {
    let out = 0;
    for (const boundary of PlaneQuery.boundariesOf(this.plane, frame.id)) {
      const eventBox = boundary.bounds;
      const onBorder = axis === 'y' ? Math.abs(cy(eventBox) - bottom(frame.bounds)) <= 6 : Math.abs(cx(eventBox) - right(frame.bounds)) <= 6;
      const facing = axis === 'y' ? eventBox.x < right(box) + 10 && right(eventBox) > box.x - 10 : eventBox.y < bottom(box) + 10 && bottom(eventBox) > box.y - 10;
      if (onBorder && facing) {
        out = Math.max(out, (axis === 'y' ? eventBox.height : eventBox.width) / 2 + 10);
      }
    }
    return out;
  }

  private labelOrDefault(shape: DShape): Box | undefined {
    const name = raw<string>(shape.el, 'name')?.trim();
    if (!name || shape.kind === 'boundary' || !hasExternalLabel(shape)) {
      return undefined;
    }
    if (shape.label) return shape.label;
    const { width, height } = labelSize(name);
    return labelAt(shape, { width, height }, defaultLabelSide(shape.kind));
  }

  /**
   * Grows the frames around a shape, innermost first, until it and its label fit with `pad`.
   * Lanes sit flush in their pool or parent lane.
   */
  fitInFrame(id: string, pad = 15, frameFn: (shape: DShape) => DShape | undefined = (shape) => Frames.of(this.plane, shape), keepAlso: Iterable<string> = []): SpaceResult {
    const out: SpaceResult = { moved: new Set(), resized: new Set() };
    const merge = (result: SpaceResult): void => {
      result.moved.forEach((shapeId) => out.moved.add(shapeId));
      result.resized.forEach((shapeId) => out.resized.add(shapeId));
    };
    let inner = this.plane.shapes.get(id);
    const content = inner?.kind === 'subProcess' && inner.container ? PlaneQuery.contentOf(this.plane, id).shapes.map((child) => child.id) : [];
    const keep = new Set([id, ...PlaneQuery.boundariesOf(this.plane, id).map((box) => box.id), ...content, ...keepAlso]);
    for (let guard = 0; inner && guard < 8; guard++) {
      let frame = frameFn(inner);
      /**
       * skip an ancestor not holding the inner frame's centre (an event sub-process drawn in
       * another lane): growing it would move the inner frame away from the shape
       */
      while (frame && guard > 0 && !containsPoint(frame.bounds, { x: cx(inner.bounds), y: cy(inner.bounds) })) {
        frame = frameFn(frame);
      }
      if (!frame) break;
      const box = inner.kind === 'participant' || inner.kind === 'lane' ? inner.bounds : this.unitBox(inner);
      const framePad = inner.kind === 'lane' ? 0 : pad;
      const label = guard === 0 ? this.labelOrDefault(inner) : undefined;
      const reach = (axis: Axis): number => {
        const far = (box: Box): number => (axis === 'x' ? right(box) : bottom(box));
        return Math.max(far(box) + Math.max(framePad, this.borderPad(frame, box, axis)), label ? far(label) + Math.max(LABEL_PAD, this.borderPad(frame, label, axis)) : -Infinity);
      };
      const overRight = reach('x') - right(frame.bounds);
      if (overRight > 0.5) {
        merge(this.makeSpace({ axis: 'x', line: right(frame.bounds) - 1, delta: Math.ceil(overRight), keep, anchors: [id], ...this.growthScope(frame, 'x') }));
      }
      const overBottom = reach('y') - bottom(frame.bounds);
      if (overBottom > 0.5) {
        merge(this.makeSpace({ axis: 'y', line: bottom(frame.bounds) - 1, delta: Math.ceil(overBottom), keep, anchors: [id], ...this.growthScope(frame, 'y') }));
      }
      inner = frame;
    }
    return out;
  }

  /** Moves the content of `sub` down when `label` starts above the label area below its title. */
  roomBelowTitle(sub: DShape, label: Box, anchor: string): { delta: number; res: SpaceResult } | undefined {
    const delta = Math.ceil(Frames.labelArea(sub).y - label.y);
    if (delta <= 0) return undefined;
    return { delta, res: this.makeSpace({ axis: 'y', line: sub.bounds.y + 1, delta, anchors: [anchor], frame: sub.id, within: { ...sub.bounds } }) };
  }

  private withinOf(box: Box | undefined): { within?: Box } {
    return box ? { within: { ...box } } : {};
  }

  /**
   * Moves everything beyond `to` back, leaving one `gap`. Undefined when something that stays
   * reaches into the landing area or a moved shape would land on another one.
   * Content starting a few px before `to` (a slightly smaller gap in the drawing) moves too; a
   * landing undoes the close (audit #42).
   */
  closeStrip(req: StripRequest): SpaceResult | undefined {
    const { axis, from, to, gap } = req;
    const width = to - from;
    if (width - gap <= 0) return undefined;
    const band = bandOf(req.within, axis);
    const tol = 3;
    const line = to - tol;
    const lo = from + gap + tol;
    const hi = line;
    const blocks = (box: Box): boolean => near(box, axis) < hi && far(box, axis) > lo && overlapsBand(box, band, axis);
    for (const shape of this.plane.shapes.values()) {
      const owner = shape.hostId ? this.plane.shapes.get(shape.hostId) ?? shape : shape;
      const stays = near(owner.bounds, axis) < line;
      if (PlaneQuery.isLeaf(shape) && stays && blocks(shape.bounds)) return undefined;
      if (shape.label && stays && blocks(shape.label)) return undefined;
      if (shape.container && overlapsBand(shape.bounds, band, axis)) {
        const nearEdge = near(shape.bounds, axis);
        const farEdge = far(shape.bounds, axis);
        if ((nearEdge > lo && nearEdge < hi) || (farEdge > lo && farEdge < hi)) {
          return undefined;
        }
      }
    }
    for (const edge of this.plane.edges.values()) {
      if (req.ignore?.has(edge.id)) continue;
      if (edge.label && blocks(edge.label)) return undefined;
      for (let index = 1; index + 1 < edge.points.length; index++) {
        const point = edge.points[index]!;
        const coordinate = axis === 'x' ? point.x : point.y;
        if (coordinate > lo && coordinate < hi && pointInBand(point, band, axis)) {
          return undefined;
        }
      }
    }
    const shapesBefore = new Map([...this.plane.shapes.values()].map((shape) => [shape, { bounds: { ...shape.bounds }, label: shape.label ? { ...shape.label } : undefined }] as const));
    const edgesBefore = new Map([...this.plane.edges.values()].map((edge) => [edge, { points: edge.points.map((point) => ({ ...point })), label: edge.label ? { ...edge.label } : undefined }] as const));
    const res = this.makeSpace({ axis, line, delta: -(width - gap), ...(req.within ? { within: req.within } : {}), ...(req.keep ? { keep: req.keep } : {}) });
    const leaves = [...this.plane.shapes.values()].filter(PlaneQuery.isLeaf);
    for (const id of res.moved) {
      const shape = this.plane.shapes.get(id);
      if (!shape || !PlaneQuery.isLeaf(shape)) continue;
      const hit = leaves.find((other) => other !== shape && other.hostId !== shape.id && shape.hostId !== other.id && overlaps(other.bounds, shape.bounds) && !overlaps(shapesBefore.get(other)!.bounds, shapesBefore.get(shape)!.bounds));
      if (!hit) continue;
      if (LayoutDebug.on()) {
        LayoutDebug.log(`[strip] closing would put ${shape.id} onto ${hit.id}: kept open`);
      }
      for (const [sh, snapshot] of shapesBefore) {
        sh.bounds = snapshot.bounds;
        if (snapshot.label) {
          sh.label = snapshot.label;
        } else {
          delete sh.label;
        }
      }
      for (const [edge, snapshot] of edgesBefore) {
        edge.points = snapshot.points;
        if (snapshot.label) {
          edge.label = snapshot.label;
        } else {
          delete edge.label;
        }
      }
      return undefined;
    }
    return res;
  }
}
