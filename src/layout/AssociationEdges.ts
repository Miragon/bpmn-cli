import { addTo, is, many, walk, type El, type Model } from '../model/utils/moddle.js';
import { SUB_PROCESS_TYPES } from '../diagram/utils/expansion.js';
import { center, containsPoint } from '../diagram/utils/geom.js';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface PlaneIndex {
  plane: El;
  shapes: Map<El, El>;
  edges: Map<El, El>;
}

const HANDLER_GAP = 40;

const OVERLAP_MARGIN = 10;

export class AssociationEdges {
  constructor(private readonly model: Model) {}

  private boundsOf(shape: El): Rect | undefined {
    const b = shape.get<El | undefined>('bounds');
    if (!b) return undefined;
    const x = b.get<number>('x');
    const y = b.get<number>('y');
    const width = b.get<number>('width');
    const height = b.get<number>('height');
    if ([x, y, width, height].some((v) => typeof v !== 'number')) return undefined;
    return { x, y, width, height };
  }

  private setBounds(shape: El, rect: Rect): void {
    const b = shape.get<El>('bounds');
    b.set('x', rect.x);
    b.set('y', rect.y);
  }

  private overlaps(a: Rect, b: Rect, margin = 0): boolean {
    return a.x - margin < b.x + b.width && a.x + a.width + margin > b.x && a.y - margin < b.y + b.height && a.y + a.height + margin > b.y;
  }

  private contains(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  }

  /** The point on the border of `r` where a line from its centre towards `to` leaves it. */
  private borderPoint(r: Rect, to: Point): Point {
    const c = center(r);
    const dx = to.x - c.x;
    const dy = to.y - c.y;
    if (!dx && !dy) return c;
    const hw = r.width / 2;
    const hh = r.height / 2;
    if (Math.abs(dx) * hh >= Math.abs(dy) * hw) {
      const sx = Math.sign(dx) * hw;
      return { x: Math.round(c.x + sx), y: Math.round(c.y + (dy * sx) / dx) };
    }
    const sy = Math.sign(dy) * hh;
    return { x: Math.round(c.x + (dx * sy) / dy), y: Math.round(c.y + sy) };
  }

  private waypoints(edge: El): Point[] {
    return many(edge, 'waypoint').map((p) => ({ x: p.get<number>('x'), y: p.get<number>('y') }));
  }

