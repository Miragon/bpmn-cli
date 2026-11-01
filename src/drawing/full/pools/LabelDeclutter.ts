import { Box, DiagramIndex, Point, Polyline, type BpmnElement, type Segment } from '../../../model/index.js';
import { Frames } from '../../plane/Frames.js';
import { LabelSpots } from './LabelSpots.js';

interface Item {
  el: BpmnElement;
  bounds: BpmnElement;
  box: Box;
  shape?: Box | undefined;
  points?: Point[] | undefined;
}

export class LabelDeclutter {
  private static readonly RUN_KEEP = 2;
  private static readonly LABEL_KEEP = 2;

  private readonly shapes: Box[] = [];
  private readonly frames: Box[] = [];
  private readonly frameOfEl = new Map<BpmnElement, Box>();
  private readonly titles = new Map<Box, Box | undefined>();
  private readonly lines: Segment[] = [];
  private readonly items: Item[] = [];
  private readonly placed: Box[] = [];
  private readonly titleBoxes: Box[];

  constructor(di: readonly BpmnElement[]) {
    for (const element of di) {
      this.read(element);
    }
    this.titleBoxes = [...this.titles.values()].filter((title): title is Box => !!title);
  }

  private static isContainer(di: BpmnElement, element: BpmnElement): boolean {
    return element.is('bpmn:Participant') || element.is('bpmn:Lane') || (element.is('bpmn:SubProcess') && di.get<boolean | undefined>('isExpanded') === true);
  }

  private static holds(frame: Box, point: Point): boolean {
    return point.x >= frame.x && point.x <= frame.right && point.y >= frame.y && point.y <= frame.bottom;
  }

  private static within(frame: Box, box: Box): boolean {
    return box.x >= frame.x && box.y >= frame.y && box.right <= frame.right && box.bottom <= frame.bottom;
  }

  run(): void {
    for (const item of this.items) {
      const box = this.clashes(item.box, item.shape) ? this.freeSpot(item) : item.box;
      if (box !== item.box) {
        item.bounds.set('x', Math.round(box.x));
        item.bounds.set('y', Math.round(box.y));
      }
      this.placed.push(box);
    }
  }

  private read(di: BpmnElement): void {
    const element = di.peek<BpmnElement>('bpmnElement');
    if (!element) {
      return;
    }
    const isShape = di.is('bpmndi:BPMNShape');
    const shape = isShape ? DiagramIndex.boxOf(di.peek<BpmnElement>('bounds')) : undefined;
    if (shape) {
      this.readShape(shape, di, element);
    }
    const points = isShape ? undefined : di.list('waypoint').map((waypoint) => new Point(waypoint.get<number>('x'), waypoint.get<number>('y')));
    if (points) {
      this.lines.push(...new Polyline(points).segments());
    }
    const bounds = di.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds');
    if (bounds) {
      this.items.push({ el: element, bounds, box: DiagramIndex.boxOf(bounds)!, shape, points });
    }
  }

  private readShape(shape: Box, di: BpmnElement, element: BpmnElement): void {
    if (!LabelDeclutter.isContainer(di, element)) {
      this.shapes.push(shape);
      return;
    }
    this.frames.push(shape);
    this.frameOfEl.set(element, shape);
    if (element.is('bpmn:SubProcess')) {
      this.titles.set(shape, Frames.titleBox(shape, element.get<string | undefined>('name')));
    }
  }

  private frameFor(item: Item): Box | undefined {
    if (item.shape) {
      const hostElement = item.el.is('bpmn:BoundaryEvent') ? item.el.peek<BpmnElement>('attachedToRef') : undefined;
      return this.frameOf([item.shape.center], hostElement && this.frameOfEl.get(hostElement));
    }
    return item.points?.length ? this.frameOf([item.points[0]!, item.points.at(-1)!]) : undefined;
  }

  private freeSpot(item: Item): Box {
    const spots = new LabelSpots(item.box);
    const { spots: candidates, near } = item.shape ? spots.aroundShape(item.shape) : { spots: spots.alongLine(item.points ?? []), near: Number.POSITIVE_INFINITY };
    const isFree = (candidate: Box): boolean => !this.clashes(candidate, item.shape);
    const frame = this.frameFor(item);
    const area = frame && this.areaOf(frame);
    const keepIn = frame && (area || LabelDeclutter.within(frame, item.box)) ? frame : undefined;
    const pick = (free: readonly Box[]): Box | undefined => (area && free.find((candidate) => LabelDeclutter.within(area, candidate))) ?? free.find((candidate) => !keepIn || LabelDeclutter.within(keepIn, candidate));
    return pick(candidates.slice(0, near).filter(isFree)) ?? pick(candidates.slice(near).filter(isFree)) ?? candidates.find(isFree) ?? item.box;
  }

  private frameOf(points: readonly Point[], host?: Box): Box | undefined {
    const holding = this.frames.filter((frame) => frame !== host && points.every((point) => LabelDeclutter.holds(frame, point)));
    return holding.sort((first, second) => first.width * first.height - second.width * second.height)[0];
  }

  private areaOf(frame: Box): Box | undefined {
    if (!this.titles.has(frame)) {
      return undefined;
    }
    const title = this.titles.get(frame);
    const top = title ? title.bottom + 2 : frame.y;
    return new Box(frame.x, top, frame.width, frame.bottom - top);
  }

  private clashes(box: Box, own: Box | undefined): boolean {
    const keep = LabelDeclutter.LABEL_KEEP;
    return (
      this.shapes.some((shape) => shape !== own && shape.overlaps(box, keep)) ||
      this.placed.some((other) => other.overlaps(box, keep)) ||
      this.lines.some((line) => line.hitsBounds(box, line.start.y === line.end.y ? -LabelDeclutter.RUN_KEEP : 1)) ||
      this.titleBoxes.some((title) => title.overlaps(box, keep))
    );
  }
}
