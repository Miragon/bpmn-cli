import { enclosingProcess, is, type El } from '../../document/utils/moddle.js';
import type { Box, Point } from './types.js';
import { containsPoint, cx, cy, overlaps, segmentHits, segmentsCross, type Segment } from '../utils/geom.js';
import { collinear, drawnEnds, glyph, hits, inside, joinTail, lookup, readDrawnPlane, subTitleOf, type Edge, type MetricIndex, type Shape } from '../utils/harness.js';
import { idOf, raw, rawList } from '../utils/raw.js';
import type { MetricKey } from '../utils/problems.js';

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
    this.leaf = shapes.filter((shape) => !shape.container && !is(shape.el, 'bpmn:Group'));
    this.byId = new Map(shapes.map((shape) => [shape.id, shape]));
    this.pools = shapes.filter((shape) => is(shape.el, 'bpmn:Participant'));
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
    for (let firstIndex = 0; firstIndex < leaf.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < leaf.length; secondIndex++) {
        const first = leaf[firstIndex]!;
        const second = leaf[secondIndex]!;
        const attached = (is(first.el, 'bpmn:BoundaryEvent') && this.hostOf(first.el) === second.id) || (is(second.el, 'bpmn:BoundaryEvent') && this.hostOf(second.el) === first.id);
        if (!attached && overlaps(first.bounds, second.bounds)) add('overlaps', `${first.id}~${second.id}`, [first.id, second.id]);
      }
    }
  }

  /** diagonal segments of flows, edge segments through shapes they do not connect */
  private checkEdgeSegments(): void {
    const { edges, leaf, add } = this;
    for (const edge of edges) {
      const flow = is(edge.el, 'bpmn:SequenceFlow') || is(edge.el, 'bpmn:MessageFlow');
      for (const segment of edge.segs) {
        if (flow && segment[0].x !== segment[1].x && segment[0].y !== segment[1].y) add('diagonal', edge.id, [edge.id]);
        for (const sh of leaf) {
          if (edge.ends.has(sh.id)) continue;
          if (is(sh.el, 'bpmn:BoundaryEvent') && edge.ends.has(this.hostOf(sh.el))) continue;
          if (segmentHits(...segment, sh.bounds)) add('through', `${edge.id}->${sh.id}`, [edge.id, sh.id]);
        }
      }
    }
  }

  /** crossings of any two edges, collinear runs of unrelated edges */
  private checkEdgePairs(): void {
    const { edges, add } = this;
    for (let firstIndex = 0; firstIndex < edges.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex++) {
        const first = edges[firstIndex]!;
        const second = edges[secondIndex]!;
        if (first.segs.some((sa) => second.segs.some((sb) => segmentsCross(...sa, ...sb)))) add('crossings', `${first.id}x${second.id}`, [first.id, second.id]);
        const related = [...first.ends].some((end) => second.ends.has(end));
        if (related) continue;
        let len = 0;
        for (const sa of first.segs) for (const sb of second.segs) len += Math.max(0, collinear(sa, sb));
        if (len > 20) add('parallelRun', `${first.id}=${second.id}(${len})`, [first.id, second.id], `${len}px`);
      }
    }
  }

  private checkLabels(): void {
    const { shapes, edges, leaf, add } = this;
    const labels: Array<{ owner: string; box: Box; text: Box }> = [];
    for (const drawn of [...shapes, ...edges]) {
      if (drawn.label) labels.push({ owner: drawn.id, box: drawn.label, text: glyph(drawn.label, raw<string>(drawn.el, 'name') || '') });
    }
    for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
      const label = labels[labelIndex]!;
      for (const shape of leaf) {
        if (shape.id !== label.owner && overlaps(label.box, shape.bounds)) add('labelClash', `${label.owner}#L~${shape.id}`, [label.owner, shape.id], 'label on shape');
      }
      for (let otherIndex = labelIndex + 1; otherIndex < labels.length; otherIndex++) {
        const other = labels[otherIndex]!;
        if (overlaps(label.box, other.box)) add('labelClash', `${label.owner}#L~${other.owner}#L`, [label.owner, other.owner], 'label on label');
      }
      for (const edge of edges) if (edge.segs.some((segment) => hits(segment, label.text, 0))) add('labelOnLine', `${label.owner}#L~${edge.id}`, [label.owner, edge.id]);
    }
  }

  /** an incoming and an outgoing sequence flow of one node sharing a line */
  private checkInOut(): void {
    const { shapes, edges, add } = this;
    const flows = edges.filter((edge) => is(edge.el, 'bpmn:SequenceFlow'));
    for (const shape of shapes) {
      const into = flows.filter((edge) => idOf(raw(edge.el, 'targetRef')) === shape.id);
      const outOf = flows.filter((edge) => idOf(raw(edge.el, 'sourceRef')) === shape.id);
      for (const incoming of into) {
        for (const outgoing of outOf) {
          if (incoming !== outgoing && incoming.segs.some((incomingSegment) => outgoing.segs.some((outgoingSegment) => collinear(incomingSegment, outgoingSegment) > 0))) add('inOut', `${incoming.id}|${outgoing.id}@${shape.id}`, [incoming.id, outgoing.id, shape.id]);
        }
      }
    }
  }

  private checkContainment(): void {
    const { sem, shapes, byId, add } = this;
    for (const shape of shapes) {
      if (is(shape.el, 'bpmn:Participant') || is(shape.el, 'bpmn:Lane')) continue;
      const parent = sem.parentOf.get(shape.id);
      if (parent && is(parent, 'bpmn:SubProcess')) {
        const sub = lookup(byId, idOf(parent));
        if (sub?.expanded && !inside(shape.bounds, sub.bounds)) add('outsideSub', shape.id, [shape.id, sub.id]);
      }
      const lane = lookup(byId, idOf(sem.laneOf.get(shape.id)));
      if (lane && !is(shape.el, 'bpmn:BoundaryEvent') && !inside(shape.bounds, lane.bounds)) add('outsideLane', shape.id, [shape.id, lane.id]);
      const participant = parent && is(parent, 'bpmn:Process') ? lookup(sem.poolOf, idOf(parent)) : undefined;
      const pool = lookup(byId, idOf(participant));
      if (pool && !inside(shape.bounds, pool.bounds)) add('outsidePool', shape.id, [shape.id, pool.id]);
    }
  }

  /** top-level lanes not reaching the top / bottom border of their pool */
  private checkLaneGaps(): void {
    const { pools, byId, add } = this;
    for (const pool of pools) {
      const proc = raw<El>(pool.el, 'processRef');
      if (!proc) continue;
      for (const ls of rawList(proc, 'laneSets')) {
        const top = rawList(ls, 'lanes');
        const firstId = idOf(top[0]);
        const lastId = idOf(top[top.length - 1]);
        const first = lookup(byId, firstId);
        const last = lookup(byId, lastId);
        if (first && Math.abs(first.bounds.y - pool.bounds.y) > 1) add('laneGap', `${first.id}:top`, [first.id, pool.id], 'top');
        if (last && Math.abs(last.bounds.y + last.bounds.height - (pool.bounds.y + pool.bounds.height)) > 1) add('laneGap', `${last.id}:bottom`, [last.id, pool.id], 'bottom');
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

  private checkSequenceFlow(edge: Edge): void {
    const { sem, byId, add } = this;
    const frame = this.flowFrame(edge.id);
    if (frame && edge.points.some((point) => !containsPoint(frame.bounds, point))) add('edgeOutside', edge.id, [edge.id, frame.id]);
    const sl = lookup(sem.laneOf, idOf(raw(edge.el, 'sourceRef')));
    const tl = lookup(sem.laneOf, idOf(raw(edge.el, 'targetRef')));
    const lane = sl && sl === tl ? lookup(byId, idOf(sl)) : undefined;
    if (lane && edge.points.some((point) => !containsPoint(lane.bounds, point))) add('edgeLeavesLane', edge.id, [edge.id, lane.id]);
  }

  private checkMessageFlow(edge: Edge): void {
    const { sem, pools, add } = this;
    const ends = new Set<string | undefined>([idOf(raw(edge.el, 'sourceRef')), idOf(raw(edge.el, 'targetRef'))]);
    for (const id of [...ends]) {
      const proc = enclosingProcess(lookup(sem.parentOf, id));
      const participant = lookup(sem.poolOf, idOf(proc));
      if (participant) ends.add(idOf(participant));
    }
    for (const segment of edge.segs) {
      for (const pool of pools) if (!ends.has(pool.id) && hits(segment, pool.bounds)) add('msgThroughPool', `${edge.id}->${pool.id}`, [edge.id, pool.id]);
    }
  }

  private checkFlows(): void {
    for (const edge of this.edges) {
      if (is(edge.el, 'bpmn:SequenceFlow')) this.checkSequenceFlow(edge);
      if (is(edge.el, 'bpmn:MessageFlow')) this.checkMessageFlow(edge);
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
    for (let depth = 0; cur && depth < 50; depth++) {
      if (this.isScope(cur)) out.push(cur);
      if (is(cur, 'bpmn:Process')) break;
      cur = cur.$parent as El | undefined;
    }
    return out;
  }

  private laneChain(lane: El): El[] {
    const out: El[] = [];
    let cur: El | undefined = lane;
    for (let depth = 0; cur && depth < 50; depth++) {
      if (is(cur, 'bpmn:Lane')) out.push(cur);
      if (is(cur, 'bpmn:Process')) break;
      cur = cur.$parent as El | undefined;
    }
    return out;
  }

  private laneProcess(lane: El): El | undefined {
    let cur = lane.$parent as El | undefined;
    for (let depth = 0; cur && !is(cur, 'bpmn:Process') && depth < 50; depth++) cur = cur.$parent as El | undefined;
    return cur;
  }

  private homeOf(shape: Shape): Home | undefined {
    if (is(shape.el, 'bpmn:Participant') || is(shape.el, 'bpmn:Lane') || is(shape.el, 'bpmn:Group')) return undefined;
    const scopes = this.scopesOf(shape.el);
    const process = scopes[scopes.length - 1];
    if (!process || !is(process, 'bpmn:Process')) return undefined;
    const host = raw<El>(shape.el, 'attachedToRef');
    return { el: shape.el, scopes, process, ...(host ? { host } : {}) };
  }

  private laneIsHome(sem: MetricIndex, home: Home, lane: El): boolean {
    let listed = false;
    for (const candidate of [home.el, home.host, ...home.scopes.filter(this.isSub)]) {
      const own = lookup(sem.laneOf, idOf(candidate));
      if (!own) continue;
      listed = true;
      if (this.laneChain(own).includes(lane)) return true;
    }
    return !listed && this.laneProcess(lane) === home.process;
  }

  private frameIsHome(sem: MetricIndex, home: Home, frame: Shape): boolean {
    if (is(frame.el, 'bpmn:Participant')) return raw<El>(frame.el, 'processRef') === home.process;
    if (is(frame.el, 'bpmn:Lane')) return this.laneIsHome(sem, home, frame.el);
    return frame.el === home.host || home.scopes.includes(frame.el) || (!!home.host && this.scopesOf(home.host).includes(frame.el));
  }

  private centreInside(box: Box, frame: Box): boolean {
    const middle = { x: cx(box), y: cy(box) };
    return middle.x > frame.x && middle.x < frame.x + frame.width && middle.y > frame.y && middle.y < frame.y + frame.height;
  }

  /** shapes whose centre lies in a frame that is not theirs */
  private checkIntrusions(): void {
    const { sem, shapes, add } = this;
    const frames = shapes.filter((frame) => frame.container);
    for (const shape of shapes) {
      const home = this.homeOf(shape);
      if (!home) continue;
      for (const frame of frames) {
        if (frame === shape || !this.centreInside(shape.bounds, frame.bounds) || this.frameIsHome(sem, home, frame)) continue;
        const frameInsideShape = this.scopesOf(frame.el).includes(shape.el);
        if (frameInsideShape) continue;
        add('frameIntrusion', `${shape.id}@${frame.id}`, [shape.id, frame.id]);
      }
    }
  }

  /** pools are compared all together, lanes and sub-processes per process */
  private frameFamily(frame: Shape): string | undefined {
    if (is(frame.el, 'bpmn:Participant')) return 'pools';
    const proc = is(frame.el, 'bpmn:Lane') ? this.laneProcess(frame.el) : this.scopesOf(frame.el).find((scope) => is(scope, 'bpmn:Process'));
    return proc ? `${is(frame.el, 'bpmn:Lane') ? 'lanes' : 'subs'}:${idOf(proc) ?? ''}` : undefined;
  }

  private nestedFrames(first: Shape, second: Shape): boolean {
    if (is(first.el, 'bpmn:Lane')) return this.laneChain(first.el).includes(second.el) || this.laneChain(second.el).includes(first.el);
    return this.scopesOf(first.el).includes(second.el) || this.scopesOf(second.el).includes(first.el);
  }

  /** two frames of one family overlapping, neither inside the other */
  private checkFrameOverlaps(): void {
    const { shapes, add } = this;
    const frames = shapes.filter((shape) => shape.container).map((frame) => ({ frame, family: this.frameFamily(frame) }));
    for (let firstIndex = 0; firstIndex < frames.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < frames.length; secondIndex++) {
        const { frame: first, family } = frames[firstIndex]!;
        const second = frames[secondIndex]!.frame;
        if (!family || family !== frames[secondIndex]!.family || this.nestedFrames(first, second)) continue;
        const overlapWidth = Math.min(first.bounds.x + first.bounds.width, second.bounds.x + second.bounds.width) - Math.max(first.bounds.x, second.bounds.x);
        const overlapHeight = Math.min(first.bounds.y + first.bounds.height, second.bounds.y + second.bounds.height) - Math.max(first.bounds.y, second.bounds.y);
        if (overlapWidth > 1 && overlapHeight > 1) add('frameOverlap', `${first.id}&${second.id}`, [first.id, second.id]);
      }
    }
  }

  private checkDegenerate(): void {
    const { edges, add } = this;
    for (const edge of edges) {
      const length = edge.segs.reduce((sum, [start, end]) => sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y), 0);
      if (edge.points.length < 2 || !(length > 0)) add('degenerateEdge', edge.id, [edge.id]);
    }
  }

  private checkDetached(): void {
    const { edges, byId, add } = this;
    for (const edge of edges) {
      if (edge.points.length < 2) continue;
      const [sid, tid] = drawnEnds(edge.el);
      const missed: string[] = [];
      for (const [id, endPoint] of [
        [sid, edge.points[0]!],
        [tid, edge.points[edge.points.length - 1]!],
      ] as const) {
        const endShape = lookup(byId, id);
        if (endShape && (endPoint.x < endShape.bounds.x - DETACHED_GAP || endPoint.x > endShape.bounds.x + endShape.bounds.width + DETACHED_GAP || endPoint.y < endShape.bounds.y - DETACHED_GAP || endPoint.y > endShape.bounds.y + endShape.bounds.height + DETACHED_GAP)) missed.push(endShape.id);
      }
      if (missed.length) add('detachedEdge', edge.id, [edge.id, ...missed]);
    }
  }

  private reaches(sem: MetricIndex, from: string, to: string): boolean {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      for (const next of sem.next.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return false;
  }

  /** sequence flows running backwards (target left of the source) that are not loop returns */
  private checkBackwardFlows(): void {
    const { sem, edges, byId, add } = this;
    for (const edge of edges) {
      if (!is(edge.el, 'bpmn:SequenceFlow')) continue;
      const sid = idOf(raw(edge.el, 'sourceRef'));
      const tid = idOf(raw(edge.el, 'targetRef'));
      const source = lookup(byId, sid);
      const target = lookup(byId, tid);
      if (!source || !target || !sid || !tid) continue;
      if (cx(target.bounds) >= source.bounds.x) continue;
      if (this.reaches(sem, tid, sid)) continue;
      add('backwardFlow', edge.id, [edge.id, sid, tid]);
    }
  }

  /**
   * two flows into one target sharing a line for more than 20 px; a fork's common first segment
   * and a join's common tail into the gateway's bottom / top vertex do not count
   */
  private checkSegmentOverlaps(): void {
    const { edges, byId, add } = this;
    const byTarget = new Map<string, Edge[]>();
    for (const edge of edges) {
      const target = is(edge.el, 'bpmn:SequenceFlow') ? idOf(raw(edge.el, 'targetRef')) : undefined;
      if (!target) continue;
      const list = byTarget.get(target);
      if (list) list.push(edge);
      else byTarget.set(target, [edge]);
    }
    for (const [target, list] of byTarget) {
      for (let firstIndex = 0; firstIndex < list.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < list.length; secondIndex++) {
          const first = list[firstIndex]!;
          const second = list[secondIndex]!;
          const tail = joinTail(first, second, byId.get(target));
          let len = 0;
          for (const [firstSegmentIndex, sa] of first.segs.entries()) for (const [secondSegmentIndex, sb] of second.segs.entries()) if (!tail.has(`${firstSegmentIndex},${secondSegmentIndex}`)) len += Math.max(0, collinear(sa, sb));
          if (len > 20) add('segmentOverlap', `${first.id}=${second.id}`, [first.id, second.id, target], `${len}px`);
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
    const owners: Array<{ id: string; el: El; label?: Box }> = [...this.shapes.filter((shape) => this.externallyLabelled(shape.el)), ...this.edges.filter((edge) => is(edge.el, 'bpmn:SequenceFlow'))];
    for (const owner of owners) {
      if (!owner.label || !raw<string>(owner.el, 'name')?.trim()) continue;
      const frame = this.labelHome(owner.id);
      if (!frame || inside(owner.label, { x: frame.bounds.x - 2, y: frame.bounds.y - 2, width: frame.bounds.width + 4, height: frame.bounds.height + 4 })) continue;
      this.add('labelOutsideFrame', `${owner.id}#L@${frame.id}`, [owner.id, frame.id]);
    }
  }

  /** named external labels on the title of an expanded sub-process */
  private checkLabelTitles(): void {
    const { shapes, edges, add } = this;
    const titles = shapes.flatMap((shape) => {
      const box = subTitleOf(shape);
      return box ? [{ id: shape.id, box }] : [];
    });
    if (!titles.length) return;
    const owners: Array<{ id: string; el: El; label?: Box }> = [...shapes.filter((shape) => this.externallyLabelled(shape.el)), ...edges.filter((edge) => is(edge.el, 'bpmn:SequenceFlow') || is(edge.el, 'bpmn:MessageFlow'))];
    for (const owner of owners) {
      if (!owner.label || !raw<string>(owner.el, 'name')?.trim()) continue;
      for (const title of titles) if (overlaps(owner.label, title.box)) add('labelOnTitle', `${owner.id}#L^${title.id}`, [owner.id, title.id]);
    }
  }

  private segmentBoxDistance([start, end]: Segment, box: Box): number {
    if (containsPoint(box, start) || containsPoint(box, end) || segmentHits(start, end, box, 0)) return 0;
    const pointBox = (point: Point): number => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width), Math.max(box.y - point.y, 0, point.y - box.y - box.height));
    const pointSeg = (point: Point): number => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = dx * dx + dy * dy;
      const progress = len ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / len)) : 0;
      return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
    };
    const corners: Point[] = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ];
    return Math.min(pointBox(start), pointBox(end), ...corners.map(pointSeg));
  }

  /** named message flows whose label is far from their line */
  private checkMessageLabels(): void {
    const { edges, add } = this;
    for (const edge of edges) {
      const label = edge.label;
      if (!is(edge.el, 'bpmn:MessageFlow') || !label || !edge.segs.length || !raw<string>(edge.el, 'name')?.trim()) continue;
      const distance = Math.min(...edge.segs.map((segment) => this.segmentBoxDistance(segment, label)));
      if (distance > 50) add('messageLabelFar', edge.id, [edge.id], `${Math.round(distance)}px`);
    }
  }
}
