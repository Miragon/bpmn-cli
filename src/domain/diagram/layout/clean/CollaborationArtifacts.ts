import { enclosingProcess, is, many, type El, idOf } from '../../../document/utils/moddle.js';
import { SIZES, annotationSize } from '../../utils/sizes.js';
import { center, borderPoint, type Segment } from '../../utils/geom.js';
import type { Box, Point } from '../../di/types.js';
import type { EngineWarning } from './CleanEngine.js';
import type { DiWriter } from './DiWriter.js';
import { NotePlacer, type NoteJob } from './NotePlacer.js';
import type { PoolLayout } from './PoolStacker.js';
import { laneDepth } from '../../utils/lanes.js';
import { isContainerShape, poolOf } from '../../utils/pools.js';

/**
 * Draws the text annotations a collaboration owns and their straight associations.
 * Groups are left out: the caller redraws them around what they held.
 */
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

  /** A note goes inside its anchor's pool, and in its lane when it has one. */
  private notes(): Array<{ el: El; box?: Box }> {
    const { pools } = this;
    const { absBoxes } = this.writer;
    const artifacts = many(this.root, 'artifacts');
    const links = artifacts.filter((artifact) => is(artifact, 'bpmn:Association'));
    const notes = artifacts.filter((artifact) => is(artifact, 'bpmn:TextAnnotation'));
    const edges = this.drawnEdges();
    const poolBoxes = pools.map((poolLayout) => poolLayout.box);
    const jobs: NoteJob[] = notes.map((note) => {
      const size = annotationSize(note.get<string | undefined>('text'));
      for (const link of links) {
        const source = link.get<El | undefined>('sourceRef'), target = link.get<El | undefined>('targetRef');
        const other = source === note ? target : target === note ? source : undefined;
        const anchor = this.endBox(other, edges, poolBoxes);
        if (!other || !anchor) continue;
        const pool = is(other, 'bpmn:Participant') || !absBoxes.has(idOf(other)) ? undefined : poolOf(pools, other);
        return { ...size, anchor, ...(pool ? { pool: this.clip(this.poolContent(pool), this.laneBoxOf(other)) } : {}) };
      }
      return { ...size };
    });
    const world = { ...this.drawnWorld(), pools: pools.map((poolLayout) => poolLayout.box) };
    const boxes = new NotePlacer(world).place(jobs);
    return [...notes.map((el, index) => ({ el, box: boxes[index] })), ...artifacts.filter((artifact) => !is(artifact, 'bpmn:Association') && !is(artifact, 'bpmn:TextAnnotation') && !is(artifact, 'bpmn:Group')).map((el) => ({ el }))];
  }

  private links(): Array<{ el: El; points?: Point[] }> {
    const edges = this.drawnEdges();
    const poolBoxes = this.pools.map((poolLayout) => poolLayout.box);
    return many(this.root, 'artifacts')
      .filter((artifact) => is(artifact, 'bpmn:Association'))
      .map((el) => {
        const sourceBox = this.endBox(el.get<El | undefined>('sourceRef'), edges, poolBoxes);
        const targetBox = this.endBox(el.get<El | undefined>('targetRef'), edges, poolBoxes);
        if (!sourceBox || !targetBox) return { el };
        const start = borderPoint(sourceBox, center(targetBox));
        return { el, points: [start, borderPoint(targetBox, start)] };
      });
  }

  private drawnEdges(): Map<string, Point[]> {
    const out = new Map<string, Point[]>();
    for (const diElement of this.writer.di) {
      const el = diElement.get<El | undefined>('bpmnElement');
      if (!el || is(diElement, 'bpmndi:BPMNShape')) continue;
      out.set(idOf(el), many(diElement, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') })));
    }
    return out;
  }

  private edgeAnchor(points: Point[]): Box | undefined {
    let best: [Point, Point] | undefined;
    for (let index = 0; index + 1 < points.length; index++) {
      const start = points[index]!, end = points[index + 1]!;
      if (!best || Math.abs(end.x - start.x) + Math.abs(end.y - start.y) > Math.abs(best[1].x - best[0].x) + Math.abs(best[1].y - best[0].y)) best = [start, end];
    }
    return best ? { x: Math.round((best[0].x + best[1].x) / 2), y: Math.round((best[0].y + best[1].y) / 2), width: 0, height: 0 } : undefined;
  }

  private outsidePieces(start: Point, end: Point, boxes: Box[]): Array<[Point, Point]> {
    const vertical = start.x === end.x;
    if (!vertical && start.y !== end.y) return [[start, end]];
    const lo = vertical ? Math.min(start.y, end.y) : Math.min(start.x, end.x), hi = vertical ? Math.max(start.y, end.y) : Math.max(start.x, end.x);
    const fixed = vertical ? start.x : start.y;
    const cuts = boxes
      .filter((obstacle) => (vertical ? fixed > obstacle.x && fixed < obstacle.x + obstacle.width : fixed > obstacle.y && fixed < obstacle.y + obstacle.height))
      .map((obstacle) => (vertical ? [obstacle.y, obstacle.y + obstacle.height] : [obstacle.x, obstacle.x + obstacle.width]) as [number, number])
      .sort((firstCut, secondCut) => firstCut[0] - secondCut[0]);
    const out: Array<[Point, Point]> = [];
    const at = (position: number): Point => (vertical ? { x: fixed, y: position } : { x: position, y: fixed });
    let cursor = lo;
    for (const [c1, c2] of cuts) {
      if (c1 > cursor) out.push([at(cursor), at(Math.min(c1, hi))]);
      cursor = Math.max(cursor, c2);
      if (cursor >= hi) break;
    }
    if (cursor < hi) out.push([at(cursor), at(hi)]);
    return out;
  }

  /** A message flow end is a point between the pools. */
  private endBox(el: El | undefined, edges: Map<string, Point[]>, pools: Box[] = []): Box | undefined {
    if (!el) return undefined;
    const id = idOf(el);
    const box = this.writer.absBoxes.get(id);
    if (box) return box;
    const points = edges.get(id);
    if (!points) return undefined;
    if (is(el, 'bpmn:MessageFlow')) {
      const pieces = points.slice(1).flatMap((point, index) => this.outsidePieces(points[index]!, point, pools));
      if (pieces.length) return this.edgeAnchor(pieces.reduce((best, piece) => (this.len(piece) > this.len(best) ? piece : best)));
    }
    return this.edgeAnchor(points);
  }

  private len([start, end]: [Point, Point]): number {
    return Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  }

  private laneBoxOf(el: El): Box | undefined {
    const { absBoxes } = this.writer;
    const process = enclosingProcess(el.$parent as El | undefined);
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

  /** the first box when they do not intersect */
  private clip(box: Box, laneBox: Box | undefined): Box {
    if (!laneBox) return box;
    const left = Math.max(box.x, laneBox.x), top = Math.max(box.y, laneBox.y);
    const right = Math.min(box.x + box.width, laneBox.x + laneBox.width), bottom = Math.min(box.y + box.height, laneBox.y + laneBox.height);
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : box;
  }

  private poolContent(pool: PoolLayout): Box {
    const left = SIZES.participantHeader + (pool.scope?.lanes.length ? laneDepth(pool.scope.lanes) : 0) * SIZES.laneHeader;
    return { x: pool.box.x + left, y: pool.box.y, width: pool.box.width - left, height: pool.box.height };
  }

  private drawnWorld(): { obstacles: Box[]; lines: Segment[] } {
    const { absBoxes } = this.writer;
    const obstacles: Box[] = [];
    const lines: Segment[] = [];
    const boxOf = (bounds: El): Box => ({ x: bounds.get<number>('x'), y: bounds.get<number>('y'), width: bounds.get<number>('width'), height: bounds.get<number>('height') });
    for (const diElement of this.writer.di) {
      const el = diElement.get<El | undefined>('bpmnElement');
      if (!el) continue;
      const label = diElement.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (label) obstacles.push(boxOf(label));
      if (is(diElement, 'bpmndi:BPMNShape')) {
        const box = absBoxes.get(idOf(el));
        if (box && !isContainerShape(diElement, el)) obstacles.push(box);
        continue;
      }
      const pts = many(diElement, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') }));
      for (let index = 0; index + 1 < pts.length; index++) lines.push([pts[index]!, pts[index + 1]!]);
    }
    return { obstacles, lines };
  }
}
