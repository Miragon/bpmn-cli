import { is, type El } from '../model/utils/moddle.js';
import type { Box, Point } from './types.js';
import { cx, cy, segmentsCross } from './utils/geom.js';
import { collinear, cuts, drawnEnds, enclosingProcess, glyph, hits, inside, joinTail, lookup, overlap, ptIn, readDrawnPlane, subTitleOf, type Edge, type MetricIndex, type Seg, type Shape } from './utils/harness.js';
import { idOf, raw, rawList } from './utils/raw.js';
import type { MetricKey } from './utils/problems.js';

export type Add = (kind: MetricKey, key: string, ids: string[], detail?: string) => void;

/** The frames a shape may lie in without a frameIntrusion. */
interface Home {
  el: El;
  scopes: El[];
  host?: El;
  process: El;
}

/** the same gap as EdgeRouter's DETACHED_GAP */
const DETACHED_GAP = 10;

/** One plane's layout problems, defined as in the regression harness for its kinds. */
export class PlaneAnalysis {
  private readonly shapes: Shape[];
  private readonly edges: Edge[];
  /** a group is drawn around its members: never an overlap, a cut or a label clash */
  private readonly leaf: Shape[];
  private readonly byId: Map<string, Shape>;
  private readonly pools: Shape[];

  constructor(
    plane: unknown,
    private readonly sem: MetricIndex,
    seen: Set<string>,
    private readonly add: Add,
  ) {
    const { shapes, edges } = readDrawnPlane(plane, seen);
    this.shapes = shapes;
    this.edges = edges;
    this.leaf = shapes.filter((s) => !s.container && !is(s.el, 'bpmn:Group'));
    this.byId = new Map(shapes.map((s) => [s.id, s]));
    this.pools = shapes.filter((s) => is(s.el, 'bpmn:Participant'));
  }

  run(): void {
    this.checkOverlaps();
    this.checkEdgeSegments();
    this.checkEdgePairs();
    this.checkLabels();
    this.checkInOut();
    this.checkContainment();
    this.checkLaneGaps();
    this.checkFlows();
    this.checkIntrusions();
    this.checkFrameOverlaps();
    this.checkDegenerate();
    this.checkDetached();
    this.checkBackwardFlows();
    this.checkSegmentOverlaps();
    this.checkLabelFrames();
    this.checkLabelTitles();
    this.checkMessageLabels();
  }

  private hostOf(el: El): string | undefined {
    return idOf(raw(el, 'attachedToRef'));
  }

  private checkOverlaps(): void {
    const { leaf, add } = this;
    for (let i = 0; i < leaf.length; i++) {
      for (let j = i + 1; j < leaf.length; j++) {
        const a = leaf[i]!;
        const b = leaf[j]!;
        const attached = (is(a.el, 'bpmn:BoundaryEvent') && this.hostOf(a.el) === b.id) || (is(b.el, 'bpmn:BoundaryEvent') && this.hostOf(b.el) === a.id);
        if (!attached && overlap(a.b, b.b)) add('overlaps', `${a.id}~${b.id}`, [a.id, b.id]);
      }
    }
  }

  /** diagonal segments of flows, edge segments through shapes they do not connect */
  private checkEdgeSegments(): void {
    const { edges, leaf, add } = this;
    for (const e of edges) {
      const flow = is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow');
      for (const s of e.segs) {
        if (flow && s[0].x !== s[1].x && s[0].y !== s[1].y) add('diagonal', e.id, [e.id]);
        for (const sh of leaf) {
          if (e.ends.has(sh.id)) continue;
          if (is(sh.el, 'bpmn:BoundaryEvent') && e.ends.has(this.hostOf(sh.el))) continue;
          if (cuts(s, sh.b)) add('through', `${e.id}->${sh.id}`, [e.id, sh.id]);
        }
      }
    }
  }

