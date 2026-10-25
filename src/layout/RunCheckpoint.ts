import type { Checkpoint, IncrementalLayout } from './IncrementalLayout.js';
import { copyBox, copyPoints } from '../diagram/utils/geom.js';
import type { DEdge, DShape } from '../diagram/types.js';

/** Everything drawing the new elements (steps 6 to 9) changes in a run, taken and put back. */
export class RunCheckpoint {
  constructor(private readonly run: IncrementalLayout) {}

  take(): Checkpoint {
    const run = this.run;
    const cp: Checkpoint = {
      planes: [...run.planes],
      members: new Map(),
      shapes: new Map(),
      edges: new Map(),
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
    const keepShape = (s: DShape): void => {
      if (!cp.shapes.has(s)) cp.shapes.set(s, { bounds: copyBox(s.bounds), ...(s.label ? { label: copyBox(s.label) } : {}) });
    };
    const keepEdge = (e: DEdge): void => {
      if (!cp.edges.has(e)) cp.edges.set(e, { points: copyPoints(e.points), ...(e.label ? { label: copyBox(e.label) } : {}), ...(e.sourceId ? { sourceId: e.sourceId } : {}), ...(e.targetId ? { targetId: e.targetId } : {}) });
    };
    for (const plane of run.planes) {
      cp.members.set(plane, { shapes: [...plane.shapes.values()], edges: [...plane.edges.values()] });
      plane.shapes.forEach(keepShape);
      plane.edges.forEach(keepEdge);
    }
    // shapes waiting to be placed again (DI reused): their boundary events and content move along
    for (const r of run.place.reuse.values()) {
      [r.shape, ...r.boundaries, ...(r.content?.shapes ?? [])].forEach(keepShape);
      (r.content?.edges ?? []).forEach(keepEdge);
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
    for (const [s, g] of cp.shapes) {
      s.bounds = copyBox(g.bounds);
      if (g.label) s.label = copyBox(g.label);
      else delete s.label;
    }
    for (const [e, g] of cp.edges) {
      e.points = copyPoints(g.points);
      if (g.label) e.label = copyBox(g.label);
      else delete e.label;
      if (g.sourceId) e.sourceId = g.sourceId;
      else delete e.sourceId;
      if (g.targetId) e.targetId = g.targetId;
      else delete e.targetId;
    }
    run.place.restore(cp.placer);
    const s = cp.sets;
    Object.assign(run, { reroute: new Set(s.reroute), newEdges: new Set(s.newEdges), fromEngine: new Set(s.fromEngine), active: new Set(s.active), relocated: new Set(s.relocated), grown: new Set(s.grown), routedNow: new Map(s.routedNow) });
    run.notes.splice(0, run.notes.length, ...cp.notes);
  }
}
