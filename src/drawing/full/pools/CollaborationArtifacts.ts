import { Box, BoxBorder, DiagramIndex, Point, Polyline, type BpmnElement, type Segment } from '../../../model/index.js';
import { Frames } from '../../plane/Frames.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { LaneBox } from '../scopes/LaneBox.js';
import type { PoolLayout, PoolLayouts } from '../scopes/PoolLayouts.js';
import type { FreshDrawingWriter, EngineWarning } from './FreshDrawingWriter.js';
import { NotePlacer, type NoteJob, type NoteWorld } from './NotePlacer.js';

type Lines = ReadonlyMap<string, Point[]>;

export class CollaborationArtifacts {
  constructor(
    private readonly root: BpmnElement,
    private readonly pools: PoolLayouts,
    private readonly writer: FreshDrawingWriter,
  ) {}

  private static pointsOf(edge: BpmnElement): Point[] {
    return edge.list('waypoint').map((waypoint) => new Point(waypoint.get<number>('x'), waypoint.get<number>('y')));
  }

  private static clip(box: Box, laneBox: Box | undefined): Box {
    if (!laneBox) {
      return box;
    }
    const left = Math.max(box.x, laneBox.x);
    const top = Math.max(box.y, laneBox.y);
    const right = Math.min(box.right, laneBox.right);
    const bottom = Math.min(box.bottom, laneBox.bottom);
    return right > left && bottom > top ? new Box(left, top, right - left, bottom - top) : box;
  }

  private static poolContent({ scope, box }: PoolLayout): Box {
    const left = ShapeSizes.PARTICIPANT_HEADER + LaneBox.depthOf(scope?.lanes ?? []) * ShapeSizes.LANE_HEADER;
    return new Box(box.x + left, box.y, box.width - left, box.height);
  }

  private static lengthOf({ start, end }: Segment): number {
    return Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  }

  private static anchorOn(pieces: readonly Segment[]): Box | undefined {
    const longest = pieces.reduce<Segment | undefined>((best, piece) => (!best || CollaborationArtifacts.lengthOf(piece) > CollaborationArtifacts.lengthOf(best) ? piece : best), undefined);
    return longest && new Box(Math.round((longest.start.x + longest.end.x) / 2), Math.round((longest.start.y + longest.end.y) / 2), 0, 0);
  }

  private static cutsOf(fixed: number, vertical: boolean, boxes: readonly Box[]): Array<[number, number]> {
    return boxes
      .filter((box) => (vertical ? fixed > box.x && fixed < box.right : fixed > box.y && fixed < box.bottom))
      .map((box): [number, number] => (vertical ? [box.y, box.bottom] : [box.x, box.right]))
      .sort((first, second) => first[0] - second[0]);
  }

  private static outsidePieces(segment: Segment, boxes: readonly Box[]): Segment[] {
    const { start, end } = segment;
    const vertical = start.x === end.x;
    if (!vertical && start.y !== end.y) {
      return [segment];
    }
    const [low, high] = vertical ? [Math.min(start.y, end.y), Math.max(start.y, end.y)] : [Math.min(start.x, end.x), Math.max(start.x, end.x)];
    const fixed = vertical ? start.x : start.y;
    const piece = (from: number, to: number): Segment => (vertical ? new Polyline([new Point(fixed, from), new Point(fixed, to)]) : new Polyline([new Point(from, fixed), new Point(to, fixed)])).segments()[0]!;
    const pieces: Segment[] = [];
    let cursor = low;
    for (const [cutStart, cutEnd] of CollaborationArtifacts.cutsOf(fixed, vertical, boxes)) {
      if (cutStart > cursor) {
        pieces.push(piece(cursor, Math.min(cutStart, high)));
      }
      cursor = Math.max(cursor, cutEnd);
      if (cursor >= high) {
        break;
      }
    }
    return cursor < high ? [...pieces, piece(cursor, high)] : pieces;
  }

  private static otherEnd(note: BpmnElement, source: BpmnElement | undefined, target: BpmnElement | undefined): BpmnElement | undefined {
    if (source === note) {
      return target;
    }
    return target === note ? source : undefined;
  }

  private static processOf(element: BpmnElement | undefined): BpmnElement | undefined {
    let current = element;
    while (current && !current.is('bpmn:Process')) {
      current = current.parent;
    }
    return current;
  }

  draw(warnings: EngineWarning[]): void {
    const { writer } = this;
    for (const { el, box } of this.notes()) {
      if (box) {
        writer.shape(el, box);
      } else {
        warnings.push({ code: 'DI_NOT_CREATED', elementId: el.id, message: `Artifacts owned by the collaboration are not laid out (${el.id})` });
      }
    }
    for (const { el, points } of this.links()) {
      if (points) {
        writer.edge(el, points);
      } else {
        warnings.push({ code: 'DI_NOT_CREATED', elementId: el.id, message: `No DI created for ${el.id} (an end has no shape)` });
      }
    }
  }

  private poolBoxes(): Box[] {
    return this.pools.list.map((pool) => pool.box);
  }

