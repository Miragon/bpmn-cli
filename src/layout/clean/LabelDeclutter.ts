import { titleBox } from '../../drawing/utils/text.js';
import { boxesOverlap } from '../../drawing/utils/geom.js';
import type { Box, Point } from '../../drawing/types.js';
import { is, many, type El } from '../../model/utils/moddle.js';
import { toSegments, type Segment } from './utils/geometry.js';

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
    for (const d of di) {
      const el = d.get<El | undefined>('bpmnElement');
      if (!el) continue;
      const isShape = is(d, 'bpmndi:BPMNShape');
      const container = isShape && (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (is(el, 'bpmn:SubProcess') && d.get<boolean | undefined>('isExpanded') === true));
      const shapeBox = isShape ? this.boxOf(d.get<El>('bounds')) : undefined;
      if (shapeBox && !container) this.shapes.push(shapeBox);
      if (shapeBox && container) {
        this.frames.push(shapeBox);
        this.frameOfEl.set(el, shapeBox);
        if (is(el, 'bpmn:SubProcess')) this.titles.set(shapeBox, titleBox(shapeBox, el.get<string | undefined>('name')));
      }
      const points = isShape ? undefined : many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') }));
      if (points) this.lines.push(...toSegments(points));
      const label = d.get<El | undefined>('label');
      const bounds = label?.get<El | undefined>('bounds');
      if (!bounds) continue;
      this.items.push({ el, bounds, box: this.boxOf(bounds), ...(shapeBox ? { shape: shapeBox } : {}), ...(points ? { points } : {}) });
    }
    this.titleBoxes = [...this.titles.values()].filter((t): t is Box => !!t);
  }

  run(): void {
    const { placed } = this;
    for (const item of this.items) {
      const b = item.box;
      if (!this.clashes(b, item.shape)) {
        placed.push(b);
        continue;
      }
      const cands: Box[] = [];
      /** candidates from this index on are stepped further out */
      let near = Infinity;
      if (item.shape) {
        const s = item.shape;
        const cx = s.x + s.width / 2;
        const below = s.y + s.height + 6, above = s.y - b.height - 6;
        for (const dx of [0, -0.6, 0.6, -1.2, 1.2]) {
          cands.push({ ...b, x: Math.round(cx - b.width / 2 + dx * b.width), y: below });
          cands.push({ ...b, x: Math.round(cx - b.width / 2 + dx * b.width), y: above });
        }
        for (const dy of [0, -1, 1]) {
          cands.push({ ...b, x: s.x + s.width + 6, y: Math.round(s.y + s.height / 2 - b.height / 2 + dy * b.height) });
          cands.push({ ...b, x: s.x - b.width - 6, y: Math.round(s.y + s.height / 2 - b.height / 2 + dy * b.height) });
        }
        near = cands.length;
        for (const step of [1, 2, 3]) {
          cands.push({ ...b, x: Math.round(cx - b.width / 2), y: below + step * (b.height + 4) });
          cands.push({ ...b, x: Math.round(cx - b.width / 2), y: above - step * (b.height + 4) });
        }
      } else if (item.points) {
        for (const [p, q] of toSegments(item.points)) {
          const horizontal = p.y === q.y;
          const lo = Math.min(p.x, q.x), hi = Math.max(p.x, q.x);
          const loY = Math.min(p.y, q.y), hiY = Math.max(p.y, q.y);
          if (horizontal && hi - lo >= b.width / 2) {
            for (const t of [0.05, 0.5, 0.95]) {
              const x = Math.round(lo + (hi - lo) * t - b.width / 2);
              cands.push({ ...b, x, y: p.y - b.height - 4 });
              cands.push({ ...b, x, y: p.y + 4 });
            }
          } else if (!horizontal && hiY - loY >= b.height) {
            for (const t of [0.2, 0.5, 0.8]) {
              const y = Math.round(loY + (hiY - loY) * t - b.height / 2);
              cands.push({ ...b, x: p.x + 6, y });
              cands.push({ ...b, x: p.x - b.width - 6, y });
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
      const isFree = (c: Box): boolean => !this.clashes(c, item.shape);
      const area = frame ? this.areaOf(frame) : undefined;
      const keepIn = frame && (area || this.within(frame, b)) ? frame : undefined;
      const pick = (free: Box[]): Box | undefined => (area ? free.find((c) => this.within(area, c)) : undefined) ?? free.find((c) => !keepIn || this.within(keepIn, c));
      const win = pick(cands.slice(0, near).filter(isFree)) ?? pick(cands.slice(near).filter(isFree)) ?? cands.find(isFree);
      const box = win ?? b;
      item.bounds.set('x', Math.round(box.x));
      item.bounds.set('y', Math.round(box.y));
      placed.push(box);
    }
  }

  private boxOf(bounds: El): Box {
    return { x: bounds.get<number>('x'), y: bounds.get<number>('y'), width: bounds.get<number>('width'), height: bounds.get<number>('height') };
  }

  private hitsBox([p, q]: Segment, b: Box, shrink = 0): boolean {
    return Math.min(p.x, q.x) < b.x + b.width - shrink && Math.max(p.x, q.x) > b.x + shrink && Math.min(p.y, q.y) < b.y + b.height - shrink && Math.max(p.y, q.y) > b.y + shrink;
  }

  private holds(f: Box, p: Point): boolean {
    return p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height;
  }

  private within(f: Box, b: Box): boolean {
    return b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height;
  }

  /** A boundary event's frame is not its host: its label hangs outside. */
  private frameOf(pts: Point[], host?: Box): Box | undefined {
    return this.frames.filter((f) => f !== host && pts.every((p) => this.holds(f, p))).sort((a, b) => a.width * a.height - b.width * b.height)[0];
  }

  /** a sub-process is sized for the labels below its title */
  private areaOf(f: Box): Box | undefined {
    if (!this.titles.has(f)) return undefined;
    const t = this.titles.get(f);
    const top = t ? t.y + t.height + 2 : f.y;
    return { x: f.x, y: top, width: f.width, height: f.y + f.height - top };
  }

  private clashes(b: Box, own?: Box): boolean {
    return (
      this.shapes.some((s) => s !== own && boxesOverlap(s, b, 2)) ||
      this.placed.some((o) => boxesOverlap(o, b, 2)) ||
      // the text would sit on the line
      this.lines.some((seg) => this.hitsBox(seg, b, seg[0].y === seg[1].y ? -RUN_KEEP : 1)) ||
      this.titleBoxes.some((t) => boxesOverlap(t, b, 2))
    );
  }
}
