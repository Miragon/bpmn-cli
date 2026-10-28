import { modelError } from '../../document/utils/errors.js';
import type { RerouteFlow } from '../../commands/types.js';
import type { Plane, Side } from '../di/types.js';
import { copyPoints, samePoints } from '../utils/geom.js';
import { attachedSide } from '../utils/sides.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export class FlowRerouting {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: RerouteFlow,
  ) {}

  /** A side forced on a boundary event that points into its host would run through the host. */
  private refuseIntoHost(plane: Plane, endId: string | undefined, side: Side | undefined, role: 'exit' | 'entry', flowId: string): void {
    const end = endId ? plane.shapes.get(endId) : undefined;
    const host = end?.hostId ? plane.shapes.get(end.hostId) : undefined;
    if (!end || !host || !side) return;
    const border = attachedSide(end.bounds, host.bounds);
    if (side !== OPPOSITE[border]) return;
    throw modelError('E_INVALID_VALUE', `--${role} ${side} would run ${flowId} through ${host.id}: ${end.id} sits on the ${border} border of its host`, {
      element: flowId,
      related: [end.id, host.id],
      hint: `A boundary event's flow leaves away from its host: use --${role} ${border}${border === 'bottom' || border === 'top' ? ', left or right' : ', top or bottom'}.`,
    });
  }

  run(): string[] {
    const command = this.command;
    const { plane, edge } = this.diagram.drawnEdge(command.id, true);
    this.refuseIntoHost(plane, edge.sourceId, command.exit, 'exit', command.id);
    this.refuseIntoHost(plane, edge.targetId, command.entry, 'entry', command.id);
    const before = copyPoints(edge.points);
    const ok = this.diagram.drawing(plane).reroute(edge, { ...(command.exit ? { sourceSides: [command.exit] } : {}), ...(command.entry ? { targetSides: [command.entry] } : {}) });
    if (!ok) {
      if (!edge.di) plane.edges.delete(command.id);
      throw modelError('E_NO_SHAPE', `${command.id} cannot be routed: an end has no shape in its diagram`, { element: command.id, hint: 'Run `bpmn layout <file>` to draw the missing shapes.' });
    }
    this.diagram.drawing(plane).clearLabels([edge]);
    return samePoints(before, edge.points) ? [] : [command.id];
  }
}