  /** crossings of any two edges, collinear runs of unrelated edges */
  private checkEdgePairs(): void {
    const { edges, add } = this;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i]!;
        const b = edges[j]!;
        if (a.segs.some((sa) => b.segs.some((sb) => segmentsCross(...sa, ...sb)))) add('crossings', `${a.id}x${b.id}`, [a.id, b.id]);
        const related = [...a.ends].some((x) => b.ends.has(x));
        if (related) continue;
        let len = 0;
        for (const sa of a.segs) for (const sb of b.segs) len += Math.max(0, collinear(sa, sb));
        if (len > 20) add('parallelRun', `${a.id}=${b.id}(${len})`, [a.id, b.id], `${len}px`);
      }
    }
  }

  private checkLabels(): void {
    const { shapes, edges, leaf, add } = this;
    const labels: Array<{ owner: string; box: Box; text: Box }> = [];
    for (const o of [...shapes, ...edges]) {
      if (o.label) labels.push({ owner: o.id, box: o.label, text: glyph(o.label, raw<string>(o.el, 'name') || '') });
    }
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      for (const s of leaf) {
        if (s.id !== l.owner && overlap(l.box, s.b)) add('labelClash', `${l.owner}#L~${s.id}`, [l.owner, s.id], 'label on shape');
      }
      for (let j = i + 1; j < labels.length; j++) {
        const other = labels[j]!;
        if (overlap(l.box, other.box)) add('labelClash', `${l.owner}#L~${other.owner}#L`, [l.owner, other.owner], 'label on label');
      }
      for (const e of edges) if (e.segs.some((s) => hits(s, l.text, 0))) add('labelOnLine', `${l.owner}#L~${e.id}`, [l.owner, e.id]);
    }
  }

  /** an incoming and an outgoing sequence flow of one node sharing a line */
  private checkInOut(): void {
    const { shapes, edges, add } = this;
    const flows = edges.filter((e) => is(e.el, 'bpmn:SequenceFlow'));
    for (const s of shapes) {
      const into = flows.filter((e) => idOf(raw(e.el, 'targetRef')) === s.id);
      const outOf = flows.filter((e) => idOf(raw(e.el, 'sourceRef')) === s.id);
      for (const i of into) {
        for (const o of outOf) {
          if (i !== o && i.segs.some((a) => o.segs.some((b) => collinear(a, b) > 0))) add('inOut', `${i.id}|${o.id}@${s.id}`, [i.id, o.id, s.id]);
        }
      }
    }
  }

  private checkContainment(): void {
    const { sem, shapes, byId, add } = this;
    for (const s of shapes) {
      if (is(s.el, 'bpmn:Participant') || is(s.el, 'bpmn:Lane')) continue;
      const parent = sem.parentOf.get(s.id);
      if (parent && is(parent, 'bpmn:SubProcess')) {
        const sub = lookup(byId, idOf(parent));
        if (sub?.expanded && !inside(s.b, sub.b)) add('outsideSub', s.id, [s.id, sub.id]);
      }
      const lane = lookup(byId, idOf(sem.laneOf.get(s.id)));
      if (lane && !is(s.el, 'bpmn:BoundaryEvent') && !inside(s.b, lane.b)) add('outsideLane', s.id, [s.id, lane.id]);
      const participant = parent && is(parent, 'bpmn:Process') ? lookup(sem.poolOf, idOf(parent)) : undefined;
      const pool = lookup(byId, idOf(participant));
      if (pool && !inside(s.b, pool.b)) add('outsidePool', s.id, [s.id, pool.id]);
    }
  }

  /** top-level lanes not reaching the top / bottom border of their pool */
  private checkLaneGaps(): void {
    const { pools, byId, add } = this;
    for (const p of pools) {
      const proc = raw<El>(p.el, 'processRef');
      if (!proc) continue;
      for (const ls of rawList(proc, 'laneSets')) {
        const top = rawList(ls, 'lanes');
        const firstId = idOf(top[0]);
        const lastId = idOf(top[top.length - 1]);
        const first = lookup(byId, firstId);
        const last = lookup(byId, lastId);
        if (first && Math.abs(first.b.y - p.b.y) > 1) add('laneGap', `${first.id}:top`, [first.id, p.id], 'top');
        if (last && Math.abs(last.b.y + last.b.height - (p.b.y + p.b.height)) > 1) add('laneGap', `${last.id}:bottom`, [last.id, p.id], 'bottom');
      }
    }
  }

  private flowFrame(flowId: string): Shape | undefined {
    const { sem, byId } = this;
    const parent = sem.parentOf.get(flowId);
    if (!parent) return undefined;
    if (is(parent, 'bpmn:SubProcess')) {
      const sub = lookup(byId, idOf(parent));
      return sub?.expanded ? sub : undefined;
    }
    return lookup(byId, idOf(lookup(sem.poolOf, idOf(parent))));
  }

  private checkSequenceFlow(e: Edge): void {
    const { sem, byId, add } = this;
    const frame = this.flowFrame(e.id);
    if (frame && e.pts.some((p) => !ptIn(p, frame.b))) add('edgeOutside', e.id, [e.id, frame.id]);
    const sl = lookup(sem.laneOf, idOf(raw(e.el, 'sourceRef')));
    const tl = lookup(sem.laneOf, idOf(raw(e.el, 'targetRef')));
    const lane = sl && sl === tl ? lookup(byId, idOf(sl)) : undefined;
    if (lane && e.pts.some((p) => !ptIn(p, lane.b))) add('edgeLeavesLane', e.id, [e.id, lane.id]);
  }

  private checkMessageFlow(e: Edge): void {
    const { sem, pools, add } = this;
    const ends = new Set<string | undefined>([idOf(raw(e.el, 'sourceRef')), idOf(raw(e.el, 'targetRef'))]);
    for (const id of [...ends]) {
      const proc = enclosingProcess(lookup(sem.parentOf, id));
      const participant = lookup(sem.poolOf, idOf(proc));
      if (participant) ends.add(idOf(participant));
    }
    for (const s of e.segs) {
      for (const p of pools) if (!ends.has(p.id) && hits(s, p.b)) add('msgThroughPool', `${e.id}->${p.id}`, [e.id, p.id]);
    }
  }

  private checkFlows(): void {
    for (const e of this.edges) {
      if (is(e.el, 'bpmn:SequenceFlow')) this.checkSequenceFlow(e);
      if (is(e.el, 'bpmn:MessageFlow')) this.checkMessageFlow(e);
    }
  }

  private isSub(el: El): boolean {
    return is(el, 'bpmn:SubProcess');
  }

  private isScope(el: El): boolean {
    return this.isSub(el) || is(el, 'bpmn:Process');
  }

  private scopesOf(el: El): El[] {
    const out: El[] = [];
    let cur = el.$parent as El | undefined;
    for (let i = 0; cur && i < 50; i++) {
      if (this.isScope(cur)) out.push(cur);
      if (is(cur, 'bpmn:Process')) break;
      cur = cur.$parent as El | undefined;
    }
    return out;
  }

  private laneChain(lane: El): El[] {
    const out: El[] = [];
    let cur: El | undefined = lane;
    for (let i = 0; cur && i < 50; i++) {
      if (is(cur, 'bpmn:Lane')) out.push(cur);
      if (is(cur, 'bpmn:Process')) break;
      cur = cur.$parent as El | undefined;
    }
    return out;
  }

  private laneProcess(lane: El): El | undefined {
    let cur = lane.$parent as El | undefined;
    for (let i = 0; cur && !is(cur, 'bpmn:Process') && i < 50; i++) cur = cur.$parent as El | undefined;
    return cur;
  }

  private homeOf(s: Shape): Home | undefined {
    if (is(s.el, 'bpmn:Participant') || is(s.el, 'bpmn:Lane') || is(s.el, 'bpmn:Group')) return undefined;
    const scopes = this.scopesOf(s.el);
    const process = scopes[scopes.length - 1];
    if (!process || !is(process, 'bpmn:Process')) return undefined;
    const host = raw<El>(s.el, 'attachedToRef');
    return { el: s.el, scopes, process, ...(host ? { host } : {}) };
  }

  private laneIsHome(sem: MetricIndex, h: Home, lane: El): boolean {
    let listed = false;
    for (const x of [h.el, h.host, ...h.scopes.filter(this.isSub)]) {
      const own = lookup(sem.laneOf, idOf(x));
      if (!own) continue;
      listed = true;
      if (this.laneChain(own).includes(lane)) return true;
    }
    return !listed && this.laneProcess(lane) === h.process;
  }

  private frameIsHome(sem: MetricIndex, h: Home, frame: Shape): boolean {
    if (is(frame.el, 'bpmn:Participant')) return raw<El>(frame.el, 'processRef') === h.process;
    if (is(frame.el, 'bpmn:Lane')) return this.laneIsHome(sem, h, frame.el);
    return frame.el === h.host || h.scopes.includes(frame.el) || (!!h.host && this.scopesOf(h.host).includes(frame.el));
  }

  private centreInside(b: Box, f: Box): boolean {
    const c = { x: cx(b), y: cy(b) };
    return c.x > f.x && c.x < f.x + f.width && c.y > f.y && c.y < f.y + f.height;
  }

  /** shapes whose centre lies in a frame that is not theirs */
  private checkIntrusions(): void {
    const { sem, shapes, add } = this;
    const frames = shapes.filter((f) => f.container);
    for (const s of shapes) {
      const home = this.homeOf(s);
      if (!home) continue;
      for (const f of frames) {
        if (f === s || !this.centreInside(s.b, f.b) || this.frameIsHome(sem, home, f)) continue;
        if (this.scopesOf(f.el).includes(s.el)) continue; // a frame inside the shape itself
        add('frameIntrusion', `${s.id}@${f.id}`, [s.id, f.id]);
      }
    }
  }

  /** pools are compared all together, lanes and sub-processes per process */
  private frameFamily(f: Shape): string | undefined {
    if (is(f.el, 'bpmn:Participant')) return 'pools';
    const proc = is(f.el, 'bpmn:Lane') ? this.laneProcess(f.el) : this.scopesOf(f.el).find((x) => is(x, 'bpmn:Process'));
    return proc ? `${is(f.el, 'bpmn:Lane') ? 'lanes' : 'subs'}:${idOf(proc) ?? ''}` : undefined;
  }

  private nestedFrames(a: Shape, b: Shape): boolean {
    if (is(a.el, 'bpmn:Lane')) return this.laneChain(a.el).includes(b.el) || this.laneChain(b.el).includes(a.el);
    return this.scopesOf(a.el).includes(b.el) || this.scopesOf(b.el).includes(a.el);
  }

  /** two frames of one family overlapping, neither inside the other */
  private checkFrameOverlaps(): void {
    const { shapes, add } = this;
    const frames = shapes.filter((f) => f.container).map((f) => ({ f, family: this.frameFamily(f) }));
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const { f: a, family } = frames[i]!;
        const b = frames[j]!.f;
        if (!family || family !== frames[j]!.family || this.nestedFrames(a, b)) continue;
        const w = Math.min(a.b.x + a.b.width, b.b.x + b.b.width) - Math.max(a.b.x, b.b.x);
        const h = Math.min(a.b.y + a.b.height, b.b.y + b.b.height) - Math.max(a.b.y, b.b.y);
        if (w > 1 && h > 1) add('frameOverlap', `${a.id}&${b.id}`, [a.id, b.id]);
      }
    }
  }

  private checkDegenerate(): void {
    const { edges, add } = this;
    for (const e of edges) {
      const length = e.segs.reduce((sum, [p, q]) => sum + Math.abs(q.x - p.x) + Math.abs(q.y - p.y), 0);
      if (e.pts.length < 2 || !(length > 0)) add('degenerateEdge', e.id, [e.id]);
    }
  }

  private checkDetached(): void {
    const { edges, byId, add } = this;
    for (const e of edges) {
      if (e.pts.length < 2) continue;
      const [sid, tid] = drawnEnds(e.el);
      const missed: string[] = [];
      for (const [id, p] of [
        [sid, e.pts[0]!],
        [tid, e.pts[e.pts.length - 1]!],
      ] as const) {
        const s = lookup(byId, id);
        if (s && (p.x < s.b.x - DETACHED_GAP || p.x > s.b.x + s.b.width + DETACHED_GAP || p.y < s.b.y - DETACHED_GAP || p.y > s.b.y + s.b.height + DETACHED_GAP)) missed.push(s.id);
      }
      if (missed.length) add('detachedEdge', e.id, [e.id, ...missed]);
    }
  }

  private reaches(sem: MetricIndex, from: string, to: string): boolean {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      for (const n of sem.next.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return false;
  }

  /** sequence flows running backwards (target left of the source) that are not loop returns */
  private checkBackwardFlows(): void {
    const { sem, edges, byId, add } = this;
    for (const e of edges) {
      if (!is(e.el, 'bpmn:SequenceFlow')) continue;
      const sid = idOf(raw(e.el, 'sourceRef'));
      const tid = idOf(raw(e.el, 'targetRef'));
      const s = lookup(byId, sid);
      const t = lookup(byId, tid);
      if (!s || !t || !sid || !tid) continue;
      if (cx(t.b) >= s.b.x) continue;
      if (this.reaches(sem, tid, sid)) continue;
      add('backwardFlow', e.id, [e.id, sid, tid]);
    }
  }

  /**
   * two flows into one target sharing a line for more than 20 px; a fork's common first segment
   * and a join's common tail into the gateway's bottom / top vertex do not count
   */
  private checkSegmentOverlaps(): void {
    const { edges, byId, add } = this;
    const byTarget = new Map<string, Edge[]>();
    for (const e of edges) {
      const target = is(e.el, 'bpmn:SequenceFlow') ? idOf(raw(e.el, 'targetRef')) : undefined;
      if (!target) continue;
      const list = byTarget.get(target);
      if (list) list.push(e);
      else byTarget.set(target, [e]);
    }
    for (const [target, list] of byTarget) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const tail = joinTail(a, b, byId.get(target));
          let len = 0;
          for (const [k, sa] of a.segs.entries()) for (const [l, sb] of b.segs.entries()) if (!tail.has(`${k},${l}`)) len += Math.max(0, collinear(sa, sb));
          if (len > 20) add('segmentOverlap', `${a.id}=${b.id}`, [a.id, b.id, target], `${len}px`);
        }
      }
    }
  }

  private externallyLabelled(el: El): boolean {
    return is(el, 'bpmn:Event') || is(el, 'bpmn:Gateway') || is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference');
  }

  private labelHome(id: string): Shape | undefined {
    const { sem, byId } = this;
    const parent = sem.parentOf.get(id);
    if (!parent) return undefined;
    if (is(parent, 'bpmn:SubProcess')) {
      const sub = lookup(byId, idOf(parent));
      if (sub?.expanded) return sub;
    }
    return lookup(byId, idOf(lookup(sem.poolOf, idOf(enclosingProcess(parent)))));
  }

  /** named labels reaching out of their sub-process / pool */
  private checkLabelFrames(): void {
    const owners: Array<{ id: string; el: El; label?: Box }> = [...this.shapes.filter((s) => this.externallyLabelled(s.el)), ...this.edges.filter((e) => is(e.el, 'bpmn:SequenceFlow'))];
    for (const o of owners) {
      if (!o.label || !raw<string>(o.el, 'name')?.trim()) continue;
      const frame = this.labelHome(o.id);
      if (!frame || inside(o.label, { x: frame.b.x - 2, y: frame.b.y - 2, width: frame.b.width + 4, height: frame.b.height + 4 })) continue;
      this.add('labelOutsideFrame', `${o.id}#L@${frame.id}`, [o.id, frame.id]);
    }
  }

  /** named external labels on the title of an expanded sub-process */
  private checkLabelTitles(): void {
    const { shapes, edges, add } = this;
    const titles = shapes.flatMap((s) => {
      const box = subTitleOf(s);
      return box ? [{ id: s.id, box }] : [];
    });
    if (!titles.length) return;
    const owners: Array<{ id: string; el: El; label?: Box }> = [...shapes.filter((s) => this.externallyLabelled(s.el)), ...edges.filter((e) => is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow'))];
    for (const o of owners) {
      if (!o.label || !raw<string>(o.el, 'name')?.trim()) continue;
      for (const t of titles) if (overlap(o.label, t.box)) add('labelOnTitle', `${o.id}#L^${t.id}`, [o.id, t.id]);
    }
  }

  private segmentBoxDistance([p, q]: Seg, b: Box): number {
    if (ptIn(p, b) || ptIn(q, b) || cuts([p, q], b, 0)) return 0;
    const pointBox = (r: Point): number => Math.hypot(Math.max(b.x - r.x, 0, r.x - b.x - b.width), Math.max(b.y - r.y, 0, r.y - b.y - b.height));
    const pointSeg = (r: Point): number => {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / len)) : 0;
      return Math.hypot(r.x - (p.x + t * dx), r.y - (p.y + t * dy));
    };
    const corners: Point[] = [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x, y: b.y + b.height },
      { x: b.x + b.width, y: b.y + b.height },
    ];
    return Math.min(pointBox(p), pointBox(q), ...corners.map(pointSeg));
  }

  /** named message flows whose label is far from their line */
  private checkMessageLabels(): void {
    const { edges, add } = this;
    for (const e of edges) {
      const label = e.label;
      if (!is(e.el, 'bpmn:MessageFlow') || !label || !e.segs.length || !raw<string>(e.el, 'name')?.trim()) continue;
      const d = Math.min(...e.segs.map((s) => this.segmentBoxDistance(s, label)));
      if (d > 50) add('messageLabelFar', e.id, [e.id], `${Math.round(d)}px`);
    }
  }
}
