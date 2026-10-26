import { titleBox } from '../../utils/text.js';
import { boxesOverlap } from '../../utils/geom.js';
import type { Box, Point } from '../../di/types.js';
import { is, many, type El } from '../../../document/utils/moddle.js';
import { toSegments, type Segment } from '../../utils/geometry.js';

const RUN_KEEP = 2;

interface Item {
  el: El;
  bounds: El;
  box: Box;
  shape?: Box;
  points?: Point[];
}

/**
 * Moves labels that sit on a shape, a label, a line or a sub-process title to the nearest free
 * spot around their element, preferring spots inside the element's frame. Runs on one finished
 * plane in emit order; every placed label becomes an obstacle for the next.
 */
export class LabelDeclutter {
  private readonly shapes: Box[] = [];
  private readonly frames: Box[] = [];
  private readonly frameOfEl = new Map<El, Box>();
  private readonly titles = new Map<Box, Box | undefined>();
  private readonly lines: Segment[] = [];
  private readonly items: Item[] = [];
  private readonly placed: Box[] = [];
  private readonly titleBoxes: Box[];

  constructor(di: El[]) {
    for (const diagramElement of di) {
      const el = diagramElement.get<El | undefined>('bpmnElement');
      if (!el) continue;
      const isShape = is(diagramElement, 'bpmndi:BPMNShape');
      const container = isShape && (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (is(el, 'bpmn:SubProcess') && diagramElement.get<boolean | undefined>('isExpanded') === true));
      const shapeBox = isShape ? this.boxOf(diagramElement.get<El>('bounds')) : undefined;
      if (shapeBox && !container) this.shapes.push(shapeBox);
      if (shapeBox && container) {
        this.frames.push(shapeBox);
        this.frameOfEl.set(el, shapeBox);
        if (is(el, 'bpmn:SubProcess')) this.titles.set(shapeBox, titleBox(shapeBox, el.get<string | undefined>('name')));
      }
      const points = isShape ? undefined : many(diagramElement, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') }));
      if (points) this.lines.push(...toSegments(points));
      const label = diagramElement.get<El | undefined>('label');
      const bounds = label?.get<El | undefined>('bounds');
      if (!bounds) continue;
      this.items.push({ el, bounds, box: this.boxOf(bounds), ...(shapeBox ? { shape: shapeBox } : {}), ...(points ? { points } : {}) });
    }
    this.titleBoxes = [...this.titles.values()].filter((title): title is Box => !!title);
  }

  run(): void {
    const { placed } = this;
    for (const item of this.items) {
      const labelBox = item.box;
      if (!this.clashes(labelBox, item.shape)) {
        placed.push(labelBox);
        continue;
      }
      const cands: Box[] = [];
      /** candidates from this index on are stepped further out */
      let near = Infinity;
      if (item.shape) {
        const shape = item.shape;
        const cx = shape.x + shape.width / 2;
        const below = shape.y + shape.height + 6, above = shape.y - labelBox.height - 6;
        for (const dx of [0, -0.6, 0.6, -1.2, 1.2]) {
          cands.push({ ...labelBox, x: Math.round(cx - labelBox.width / 2 + dx * labelBox.width), y: below });
          cands.push({ ...labelBox, x: Math.round(cx - labelBox.width / 2 + dx * labelBox.width), y: above });
        }
        for (const dy of [0, -1, 1]) {
          cands.push({ ...labelBox, x: shape.x + shape.width + 6, y: Math.round(shape.y + shape.height / 2 - labelBox.height / 2 + dy * labelBox.height) });
          cands.push({ ...labelBox, x: shape.x - labelBox.width - 6, y: Math.round(shape.y + shape.height / 2 - labelBox.height / 2 + dy * labelBox.height) });
        }
        near = cands.length;
        for (const step of [1, 2, 3]) {
          cands.push({ ...labelBox, x: Math.round(cx - labelBox.width / 2), y: below + step * (labelBox.height + 4) });
          cands.push({ ...labelBox, x: Math.round(cx - labelBox.width / 2), y: above - step * (labelBox.height + 4) });
        }
      } else if (item.points) {
        for (const [start, end] of toSegments(item.points)) {
          const horizontal = start.y === end.y;
          const lo = Math.min(start.x, end.x), hi = Math.max(start.x, end.x);
          const loY = Math.min(start.y, end.y), hiY = Math.max(start.y, end.y);
          if (horizontal && hi - lo >= labelBox.width / 2) {
            for (const fraction of [0.05, 0.5, 0.95]) {
              const left = Math.round(lo + (hi - lo) * fraction - labelBox.width / 2);
              cands.push({ ...labelBox, x: left, y: start.y - labelBox.height - 4 });
              cands.push({ ...labelBox, x: left, y: start.y + 4 });
            }
          } else if (!horizontal && hiY - loY >= labelBox.height) {
            for (const fraction of [0.2, 0.5, 0.8]) {
              const top = Math.round(loY + (hiY - loY) * fraction - labelBox.height / 2);
              cands.push({ ...labelBox, x: start.x + 6, y: top });
              cands.push({ ...labelBox, x: start.x - labelBox.width - 6, y: top });
            }
          }
        }
      }
      const hostEl = is(item.el, 'bpmn:BoundaryEvent') ? item.el.get<El | undefined>('attachedToRef') : undefined;
      const host = hostEl ? this.frameOfEl.get(hostEl) : undefined;
      const frame = item.shape ? this.frameOf([{ x: item.shape.x + item.shape.width / 2, y: item.shape.y + item.shape.height / 2 }], host) : item.points?.length ? this.frameOf([item.points[0]!, item.points[item.points.length - 1]!]) : undefined;
      /**
       * A lane or pool keeps a label only when it was inside; a far spot below a sub-process
       * title does not beat a near one beside it.
       */
      const isFree = (candidate: Box): boolean => !this.clashes(candidate, item.shape);
      const area = frame ? this.areaOf(frame) : undefined;
      const keepIn = frame && (area || this.within(frame, labelBox)) ? frame : undefined;
      const pick = (free: Box[]): Box | undefined => (area ? free.find((candidate) => this.within(area, candidate)) : undefined) ?? free.find((candidate) => !keepIn || this.within(keepIn, candidate));
      const win = pick(cands.slice(0, near).filter(isFree)) ?? pick(cands.slice(near).filter(isFree)) ?? cands.find(isFree);
      const box = win ?? labelBox;
      item.bounds.set('x', Math.round(box.x));
      item.bounds.set('y', Math.round(box.y));
      placed.push(box);
    }
  }

  private boxOf(bounds: El): Box {
    return { x: bounds.get<number>('x'), y: bounds.get<number>('y'), width: bounds.get<number>('width'), height: bounds.get<number>('height') };
  }

  private hitsBox([start, end]: Segment, box: Box, shrink = 0): boolean {
    return Math.min(start.x, end.x) < box.x + box.width - shrink && Math.max(start.x, end.x) > box.x + shrink && Math.min(start.y, end.y) < box.y + box.height - shrink && Math.max(start.y, end.y) > box.y + shrink;
  }

  private holds(frame: Box, point: Point): boolean {
    return point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height;
  }

  private within(frame: Box, box: Box): boolean {
    return box.x >= frame.x && box.y >= frame.y && box.x + box.width <= frame.x + frame.width && box.y + box.height <= frame.y + frame.height;
  }

  /** A boundary event's frame is not its host: its label hangs outside. */
  private frameOf(pts: Point[], host?: Box): Box | undefined {
    return this.frames.filter((frame) => frame !== host && pts.every((point) => this.holds(frame, point))).sort((first, second) => first.width * first.height - second.width * second.height)[0];
  }

  /** a sub-process is sized for the labels below its title */
  private areaOf(frame: Box): Box | undefined {
    if (!this.titles.has(frame)) return undefined;
    const title = this.titles.get(frame);
    const top = title ? title.y + title.height + 2 : frame.y;
    return { x: frame.x, y: top, width: frame.width, height: frame.y + frame.height - top };
  }

  /** Whether `box` hits a shape, a placed label, a title or a line (the text would sit on it). */
  private clashes(box: Box, own?: Box): boolean {
    return (
      this.shapes.some((shape) => shape !== own && boxesOverlap(shape, box, 2)) ||
      this.placed.some((other) => boxesOverlap(other, box, 2)) ||
      this.lines.some((seg) => this.hitsBox(seg, box, seg[0].y === seg[1].y ? -RUN_KEEP : 1)) ||
      this.titleBoxes.some((title) => boxesOverlap(title, box, 2))
    );
  }
}
