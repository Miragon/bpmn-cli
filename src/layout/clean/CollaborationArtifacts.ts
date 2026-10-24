import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { SIZES, annotationSize } from '../../diagram/utils/sizes.js';
import { center, borderPoint } from '../../diagram/utils/geom.js';
import type { Box, Point } from '../../diagram/types.js';
import type { EngineWarning } from './CleanEngine.js';
import type { DiWriter } from './DiWriter.js';
import { NotePlacer, type NoteJob } from './NotePlacer.js';
import type { PoolLayout } from './PoolStacker.js';
import type { Segment } from './utils/geometry.js';
import { laneDepth } from './utils/lanes.js';
import { isContainerShape, poolOf } from './utils/pools.js';

export class CollaborationArtifacts {
  constructor(
    private readonly root: El,
    private readonly pools: PoolLayout[],
    private readonly writer: DiWriter,
  ) {}

  draw(warnings: EngineWarning[]): void {
    const { writer } = this;
    for (const note of this.notes()) {
      if (note.box) writer.shape(note.el, note.box);
      else warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(note.el), message: `Artifacts owned by the collaboration are not laid out (${idOf(note.el)})` });
    }
    for (const link of this.links()) {
      if (link.points) writer.edge(link.el, link.points);
      else warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(link.el), message: `No DI created for ${idOf(link.el)} (an end has no shape)` });
    }
  }

  /**
   * Boxes for the text annotations owned by the collaboration, next to the
   * first element an association ties them to (see NotePlacer). Groups are left
   * out: layoutModel draws them around what they held (diagram/Groups.ts).
   */
  private notes(): Array<{ el: El; box?: Box }> {
    const { pools } = this;
    const { absBoxes } = this.writer;
    const artifacts = many(this.root, 'artifacts');
    const links = artifacts.filter((a) => is(a, 'bpmn:Association'));
    const notes = artifacts.filter((a) => is(a, 'bpmn:TextAnnotation'));
    const edges = this.drawnEdges();
    const poolBoxes = pools.map((p) => p.box);
    const jobs: NoteJob[] = notes.map((note) => {
      const size = annotationSize(note.get<string | undefined>('text'));
      for (const link of links) {
        const s = link.get<El | undefined>('sourceRef'), t = link.get<El | undefined>('targetRef');
        const other = s === note ? t : t === note ? s : undefined;
        const anchor = this.endBox(other, edges, poolBoxes);
        if (!other || !anchor) continue;
        // inside the anchor's pool, and in its lane when it has one
        const pool = is(other, 'bpmn:Participant') || !absBoxes.has(idOf(other)) ? undefined : poolOf(pools, other);
        return { ...size, anchor, ...(pool ? { pool: this.clip(this.poolContent(pool), this.laneBoxOf(other)) } : {}) };
      }
      return { ...size };
    });
    const world = { ...this.drawnWorld(), pools: pools.map((p) => p.box) };
    const boxes = new NotePlacer(world).place(jobs);
    return [...notes.map((el, i) => ({ el, box: boxes[i] })), ...artifacts.filter((a) => !is(a, 'bpmn:Association') && !is(a, 'bpmn:TextAnnotation') && !is(a, 'bpmn:Group')).map((el) => ({ el }))];
  }

  /** Straight association lines of the collaboration (both ends drawn), border to border. */
  private links(): Array<{ el: El; points?: Point[] }> {
    const edges = this.drawnEdges();
    const poolBoxes = this.pools.map((p) => p.box);
    return many(this.root, 'artifacts')
      .filter((a) => is(a, 'bpmn:Association'))
      .map((el) => {
        const a = this.endBox(el.get<El | undefined>('sourceRef'), edges, poolBoxes);
        const b = this.endBox(el.get<El | undefined>('targetRef'), edges, poolBoxes);
        if (!a || !b) return { el };
        const p = borderPoint(a, center(b));
        return { el, points: [p, borderPoint(b, p)] };
      });
  }

  /** Waypoints of the drawn edges by element id. */
  private drawnEdges(): Map<string, Point[]> {
    const out = new Map<string, Point[]>();
    for (const d of this.writer.di) {
      const el = d.get<El | undefined>('bpmnElement');
      if (!el || is(d, 'bpmndi:BPMNShape')) continue;
      out.set(idOf(el), many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') })));
    }
    return out;
  }

  /** Middle of the longest segment of a polyline, as a zero-size box. */
  private edgeAnchor(points: Point[]): Box | undefined {
    let best: [Point, Point] | undefined;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!;
      if (!best || Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > Math.abs(best[1].x - best[0].x) + Math.abs(best[1].y - best[0].y)) best = [a, b];
    }
    return best ? { x: Math.round((best[0].x + best[1].x) / 2), y: Math.round((best[0].y + best[1].y) / 2), width: 0, height: 0 } : undefined;
  }

  /** Pieces of an orthogonal segment outside every box (the boxes cut it into intervals). */
  private outsidePieces(a: Point, b: Point, boxes: Box[]): Array<[Point, Point]> {
    const vertical = a.x === b.x;
    if (!vertical && a.y !== b.y) return [[a, b]];
    const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    const fixed = vertical ? a.x : a.y;
    const cuts = boxes
      .filter((r) => (vertical ? fixed > r.x && fixed < r.x + r.width : fixed > r.y && fixed < r.y + r.height))
      .map((r) => (vertical ? [r.y, r.y + r.height] : [r.x, r.x + r.width]) as [number, number])
      .sort((p, q) => p[0] - q[0]);
    const out: Array<[Point, Point]> = [];
    const at = (v: number): Point => (vertical ? { x: fixed, y: v } : { x: v, y: fixed });
    let cursor = lo;
    for (const [c1, c2] of cuts) {
      if (c1 > cursor) out.push([at(cursor), at(Math.min(c1, hi))]);
      cursor = Math.max(cursor, c2);
      if (cursor >= hi) break;
    }
    if (cursor < hi) out.push([at(cursor), at(hi)]);
    return out;
  }

  /** The drawn box of an association end: a shape, or a point on a drawn edge (between the pools for a message flow). */
  private endBox(el: El | undefined, edges: Map<string, Point[]>, pools: Box[] = []): Box | undefined {
    if (!el) return undefined;
    const id = idOf(el);
    const box = this.writer.absBoxes.get(id);
    if (box) return box;
    const points = edges.get(id);
    if (!points) return undefined;
    if (is(el, 'bpmn:MessageFlow')) {
      const pieces = points.slice(1).flatMap((p, i) => this.outsidePieces(points[i]!, p, pools));
      if (pieces.length) return this.edgeAnchor(pieces.reduce((best, piece) => (this.len(piece) > this.len(best) ? piece : best)));
    }
    return this.edgeAnchor(points);
  }

  private len([a, b]: [Point, Point]): number {
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }

  /** The leaf lane box an element is drawn in (by lane membership), if any. */
  private laneBoxOf(el: El): Box | undefined {
    const { absBoxes } = this.writer;
    let process: El | undefined = el.$parent as El | undefined;
    while (process && !is(process, 'bpmn:Process')) process = process.$parent as El | undefined;
    if (!process) return undefined;
    const visit = (laneSet: El | undefined): Box | undefined => {
      for (const lane of laneSet ? many(laneSet, 'lanes') : []) {
        const child = lane.get<El | undefined>('childLaneSet');
        const found = child && many(child, 'lanes').length ? visit(child) : (lane.get<El[] | undefined>('flowNodeRef') ?? []).includes(el) ? absBoxes.get(idOf(lane)) : undefined;
        if (found) return found;
      }
      return undefined;
    };
    for (const laneSet of many(process, 'laneSets')) {
      const found = visit(laneSet);
      if (found) return found;
    }
    return undefined;
  }

  /** Intersection of two boxes (the first when they do not intersect). */
  private clip(a: Box, b: Box | undefined): Box {
    if (!b) return a;
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.width, b.x + b.width), d = Math.min(a.y + a.height, b.y + b.height);
    return r > x && d > y ? { x, y, width: r - x, height: d - y } : a;
  }

  /** Content area of a pool (right of its header and lane headers). */
  private poolContent(p: PoolLayout): Box {
    const left = SIZES.participantHeader + (p.scope?.lanes.length ? laneDepth(p.scope.lanes) : 0) * SIZES.laneHeader;
    return { x: p.box.x + left, y: p.box.y, width: p.box.width - left, height: p.box.height };
  }

  /** Leaf shapes and labels of the drawing (what a note must not cover) and its edges. */
  private drawnWorld(): { obstacles: Box[]; lines: Segment[] } {
    const { absBoxes } = this.writer;
    const obstacles: Box[] = [];
    const lines: Segment[] = [];
    const boxOf = (b: El): Box => ({ x: b.get<number>('x'), y: b.get<number>('y'), width: b.get<number>('width'), height: b.get<number>('height') });
    for (const d of this.writer.di) {
      const el = d.get<El | undefined>('bpmnElement');
      if (!el) continue;
      const label = d.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (label) obstacles.push(boxOf(label));
      if (is(d, 'bpmndi:BPMNShape')) {
        const box = absBoxes.get(idOf(el));
        if (box && !isContainerShape(d, el)) obstacles.push(box);
        continue;
      }
      const pts = many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') }));
      for (let i = 0; i + 1 < pts.length; i++) lines.push([pts[i]!, pts[i + 1]!]);
    }
    return { obstacles, lines };
  }
}
