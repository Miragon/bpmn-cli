import type { Checkpoint, IncrementalLayout } from './IncrementalLayout.js';
import { DrawingCheckpoint } from '../../drawing/DrawingCheckpoint.js';

/** Everything drawing the new elements (steps 6 to 9) changes in a run, taken and put back. */
export class RunCheckpoint {
  constructor(private readonly run: IncrementalLayout) {}

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
    // shapes waiting to be placed again (DI reused): their boundary events and content move along
    for (const r of run.place.reuse.values()) {
      [r.shape, ...r.boundaries, ...(r.content?.shapes ?? [])].forEach((s) => cp.drawing.keepShape(s));
      (r.content?.edges ?? []).forEach((e) => cp.drawing.keepEdge(e));
    }
    return cp;
  }

  restore(cp: Checkpoint): void {
    const run = this.run;
    run.planes.length = 0;
    run.planes.push(...cp.planes);
    for (const [plane, m] of cp.members) {
      plane.shapes = new Map(m.shapes.map((s) => [s.id, s]));
      plane.edges = new Map(m.edges.map((e) => [e.id, e]));
    }
    cp.drawing.restore();
    run.place.restore(cp.placer);
    const s = cp.sets;
    Object.assign(run, { reroute: new Set(s.reroute), newEdges: new Set(s.newEdges), fromEngine: new Set(s.fromEngine), active: new Set(s.active), relocated: new Set(s.relocated), grown: new Set(s.grown), routedNow: new Map(s.routedNow) });
    run.notes.splice(0, run.notes.length, ...cp.notes);
  }
}