  /** Midpoint of the middle segment of a polyline. */
  private midpoint(points: Point[]): Point | undefined {
    if (!points.length) return undefined;
    if (points.length === 1) return points[0];
    const i = Math.floor((points.length - 1) / 2);
    const a = points[i]!;
    const b = points[i + 1]!;
    return { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  }

  private indexPlanes(defs: El): PlaneIndex[] {
    const out: PlaneIndex[] = [];
    for (const diagram of many(defs, 'diagrams')) {
      const plane = diagram.get<El | undefined>('plane');
      if (!plane) continue;
      const shapes = new Map<El, El>();
      const edges = new Map<El, El>();
      for (const di of many(plane, 'planeElement')) {
        const target = di.get<El | undefined>('bpmnElement');
        if (!target) continue;
        if (is(di, 'bpmndi:BPMNShape')) shapes.set(target, di);
        else if (is(di, 'bpmndi:BPMNEdge')) edges.set(target, di);
      }
      out.push({ plane, shapes, edges });
    }
    return out;
  }

  /** Where an association may dock on an element: its shape, or the middle of its edge. */
  private anchorOf(index: PlaneIndex, el: El): { rect?: Rect; point?: Point } | undefined {
    const shape = index.shapes.get(el);
    if (shape) {
      const rect = this.boundsOf(shape);
      return rect ? { rect } : undefined;
    }
    const edge = index.edges.get(el);
    if (edge) {
      const point = this.midpoint(this.waypoints(edge));
      return point ? { point } : undefined;
    }
    return undefined;
  }

  private dock(anchor: { rect?: Rect; point?: Point }, towards: Point): Point {
    return anchor.rect ? this.borderPoint(anchor.rect, towards) : anchor.point!;
  }

  private referenceOf(anchor: { rect?: Rect; point?: Point }): Point {
    return anchor.rect ? center(anchor.rect) : anchor.point!;
  }

  private isCompensationHandlerPair(source: El, target: El): boolean {
    if (!is(source, 'bpmn:BoundaryEvent') || !is(target, 'bpmn:Activity')) return false;
    return many(source, 'eventDefinitions').some((d) => is(d, 'bpmn:CompensateEventDefinition'));
  }

  /** Container shapes (pools, lanes, expanded sub-processes) enclosing a point. */
  private containersAround(index: PlaneIndex, p: Point): Rect[] {
    const out: Rect[] = [];
    for (const [el, shape] of index.shapes) {
      const isContainer = is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (SUB_PROCESS_TYPES.some((t) => is(el, t)) && shape.get<boolean | undefined>('isExpanded') === true);
      if (!isContainer) continue;
      const r = this.boundsOf(shape);
      if (r && containsPoint(r, p)) out.push(r);
    }
    return out;
  }

  /**
   * Moves a compensation handler right below its boundary event when that spot
   * (or one a little further down) is free and inside the same containers.
   */
  private placeHandlerBelow(index: PlaneIndex, handler: El, handlerRect: Rect, eventRect: Rect): Rect | undefined {
    const containers = this.containersAround(index, center(handlerRect));
    const others: Rect[] = [];
    for (const [el, shape] of index.shapes) {
      if (el === handler) continue;
      if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane')) continue;
      if (SUB_PROCESS_TYPES.some((t) => is(el, t)) && shape.get<boolean | undefined>('isExpanded') === true) continue;
      const r = this.boundsOf(shape);
      if (r) others.push(r);
    }
    const x = Math.round(eventRect.x + eventRect.width / 2 - handlerRect.width / 2);
    for (let gap = HANDLER_GAP; gap <= HANDLER_GAP * 4; gap += 20) {
      const candidate: Rect = { x, y: eventRect.y + eventRect.height + gap, width: handlerRect.width, height: handlerRect.height };
      if (others.some((o) => this.overlaps(candidate, o, OVERLAP_MARGIN))) continue;
      if (!containers.every((c) => this.contains(c, candidate))) return undefined;
      return candidate;
    }
    return undefined;
  }

  /**
   * Creates a BPMNEdge for every association that has none although both ends
   * are drawn on the same plane. Returns the ids of the associations fixed.
   */
  synthesise(): string[] {
    const { moddle, definitions } = this.model;
    const planes = this.indexPlanes(definitions);
    if (!planes.length) return [];
    const fixed: string[] = [];
    for (const assoc of [...walk(definitions)].filter((e) => is(e, 'bpmn:Association'))) {
      const source = assoc.get<El | undefined>('sourceRef');
      const target = assoc.get<El | undefined>('targetRef');
      const id = assoc.get<string | undefined>('id');
      if (!source || !target || !id) continue;
      if (planes.some((p) => p.edges.has(assoc))) continue;
      const index = planes.find((p) => (p.shapes.has(source) || p.edges.has(source)) && (p.shapes.has(target) || p.edges.has(target)));
      if (!index) continue;
      let from = this.anchorOf(index, source);
      let to = this.anchorOf(index, target);
      if (!from || !to) continue;
      if (this.isCompensationHandlerPair(source, target) && from.rect && to.rect) {
        const moved = this.placeHandlerBelow(index, target, to.rect, from.rect);
        if (moved) {
          this.setBounds(index.shapes.get(target)!, moved);
          to = { rect: moved };
        }
      }
      const a = this.dock(from, this.referenceOf(to));
      const b = this.dock(to, a);
      const edge = moddle.create('bpmndi:BPMNEdge', {
        id: `BPMNEdge_${id}`,
        bpmnElement: assoc,
        waypoint: [moddle.create('dc:Point', a), moddle.create('dc:Point', b)],
      });
      addTo(index.plane, 'planeElement', edge);
      index.edges.set(assoc, edge);
      fixed.push(id);
    }
    return fixed;
  }
}
