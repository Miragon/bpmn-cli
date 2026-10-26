import type { Checkpoint, IncrementalLayout } from './IncrementalLayout.js';
import { DrawingCheckpoint } from '../../di/DrawingCheckpoint.js';

/** Everything drawing the new elements (steps 6 to 9) changes in a run, taken and put back. */
export class RunCheckpoint {
  constructor(private readonly run: IncrementalLayout) {}

  /** Shapes waiting to be placed again (DI reused) are kept with their boundary events and content. */
  take(): Checkpoint {
    const run = this.run;
    const cp: Checkpoint = {
      planes: [...run.planes],
      members: new Map(),
      drawing: new DrawingCheckpoint(),
      placer: run.place.checkpoint(),
      sets: {
        reroute: new Set(run.reroute),
        newEdges: new Set(run.newEdges),
        fromEngine: new Set(run.fromEngine),
        active: new Set(run.active),
        relocated: new Set(run.relocated),
        grown: new Set(run.grown),
        routedNow: new Map(run.routedNow),
      },
      notes: [...run.notes],
    };
    for (const plane of run.planes) {
      cp.members.set(plane, { shapes: [...plane.shapes.values()], edges: [...plane.edges.values()] });
      cp.drawing.keepPlane(plane);
    }
    for (const reused of run.place.reuse.values()) {
      [reused.shape, ...reused.boundaries, ...(reused.content?.shapes ?? [])].forEach((shape) => cp.drawing.keepShape(shape));
      (reused.content?.edges ?? []).forEach((edge) => cp.drawing.keepEdge(edge));
    }
    return cp;
  }

  restore(cp: Checkpoint): void {
    const run = this.run;
    run.planes.length = 0;
    run.planes.push(...cp.planes);
    for (const [plane, members] of cp.members) {
      plane.shapes = new Map(members.shapes.map((shape) => [shape.id, shape]));
      plane.edges = new Map(members.edges.map((edge) => [edge.id, edge]));
    }
    cp.drawing.restore();
    run.place.restore(cp.placer);
    const sets = cp.sets;
    Object.assign(run, { reroute: new Set(sets.reroute), newEdges: new Set(sets.newEdges), fromEngine: new Set(sets.fromEngine), active: new Set(sets.active), relocated: new Set(sets.relocated), grown: new Set(sets.grown), routedNow: new Map(sets.routedNow) });
    run.notes.splice(0, run.notes.length, ...cp.notes);
  }
}
