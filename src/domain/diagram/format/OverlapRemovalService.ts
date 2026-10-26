import type { TidyShapes } from '../../commands/types.js';
import type { Plane } from '../di/types.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { unique } from '../utils/frames.js';

export class OverlapRemovalService {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly op: TidyShapes,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  run(): string[] {
    if (!this.diagram.planes.length) throw this.diagram.noDiagram();
    const byPlane = new Map<Plane, string[]>();
    if (this.op.ids) {
      for (const id of unique(this.op.ids)) {
        const { plane } = this.diagram.drawnShape(id);
        byPlane.set(plane, [...(byPlane.get(plane) ?? []), id]);
      }
    } else for (const plane of this.diagram.planes) byPlane.set(plane, []);
    const rerouted: string[] = [];
    for (const [plane, ids] of byPlane) {
      const tidied = this.diagram.drawing(plane).tidy(ids.length ? { ids } : {});
      if (tidied.unresolved.length) this.notes.push(`overlap left: ${tidied.unresolved.map(([first, second]) => `${first}~${second}`).join(', ')}`);
      rerouted.push(...this.diagram.drawing(plane).settle(this.snap));
    }
    return rerouted;
  }
}
