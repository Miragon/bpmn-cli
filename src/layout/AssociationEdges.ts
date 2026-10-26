import { addTo, is, many, walk, type El, type Model } from '../model/utils/moddle.js';
import { SUB_PROCESS_TYPES } from '../drawing/utils/expansion.js';
import { center, containsPoint, cx } from '../drawing/utils/geom.js';

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

/**
 * Draws the association edges bpmn-auto-layout leaves out: ends that are flows or pools,
 * and compensation associations, whose handler moves below its boundary event (bpmn.io style).
 */
export class AssociationEdges {
  constructor(private readonly model: Model) {}

  private boundsOf(shape: El): Rect | undefined {
    const bounds = shape.get<El | undefined>('bounds');
    if (!bounds) return undefined;
    const left = bounds.get<number>('x');
    const top = bounds.get<number>('y');
    const width = bounds.get<number>('width');
    const height = bounds.get<number>('height');
    if ([left, top, width, height].some((coordinate) => typeof coordinate !== 'number')) return undefined;
    return { x: left, y: top, width, height };
  }

  private setBounds(shape: El, rect: Rect): void {
    const bounds = shape.get<El>('bounds');
    bounds.set('x', rect.x);
    bounds.set('y', rect.y);
  }

  private overlaps(first: Rect, second: Rect, margin = 0): boolean {
    return first.x - margin < second.x + second.width && first.x + first.width + margin > second.x && first.y - margin < second.y + second.height && first.y + first.height + margin > second.y;
  }

  private contains(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  }

  private borderPoint(rect: Rect, to: Point): Point {
    const middle = center(rect);
    const dx = to.x - middle.x;
    const dy = to.y - middle.y;
    if (!dx && !dy) return middle;
    const hw = rect.width / 2;
    const hh = rect.height / 2;
    if (Math.abs(dx) * hh >= Math.abs(dy) * hw) {
      const sx = Math.sign(dx) * hw;
      return { x: Math.round(middle.x + sx), y: Math.round(middle.y + (dy * sx) / dx) };
    }
    const sy = Math.sign(dy) * hh;
    return { x: Math.round(middle.x + (dx * sy) / dy), y: Math.round(middle.y + sy) };
  }

  private waypoints(edge: El): Point[] {
    return many(edge, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') }));
  }

  private midpoint(points: Point[]): Point | undefined {
    if (!points.length) return undefined;
    if (points.length === 1) return points[0];
    const middleIndex = Math.floor((points.length - 1) / 2);
    const segmentStart = points[middleIndex]!;
    const segmentEnd = points[middleIndex + 1]!;
    return { x: Math.round((segmentStart.x + segmentEnd.x) / 2), y: Math.round((segmentStart.y + segmentEnd.y) / 2) };
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
    return many(source, 'eventDefinitions').some((definition) => is(definition, 'bpmn:CompensateEventDefinition'));
  }

  private containersAround(index: PlaneIndex, point: Point): Rect[] {
    const out: Rect[] = [];
    for (const [el, shape] of index.shapes) {
      const isContainer = is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (SUB_PROCESS_TYPES.some((type) => is(el, type)) && shape.get<boolean | undefined>('isExpanded') === true);
      if (!isContainer) continue;
      const rect = this.boundsOf(shape);
      if (rect && containsPoint(rect, point)) out.push(rect);
    }
    return out;
  }

  private placeHandlerBelow(index: PlaneIndex, handler: El, handlerRect: Rect, eventRect: Rect): Rect | undefined {
    const containers = this.containersAround(index, center(handlerRect));
    const others: Rect[] = [];
    for (const [el, shape] of index.shapes) {
      if (el === handler) continue;
      if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane')) continue;
      if (SUB_PROCESS_TYPES.some((type) => is(el, type)) && shape.get<boolean | undefined>('isExpanded') === true) continue;
      const rect = this.boundsOf(shape);
      if (rect) others.push(rect);
    }
    const left = Math.round(cx(eventRect) - handlerRect.width / 2);
    for (let gap = HANDLER_GAP; gap <= HANDLER_GAP * 4; gap += 20) {
      const candidate: Rect = { x: left, y: eventRect.y + eventRect.height + gap, width: handlerRect.width, height: handlerRect.height };
      if (others.some((other) => this.overlaps(candidate, other, OVERLAP_MARGIN))) continue;
      if (!containers.every((container) => this.contains(container, candidate))) return undefined;
      return candidate;
    }
    return undefined;
  }

  synthesise(): string[] {
    const { moddle, definitions } = this.model;
    const planes = this.indexPlanes(definitions);
    if (!planes.length) return [];
    const fixed: string[] = [];
    for (const assoc of [...walk(definitions)].filter((element) => is(element, 'bpmn:Association'))) {
      const source = assoc.get<El | undefined>('sourceRef');
      const target = assoc.get<El | undefined>('targetRef');
      const id = assoc.get<string | undefined>('id');
      if (!source || !target || !id) continue;
      if (planes.some((plane) => plane.edges.has(assoc))) continue;
      const index = planes.find((plane) => (plane.shapes.has(source) || plane.edges.has(source)) && (plane.shapes.has(target) || plane.edges.has(target)));
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
      const sourceDock = this.dock(from, this.referenceOf(to));
      const targetDock = this.dock(to, sourceDock);
      const edge = moddle.create('bpmndi:BPMNEdge', {
        id: `BPMNEdge_${id}`,
        bpmnElement: assoc,
        waypoint: [moddle.create('dc:Point', sourceDock), moddle.create('dc:Point', targetDock)],
      });
      addTo(index.plane, 'planeElement', edge);
      index.edges.set(assoc, edge);
      fixed.push(id);
    }
    return fixed;
  }
}
