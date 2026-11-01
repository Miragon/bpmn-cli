import { BpmnError, Polyline } from '../../model/index.js';
import type { RouteOperation } from '../../operations/index.js';
import type { Plane } from '../plane/Plane.js';
import { ShapeSides, type Side } from '../plane/ShapeSides.js';
import type { DrawnDiagram } from './DrawnDiagram.js';

export class FlowRerouting {
  private static readonly OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: RouteOperation,
  ) {}

  run(): string[] {
    const { id, exit, entry } = this.operation;
    const { plane, edge } = this.diagram.drawnEdge(id, true);
    this.refuseIntoHost(plane, edge.sourceId, exit, 'exit');
    this.refuseIntoHost(plane, edge.targetId, entry, 'entry');
    const before = new Polyline(new Polyline(edge.points).copy());
    const drawing = this.diagram.drawing(plane);
    if (!drawing.reroute(edge, { ...(exit ? { sourceSides: [exit] } : {}), ...(entry ? { targetSides: [entry] } : {}) })) {
      if (!edge.di) {
        plane.edges.delete(id);
      }
      throw BpmnError.model('E_NO_SHAPE', `${id} cannot be routed: an end has no shape in its diagram`, { element: id, hint: 'Run `bpmn layout <file>` to draw the missing shapes.' });
    }
    drawing.clearLabels([edge]);
    return before.same(new Polyline(edge.points)) ? [] : [id];
  }

  private refuseIntoHost(plane: Plane, endId: string | undefined, side: Side | undefined, role: 'exit' | 'entry'): void {
    const end = endId ? plane.shapes.get(endId) : undefined;
    const host = end?.hostId ? plane.shapes.get(end.hostId) : undefined;
    if (!end || !host || !side) {
      return;
    }
    const border = ShapeSides.attached(end.bounds, host.bounds);
    if (side !== FlowRerouting.OPPOSITE[border]) {
      return;
    }
    const { id } = this.operation;
    throw BpmnError.model('E_INVALID_VALUE', `--${role} ${side} would run ${id} through ${host.id}: ${end.id} sits on the ${border} border of its host`, {
      element: id,
      related: [end.id, host.id],
      hint: `A boundary event's flow leaves away from its host: use --${role} ${border}${border === 'bottom' || border === 'top' ? ', left or right' : ', top or bottom'}.`,
    });
  }
}
