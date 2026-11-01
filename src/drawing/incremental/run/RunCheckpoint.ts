import { DrawingCheckpoint } from '../../plane/DrawingCheckpoint.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import type { PlacerMemo } from '../placement/PlacementState.js';
import type { LayoutRun, RunSets } from './LayoutRun.js';

export interface Checkpoint {
  planes: Plane[];
  members: Map<Plane, { shapes: DShape[]; edges: DEdge[] }>;
  drawing: DrawingCheckpoint;
  placer: PlacerMemo;
  sets: RunSets;
  notes: string[];
}

export class RunCheckpoint {
  constructor(private readonly run: LayoutRun) {}

  take(): Checkpoint {
    const { run } = this;
    const checkpoint: Checkpoint = { planes: [...run.planes], members: new Map(), drawing: new DrawingCheckpoint(), placer: run.place.checkpoint(), sets: run.sets(), notes: [...run.notes] };
    for (const plane of run.planes) {
      checkpoint.members.set(plane, { shapes: [...plane.shapes.values()], edges: [...plane.edges.values()] });
      checkpoint.drawing.keepPlane(plane);
    }
    for (const { shape, boundaries, content } of run.place.reuse.values()) {
      [shape, ...boundaries, ...(content?.shapes ?? [])].forEach((kept) => checkpoint.drawing.keepShape(kept));
      (content?.edges ?? []).forEach((edge) => checkpoint.drawing.keepEdge(edge));
    }
    return checkpoint;
  }

  restore(checkpoint: Checkpoint): void {
    const { run } = this;
    run.planes.splice(0, run.planes.length, ...checkpoint.planes);
    for (const [plane, { shapes, edges }] of checkpoint.members) {
      plane.shapes.clear();
      plane.edges.clear();
      shapes.forEach((shape) => plane.shapes.set(shape.id, shape));
      edges.forEach((edge) => plane.edges.set(edge.id, edge));
    }
    checkpoint.drawing.restore();
    run.place.restore(checkpoint.placer);
    run.restoreSets(checkpoint.sets);
    run.notes.splice(0, run.notes.length, ...checkpoint.notes);
  }
}
