import type { TidyOperation } from '../../operations/index.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import type { Plane } from '../plane/Plane.js';
import type { DrawnDiagram } from './DrawnDiagram.js';

export class OverlapTidying {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: TidyOperation,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  run(): string[] {
    if (!this.diagram.planes.length) {
      throw this.diagram.noDiagram();
    }
    const rerouted: string[] = [];
    for (const [plane, ids] of this.idsByPlane()) {
      const drawing = this.diagram.drawing(plane);
      const { unresolved } = drawing.separation.tidy(ids.length ? { ids } : {});
      if (unresolved.length) {
        this.notes.push(`overlap left: ${unresolved.map(([first, second]) => `${first}~${second}`).join(', ')}`);
      }
      rerouted.push(...drawing.settle(this.before));
    }
    return rerouted;
  }

  private idsByPlane(): Map<Plane, string[]> {
    const { ids } = this.operation;
    if (!ids) {
      return new Map(this.diagram.planes.map((plane) => [plane, []]));
    }
    const byPlane = new Map<Plane, string[]>();
    for (const id of new Set(ids)) {
      const { plane } = this.diagram.drawnShape(id);
      byPlane.set(plane, [...(byPlane.get(plane) ?? []), id]);
    }
    return byPlane;
  }
}
