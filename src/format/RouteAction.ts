import { modelError } from '../shared/utils/errors.js';
import type { RouteOp } from '../ops/types.js';
import { copyPoints, samePoints } from '../diagram/utils/geom.js';
import type { Plane, Side } from '../diagram/types.js';
import { attachedSide } from '../diagram/utils/sides.js';
import type { FormatOps } from './FormatOps.js';

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export class RouteAction {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: RouteOp,
  ) {}

  /** A side forced on a boundary event that points into its host would run through the host. */
  private intoHost(plane: Plane, endId: string | undefined, side: Side | undefined, role: 'exit' | 'entry', flowId: string): void {
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
    const { plane, edge } = this.ops.drawnEdge(this.op.id, true);
    this.intoHost(plane, edge.sourceId, this.op.exit, 'exit', this.op.id);
    this.intoHost(plane, edge.targetId, this.op.entry, 'entry', this.op.id);
    const before = copyPoints(edge.points);
    const ok = this.ops.drawing(plane).reroute(edge, { ...(this.op.exit ? { sourceSides: [this.op.exit] } : {}), ...(this.op.entry ? { targetSides: [this.op.entry] } : {}) });
    if (!ok) {
      if (!edge.di) plane.edges.delete(this.op.id);
      throw modelError('E_NO_SHAPE', `${this.op.id} cannot be routed: an end has no shape in its diagram`, { element: this.op.id, hint: 'Run `bpmn layout <file>` to draw the missing shapes.' });
    }
    this.ops.drawing(plane).clearLabels([edge]);
    return samePoints(before, edge.points) ? [] : [this.op.id];
  }
}
