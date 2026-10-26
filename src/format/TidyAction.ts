import type { TidyOp } from '../ops/types.js';
import type { Plane } from '../drawing/types.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { FormatOps } from './FormatOps.js';
import { unique } from './utils/frames.js';

export class TidyAction {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: TidyOp,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  run(): string[] {
    if (!this.ops.planes.length) throw this.ops.noDiagram();
    const byPlane = new Map<Plane, string[]>();
    if (this.op.ids) {
      for (const id of unique(this.op.ids)) {
        const { plane } = this.ops.drawnShape(id);
        byPlane.set(plane, [...(byPlane.get(plane) ?? []), id]);
      }
    } else for (const plane of this.ops.planes) byPlane.set(plane, []);
    const rerouted: string[] = [];
    for (const [plane, ids] of byPlane) {
      const tidied = this.ops.drawing(plane).tidy(ids.length ? { ids } : {});
      if (tidied.unresolved.length) this.notes.push(`overlap left: ${tidied.unresolved.map(([first, second]) => `${first}~${second}`).join(', ')}`);
      rerouted.push(...this.ops.drawing(plane).settle(this.snap));
    }
    return rerouted;
  }
}
