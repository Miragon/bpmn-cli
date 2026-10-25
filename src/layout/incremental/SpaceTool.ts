import { LayoutDebug } from '../LayoutDebug.js';
import { bottom, type Box, containsPoint, cx, cy, overlaps, right } from '../../drawing/utils/geom.js';
import { Frames } from '../../drawing/Frames.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';
import { defaultLabelSide, hasExternalLabel, labelAt } from '../../drawing/utils/labels.js';
import { raw } from '../../drawing/utils/raw.js';
import { labelSize } from '../../drawing/utils/text.js';
import type { DShape, Plane } from '../../drawing/types.js';
import { bandOf, beyondBand, centreInBand, far, near, overlapsBand, pointInBand, resize, shiftBox, type Axis } from './utils/bands.js';

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
    const s = this.plane.shapes.get(id);
    if (!s || (!dx && !dy)) return [];
    const moved = [id];
    const move = (t: DShape): void => {
      t.bounds.x += dx;
      t.bounds.y += dy;
      if (t.label) {
        t.label.x += dx;
        t.label.y += dy;
      }
    };
    move(s);
    for (const b of PlaneQuery.boundariesOf(this.plane, id)) {
      move(b);
      moved.push(b.id);
    }
    if (s.container && s.kind === 'subProcess') {
      const { shapes, edges } = PlaneQuery.contentOf(this.plane, id);
      for (const c of shapes) {
        move(c);
        moved.push(c.id);
      }
      const inside = new Set(shapes.map((c) => c.id));
      for (const e of edges) {
        if (!(e.sourceId && inside.has(e.sourceId)) || !(e.targetId && inside.has(e.targetId))) continue;
        for (const p of e.points) {
          p.x += dx;
          p.y += dy;
        }
        if (e.label) {
          e.label.x += dx;
          e.label.y += dy;
        }
      }
    }
    return moved;
  }

  private alignPoolsAndLanes(before: Map<string, Box>, res: SpaceResult): void {
    const pools = [...this.plane.shapes.values()].filter((s) => s.kind === 'participant');
    const grown = pools.filter((p) => res.resized.has(p.id));
    if (!grown.length) return;
    for (const g of grown) {
      const old = before.get(g.id)!;
      for (const p of pools) {
        if (p === g || res.resized.has(p.id) || res.moved.has(p.id)) continue;
        if (Math.abs(right(before.get(p.id)!) - right(old)) > 2) continue;
        // never past its own content or the message flows docking on it
        const target = right(g.bounds);
        if (target < right(p.bounds)) {
          const content = [...this.plane.shapes.values()].filter((s) => s.poolId === p.id && s.kind !== 'lane').map((s) => right(s.bounds) + 15);
          const docks = [...this.plane.edges.values()].flatMap((e) => [e.sourceId === p.id ? e.points[0] : undefined, e.targetId === p.id ? e.points[e.points.length - 1] : undefined]).filter((q): q is { x: number; y: number } => !!q).map((q) => q.x + 15);
          if (Math.max(-Infinity, ...content, ...docks) > target) continue;
        }
        p.bounds.width = target - p.bounds.x;
        res.resized.add(p.id);
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
  private geometricPool(s: DShape, before: ReadonlyMap<string, Box>): string | undefined {
    if (s.poolId || s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group' || s.hostId || s.parentId) return s.poolId;
    const c = { x: cx(s.bounds), y: cy(s.bounds) };
    for (const p of this.plane.shapes.values()) {
      if (p.kind !== 'participant') continue;
      const b = before.get(p.id) ?? p.bounds;
      if (c.x >= b.x && c.x <= right(b) && c.y >= b.y && c.y <= bottom(b)) return p.id;
    }
    return undefined;
  }

  /** For shapes no lane lists (data objects, annotations): the innermost lane at their centre. */
  private geometricLane(s: DShape, before: ReadonlyMap<string, Box>): string | undefined {
    if (s.laneId || s.hostId || s.parentId || s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group') return s.laneId;
    const c = { x: cx(s.bounds), y: cy(s.bounds) };
    let best: Box | undefined;
    let id: string | undefined;
    for (const l of this.plane.shapes.values()) {
      if (l.kind !== 'lane' || (s.poolId && l.poolId !== s.poolId)) continue;
      const b = before.get(l.id) ?? l.bounds;
      if (c.x < b.x || c.x > right(b) || c.y < b.y || c.y > bottom(b)) continue;
      if (!best || b.width * b.height < best.width * best.height) {
        best = b;
        id = l.id;
      }
    }
    return id;
  }

  /** A shrunk container keeps `pad` beyond its members and never ends further out than before. */
  private capShrink(c: DShape, axis: Axis, before: Box, pad = 10): void {
    let need = -Infinity;
    for (const s of this.plane.shapes.values()) {
      if (s === c || s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group') continue;
      if (!Frames.within(this.plane, s, c)) continue;
      need = Math.max(need, far(s.bounds, axis) + (s.kind === 'boundary' ? 0 : pad));
    }
    const limit = Math.min(need, far(before, axis));
    if (far(c.bounds, axis) >= limit) return;
    if (axis === 'x') c.bounds.width = limit - c.bounds.x;
    else c.bounds.height = limit - c.bounds.y;
  }

  private holders(anchors: ReadonlyArray<string | undefined>): Set<string> {
    const out = new Set<string>();
    for (const id of anchors) {
      let cur = id ? this.plane.shapes.get(id) : undefined;
      if (cur?.hostId) cur = this.plane.shapes.get(cur.hostId) ?? cur;
      for (let i = 0; cur && i < 20; i++) {
        out.add(cur.id);
        cur = cur.parentId ? this.plane.shapes.get(cur.parentId) : undefined;
      }
    }
    return out;
  }

  private nearestSegment(pts: ReadonlyArray<{ x: number; y: number }>, b: Box): number {
    const c = { x: cx(b), y: cy(b) };
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / len)) : 0;
      const d = Math.hypot(c.x - (p.x + t * dx), c.y - (p.y + t * dy));
      if (d < dist - 1e-9) {
        dist = d;
        best = i;
      }
    }
    return best;
  }

  private frameChain(s: DShape): DShape[] {
    const out: DShape[] = [];
    let cur = s.hostId ? this.plane.shapes.get(s.hostId) ?? s : s;
    if (cur !== s) out.push(cur);
    for (let i = 0; i < 16; i++) {
      const f = Frames.of(this.plane, cur);
      if (!f || out.includes(f)) break;
      out.push(f);
      cur = f;
    }
    return out;
  }

  private rigid(p: Pass, c: DShape): boolean {
    if (!p.held || c.kind !== 'subProcess' || !c.container || p.held.has(c.id) || p.keep.has(c.id)) return false;
    const b = p.before.get(c.id)!;
    return near(b, p.axis) < p.line && far(b, p.axis) > p.line && overlapsBand(b, p.band, p.axis);
  }

  private rigidAround(p: Pass, s: DShape): DShape | undefined {
    let out: DShape | undefined;
    let cur = s.parentId ? p.plane.shapes.get(s.parentId) : undefined;
    for (let i = 0; cur && i < 20; i++) {
      if (this.rigid(p, cur)) out = cur;
      cur = cur.parentId ? p.plane.shapes.get(cur.parentId) : undefined;
    }
    return out;
  }

  private insideFrame(p: Pass, s: DShape): boolean {
    const scope = p.scope!;
    if (this.frameChain(s).includes(scope.frame)) return true;
    if (s.container || s.kind === 'group' || scope.ancestors.has(s.id)) return false;
    const b = p.before.get(s.id)!;
    const f = p.before.get(scope.frame.id)!;
    const c = { x: cx(b), y: cy(b) };
    return c.x > f.x && c.x < right(f) && c.y > f.y && c.y < bottom(f);
  }

  /** Undefined for the frame and its content, which follow the usual rules. */
  private scopeDecision(p: Pass, s: DShape): Decision | undefined {
    const scope = p.scope;
    if (!scope || s === scope.frame || this.insideFrame(p, s)) return undefined;
    if (!scope.ancestors.has(s.id) || !scope.grow.has(s.id)) return 'stay';
    const b = p.before.get(s.id)!;
    return near(b, p.axis) < p.line && far(b, p.axis) > p.line ? 'resize' : 'stay';
  }

  /** Top-down: the content of a container beyond the line goes with its container. */
  private decideAll(p: Pass): Map<string, Decision> {
    const { plane, axis, line, delta, band, keep, before } = p;
    const decision = new Map<string, Decision>();
    const decide = (s: DShape, depth = 0): Decision => {
      const known = decision.get(s.id);
      if (known) return known;
      let d: Decision = 'stay';
      const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
      /**
       * collaboration-level artifacts go with the pool they are drawn in,
       * shapes no lane lists with the lane they are drawn in
       */
      const carrier = [s.kind === 'participant' ? undefined : this.geometricPool(s, before), this.geometricLane(s, before), s.parentId]
        .map((id) => (id ? plane.shapes.get(id) : undefined))
        .find((c) => !!c && near(before.get(c.id)!, axis) >= line);
      const hostDecision = host && depth < 20 ? decide(host, depth + 1) : undefined;
      const scoped = host ? undefined : this.scopeDecision(p, s);
      const block = p.held && !host && !carrier ? this.rigidAround(p, s) : undefined;
      if (keep.has(s.id)) d = 'stay';
      else if (host && hostDecision && (!host.container || hostDecision !== 'resize')) {
        d = hostDecision === 'move' ? 'move' : 'stay';
      } else if (host && hostDecision === 'resize') {
        // on a resized host they stay on its border, which moves only beyond the line
        const eb = before.get(s.id)!;
        d = (axis === 'x' ? cx(eb) : cy(eb)) >= line ? 'move' : 'stay';
      } else if (scoped) {
        d = scoped;
      } else if (carrier && depth < 20) {
        d = decide(carrier, depth + 1) === 'move' ? 'move' : 'stay';
      } else if (block && depth < 20) {
        d = decide(block, depth + 1) === 'move' ? 'move' : 'stay';
      } else if (this.rigid(p, s)) {
        const b = before.get(s.id)!;
        d = (axis === 'x' ? cx(b) : cy(b)) >= line ? 'move' : 'stay';
      } else {
        const ref = before.get(s.id)!;
        if (near(ref, axis) >= line) d = overlapsBand(ref, band, axis) ? 'move' : 'stay';
        else if ((s.container || s.kind === 'group') && far(ref, axis) > line && overlapsBand(ref, band, axis)) {
          // a pool or lane reaching beyond the band holds content that stays, so it never shrinks
          d = delta < 0 && beyondBand(ref, band, axis) ? 'stay' : 'resize';
        }
      }
      decision.set(s.id, d);
      return d;
    };
    for (const s of plane.shapes.values()) decide(s);
    return decision;
  }

  private applyPass(p: Pass, decision: ReadonlyMap<string, Decision>): SpaceResult {
    const { plane, axis, line, delta, band, keep, before } = p;
    const res: SpaceResult = { moved: new Set(), resized: new Set() };
    for (const s of plane.shapes.values()) {
      const d = decision.get(s.id);
      if (d === 'move') {
        shiftBox(s.bounds, axis, delta);
        if (s.label) shiftBox(s.label, axis, delta);
        res.moved.add(s.id);
      } else if (d === 'resize') {
        resize(s.bounds, axis, delta);
        res.resized.add(s.id);
      }
    }
    if (delta < 0) for (const id of res.resized) {
      const c = plane.shapes.get(id)!;
      if (c.container) this.capShrink(c, axis, before.get(id)!);
    }
    if (axis === 'x') this.alignPoolsAndLanes(before, res);

    // connections inside a rigid sub-process move or stay with it as a whole
    const blockOf = new Map<string, string>();
    if (p.held) {
      for (const s of plane.shapes.values()) {
        if (!this.rigid(p, s) || this.rigidAround(p, s)) continue;
        blockOf.set(s.id, s.id);
        for (const b of PlaneQuery.boundariesOf(plane, s.id)) blockOf.set(b.id, s.id);
        for (const c of PlaneQuery.contentOf(plane, s.id).shapes) blockOf.set(c.id, s.id);
      }
    }
    const changed = (id: string | undefined): boolean => !!id && (res.moved.has(id) || res.resized.has(id));
    const outside = (id: string | undefined): boolean => {
      const s = id ? plane.shapes.get(id) : undefined;
      return !s || (s !== p.scope!.frame && !this.insideFrame(p, s));
    };

    for (const e of plane.edges.values()) {
      if (e.sourceId && e.targetId && keep.has(e.sourceId) && keep.has(e.targetId)) continue;
      if (p.scope && !changed(e.sourceId) && !changed(e.targetId) && outside(e.sourceId) && outside(e.targetId)) continue;
      const n = e.points.length;
      const block = e.sourceId && e.targetId ? blockOf.get(e.sourceId) : undefined;
      const inBlock = !!block && blockOf.get(e.targetId!) === block;
      const seg = e.label && n >= 2 ? this.nearestSegment(e.points, e.label) : -1;
      const shifted: boolean[] = [];
      e.points.forEach((pt, i) => {
        const endId = i === 0 ? e.sourceId : i === n - 1 ? e.targetId : undefined;
        const end = endId ? plane.shapes.get(endId) : undefined;
        const beyond = (axis === 'x' ? pt.x : pt.y) >= line;
        let shift: boolean;
        if (inBlock) shift = res.moved.has(block);
        else if (end && res.moved.has(end.id)) shift = true;
        else if (end && res.resized.has(end.id)) shift = beyond;
        else if (end) shift = false;
        else shift = beyond && pointInBand(pt, band, axis);
        shifted.push(shift);
        if (shift) {
          if (axis === 'x') pt.x += delta;
          else pt.y += delta;
        }
      });
      if (!e.label) continue;
      // the label goes with the segment nearest to it
      const a = seg >= 0 ? shifted[seg] : undefined;
      const b = seg >= 0 ? shifted[seg + 1] : undefined;
      const follow = a !== undefined && a === b ? a : near(e.label, axis) >= line && (seg >= 0 || centreInBand(e.label, band, axis));
      if (follow) shiftBox(e.label, axis, delta);
    }
    return res;
  }

  private outgrown(p: Pass, decision: ReadonlyMap<string, Decision>): string[] {
    const scope = p.scope!;
    const out = new Set<string>();
    for (const s of p.plane.shapes.values()) {
      const d = decision.get(s.id);
      if (d !== 'move' && d !== 'resize') continue;
      const reach = far(p.before.get(s.id)!, p.axis) + p.delta + (s.kind === 'boundary' || s.kind === 'lane' ? 0 : FRAME_PAD);
      for (const a of this.frameChain(s)) {
        if (!scope.ancestors.has(a.id) || scope.grow.has(a.id) || out.has(a.id)) continue;
        if (reach > far(p.before.get(a.id)!, p.axis) + 0.5) out.add(a.id);
      }
    }
    return [...out];
  }

  private growthRegion(p: Pass, b: Box): Box {
    const from = far(b, p.axis);
    const len = p.delta + FRAME_GAP;
    return p.axis === 'x' ? { x: from, y: b.y, width: len, height: b.height } : { x: b.x, y: from, width: b.width, height: len };
  }

  private swallowers(p: Pass, decision: ReadonlyMap<string, Decision>): DShape[] {
    const scope = p.scope!;
    const out: DShape[] = [];
    for (const r of p.plane.shapes.values()) {
      if (decision.get(r.id) !== 'resize' || (r !== scope.frame && !scope.grow.has(r.id))) continue;
      const rb = p.before.get(r.id)!;
      const region = this.growthRegion(p, rb);
      const around = new Set(this.frameChain(r).map((f) => f.id));
      const hit = [...p.plane.shapes.values()].some((s) => {
        if (s === r || s.kind === 'group' || p.keep.has(s.id) || decision.get(s.id) !== 'stay' || around.has(s.id) || s.hostId === r.id) return false;
        if (this.frameChain(s).includes(r)) return false;
        const sb = p.before.get(s.id)!;
        return overlaps(sb, region) && !overlaps(sb, rb);
      });
      if (hit) out.push(r);
    }
    return out;
  }

  /** The parent sub-process, else the pool, never a lane; undefined above the pool. */
  private frameUp(r: DShape): DShape | undefined {
    if (r.kind === 'participant') return undefined;
    const parent = r.kind === 'subProcess' && r.parentId ? this.plane.shapes.get(r.parentId) : undefined;
    if (parent) return parent;
    return r.poolId ? this.plane.shapes.get(r.poolId) : undefined;
  }

  private widen(scope: FrameScope, grown: DShape[]): FrameScope | undefined {
    const targets = grown.map((r) => this.frameUp(r));
    if (targets.some((t) => !t)) return undefined;
    const next = (targets as DShape[]).sort((a, b) => this.frameChain(a).length - this.frameChain(b).length)[0]!;
    return this.scopeFor(next, scope.grow);
  }

  private scopeFor(frame: DShape, grow: Set<string> = new Set()): FrameScope {
    const ancestors = new Set(this.frameChain(frame).map((f) => f.id));
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
      if (LayoutDebug.on()) LayoutDebug.log(`[space] ${over.map((r) => r.id).join(',')} would grow over a shape: room one level out`);
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
    for (const s of this.plane.shapes.values()) before.set(s.id, { ...s.bounds });
    const keep = req.keep ?? new Set<string>();
    const held = req.anchors && delta > 0 ? this.holders(req.anchors) : undefined;
    const base = { plane: this.plane, axis, line, delta, keep, before, held };
    const frame = req.frame ? this.plane.shapes.get(req.frame) : undefined;
    const fb = frame && before.get(frame.id)!;
    if (frame && fb && frame.container && delta > 0 && near(fb, axis) < line && far(fb, axis) > line) return this.spaceInFrame(base, frame);
    const within = req.within ?? (frame ? frame.bounds : undefined);
    const pass: Pass = { ...base, band: bandOf(within, axis) };
    return this.applyPass(pass, this.decideAll(pass));
  }

  unitBox(s: DShape): Box {
    let b = { ...s.bounds };
    for (const be of PlaneQuery.boundariesOf(this.plane, s.id)) {
      const x = Math.min(b.x, be.bounds.x);
      const y = Math.min(b.y, be.bounds.y);
      b = { x, y, width: Math.max(right(b), right(be.bounds)) - x, height: Math.max(bottom(b), bottom(be.bounds)) - y };
    }
    return b;
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
    for (const b of PlaneQuery.boundariesOf(this.plane, frame.id)) {
      const e = b.bounds;
      const onBorder = axis === 'y' ? Math.abs(cy(e) - bottom(frame.bounds)) <= 6 : Math.abs(cx(e) - right(frame.bounds)) <= 6;
      const facing = axis === 'y' ? e.x < right(box) + 10 && right(e) > box.x - 10 : e.y < bottom(box) + 10 && bottom(e) > box.y - 10;
      if (onBorder && facing) out = Math.max(out, (axis === 'y' ? e.height : e.width) / 2 + 10);
    }
    return out;
  }

  private labelOrDefault(s: DShape): Box | undefined {
    const name = raw<string>(s.el, 'name')?.trim();
    if (!name || s.kind === 'boundary' || !hasExternalLabel(s)) return undefined;
    if (s.label) return s.label;
    const { width, height } = labelSize(name);
    return labelAt(s, { width, height }, defaultLabelSide(s.kind));
  }

  /** Grows the frames around a shape, innermost first, until it and its label fit with `pad`. */
  fitInFrame(id: string, pad = 15, frameFn: (s: DShape) => DShape | undefined = (s) => Frames.of(this.plane, s), keepAlso: Iterable<string> = []): SpaceResult {
    const out: SpaceResult = { moved: new Set(), resized: new Set() };
    const merge = (r: SpaceResult): void => {
      r.moved.forEach((x) => out.moved.add(x));
      r.resized.forEach((x) => out.resized.add(x));
    };
    let inner = this.plane.shapes.get(id);
    const content = inner?.kind === 'subProcess' && inner.container ? PlaneQuery.contentOf(this.plane, id).shapes.map((c) => c.id) : [];
    const keep = new Set([id, ...PlaneQuery.boundariesOf(this.plane, id).map((b) => b.id), ...content, ...keepAlso]);
    for (let guard = 0; inner && guard < 8; guard++) {
      let frame = frameFn(inner);
      /**
       * skip an ancestor not holding the inner frame's centre (an event sub-process drawn in
       * another lane): growing it would move the inner frame away from the shape
       */
      while (frame && guard > 0 && !containsPoint(frame.bounds, { x: cx(inner.bounds), y: cy(inner.bounds) })) frame = frameFn(frame);
      if (!frame) break;
      const box = inner.kind === 'participant' || inner.kind === 'lane' ? inner.bounds : this.unitBox(inner);
      // lanes sit flush in their pool or parent lane
      const p = inner.kind === 'lane' ? 0 : pad;
      const label = guard === 0 ? this.labelOrDefault(inner) : undefined;
      const reach = (axis: Axis): number => {
        const far = (b: Box): number => (axis === 'x' ? right(b) : bottom(b));
        return Math.max(far(box) + Math.max(p, this.borderPad(frame, box, axis)), label ? far(label) + Math.max(LABEL_PAD, this.borderPad(frame, label, axis)) : -Infinity);
      };
      const overRight = reach('x') - right(frame.bounds);
      if (overRight > 0.5) merge(this.makeSpace({ axis: 'x', line: right(frame.bounds) - 1, delta: Math.ceil(overRight), keep, anchors: [id], ...this.growthScope(frame, 'x') }));
      const overBottom = reach('y') - bottom(frame.bounds);
      if (overBottom > 0.5) merge(this.makeSpace({ axis: 'y', line: bottom(frame.bounds) - 1, delta: Math.ceil(overBottom), keep, anchors: [id], ...this.growthScope(frame, 'y') }));
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

  private withinOf(b: Box | undefined): { within?: Box } {
    return b ? { within: { ...b } } : {};
  }

  /**
   * Moves everything beyond `to` back, leaving one `gap`. Undefined when something that stays
   * reaches into the landing area or a moved shape would land on another one.
   */
  closeStrip(req: StripRequest): SpaceResult | undefined {
    const { axis, from, to, gap } = req;
    const width = to - from;
    if (width - gap <= 0) return undefined;
    const band = bandOf(req.within, axis);
    // content starting a few px before `to` (a slightly smaller gap in the drawing) moves too
    const tol = 3;
    const line = to - tol;
    const lo = from + gap + tol;
    const hi = line;
    const blocks = (b: Box): boolean => near(b, axis) < hi && far(b, axis) > lo && overlapsBand(b, band, axis);
    for (const s of this.plane.shapes.values()) {
      const owner = s.hostId ? this.plane.shapes.get(s.hostId) ?? s : s;
      const stays = near(owner.bounds, axis) < line;
      if (PlaneQuery.isLeaf(s) && stays && blocks(s.bounds)) return undefined;
      if (s.label && stays && blocks(s.label)) return undefined;
      if (s.container && overlapsBand(s.bounds, band, axis)) {
        const a = near(s.bounds, axis);
        const b = far(s.bounds, axis);
        if ((a > lo && a < hi) || (b > lo && b < hi)) return undefined;
      }
    }
    for (const e of this.plane.edges.values()) {
      if (req.ignore?.has(e.id)) continue;
      if (e.label && blocks(e.label)) return undefined;
      for (let i = 1; i + 1 < e.points.length; i++) {
        const p = e.points[i]!;
        const c = axis === 'x' ? p.x : p.y;
        if (c > lo && c < hi && pointInBand(p, band, axis)) return undefined;
      }
    }
    // a moved shape landing on another one undoes the close (audit #42)
    const shapesBefore = new Map([...this.plane.shapes.values()].map((s) => [s, { bounds: { ...s.bounds }, label: s.label ? { ...s.label } : undefined }] as const));
    const edgesBefore = new Map([...this.plane.edges.values()].map((e) => [e, { points: e.points.map((p) => ({ ...p })), label: e.label ? { ...e.label } : undefined }] as const));
    const res = this.makeSpace({ axis, line, delta: -(width - gap), ...(req.within ? { within: req.within } : {}), ...(req.keep ? { keep: req.keep } : {}) });
    const leaves = [...this.plane.shapes.values()].filter(PlaneQuery.isLeaf);
    for (const id of res.moved) {
      const s = this.plane.shapes.get(id);
      if (!s || !PlaneQuery.isLeaf(s)) continue;
      const hit = leaves.find((o) => o !== s && o.hostId !== s.id && s.hostId !== o.id && overlaps(o.bounds, s.bounds) && !overlaps(shapesBefore.get(o)!.bounds, shapesBefore.get(s)!.bounds));
      if (!hit) continue;
      if (LayoutDebug.on()) LayoutDebug.log(`[strip] closing would put ${s.id} onto ${hit.id}: kept open`);
      for (const [sh, v] of shapesBefore) {
        sh.bounds = v.bounds;
        if (v.label) sh.label = v.label;
        else delete sh.label;
      }
      for (const [e, v] of edgesBefore) {
        e.points = v.points;
        if (v.label) e.label = v.label;
        else delete e.label;
      }
      return undefined;
    }
    return res;
  }
}