  private notes(): Array<{ el: BpmnElement; box?: Box | undefined }> {
    const artifacts = this.root.list('artifacts');
    const links = artifacts.filter((artifact) => artifact.is('bpmn:Association'));
    const notes = artifacts.filter((artifact) => artifact.is('bpmn:TextAnnotation'));
    const lines = this.drawnLines();
    const boxes = new NotePlacer(this.drawnWorld()).place(notes.map((note) => this.jobOf(note, links, lines)));
    const others = artifacts.filter((artifact) => !artifact.is('bpmn:Association') && !artifact.is('bpmn:TextAnnotation') && !artifact.is('bpmn:Group'));
    return [...notes.map((el, index) => ({ el, box: boxes[index] })), ...others.map((el) => ({ el }))];
  }

  private jobOf(note: BpmnElement, links: readonly BpmnElement[], lines: Lines): NoteJob {
    const size = ShapeSizes.ofAnnotation(note.get<string | undefined>('text'));
    for (const link of links) {
      const [source, target] = [link.peek<BpmnElement>('sourceRef'), link.peek<BpmnElement>('targetRef')];
      const other = CollaborationArtifacts.otherEnd(note, source, target);
      const anchor = this.endBox(other, lines);
      if (other && anchor) {
        const pool = other.is('bpmn:Participant') || !this.writer.absBoxes.has(other.id) ? undefined : this.pools.of(other);
        return { ...size, anchor, ...(pool ? { pool: CollaborationArtifacts.clip(CollaborationArtifacts.poolContent(pool), this.laneBoxOf(other)) } : {}) };
      }
    }
    return size;
  }

  private links(): Array<{ el: BpmnElement; points?: Point[] | undefined }> {
    const lines = this.drawnLines();
    return this.root
      .list('artifacts')
      .filter((artifact) => artifact.is('bpmn:Association'))
      .map((el) => {
        const sourceBox = this.endBox(el.peek<BpmnElement>('sourceRef'), lines);
        const targetBox = this.endBox(el.peek<BpmnElement>('targetRef'), lines);
        if (!sourceBox || !targetBox) {
          return { el };
        }
        const start = new BoxBorder(sourceBox).pointTowards(targetBox.center);
        return { el, points: [start, new BoxBorder(targetBox).pointTowards(start)] };
      });
  }

  private drawnLines(): Map<string, Point[]> {
    const lines = new Map<string, Point[]>();
    for (const planeElement of this.writer.planeElements) {
      const element = planeElement.peek<BpmnElement>('bpmnElement');
      if (element && !planeElement.is('bpmndi:BPMNShape')) {
        lines.set(element.id, CollaborationArtifacts.pointsOf(planeElement));
      }
    }
    return lines;
  }

  private endBox(element: BpmnElement | undefined, lines: Lines): Box | undefined {
    if (!element) {
      return undefined;
    }
    const box = this.writer.absBoxes.get(element.id);
    const points = lines.get(element.id);
    if (box || !points) {
      return box;
    }
    const segments = new Polyline(points).segments();
    const pools = this.poolBoxes();
    const outside = element.is('bpmn:MessageFlow') ? segments.flatMap((segment) => CollaborationArtifacts.outsidePieces(segment, pools)) : [];
    return CollaborationArtifacts.anchorOn(outside.length ? outside : segments);
  }

  private laneBoxOf(element: BpmnElement): Box | undefined {
    const process = CollaborationArtifacts.processOf(element.parent);
    for (const laneSet of process?.list('laneSets') ?? []) {
      const found = this.laneIn(laneSet, element);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private laneIn(laneSet: BpmnElement, element: BpmnElement): Box | undefined {
    for (const lane of laneSet.list('lanes')) {
      const found = this.laneOrChildOf(lane, element);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private laneOrChildOf(lane: BpmnElement, element: BpmnElement): Box | undefined {
    const child = lane.peek<BpmnElement>('childLaneSet');
    if (child?.list('lanes').length) {
      return this.laneIn(child, element);
    }
    return (lane.get<BpmnElement[] | undefined>('flowNodeRef') ?? []).includes(element) ? this.writer.absBoxes.get(lane.id) : undefined;
  }

  private drawnWorld(): NoteWorld {
    const { planeElements, absBoxes } = this.writer;
    const obstacles: Box[] = [];
    const lines: Segment[] = [];
    for (const element of planeElements) {
      const owner = element.peek<BpmnElement>('bpmnElement');
      const label = owner && DiagramIndex.boxOf(element.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds'));
      if (label) {
        obstacles.push(label);
      }
      if (owner && !element.is('bpmndi:BPMNShape')) {
        lines.push(...new Polyline(CollaborationArtifacts.pointsOf(element)).segments());
      }
      const box = owner && element.is('bpmndi:BPMNShape') ? absBoxes.get(owner.id) : undefined;
      if (box && !Frames.isContainerShape(element, owner!)) {
        obstacles.push(box);
      }
    }
    return { obstacles, lines, pools: this.poolBoxes() };
  }
}
