import { Box, BpmnError, ModelError, Polyline, type BpmnElement } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { LayoutRun } from '../run/LayoutRun.js';
import type { EdgeBefore } from '../routing/EdgeRouter.js';

export interface IncrementalReport {
  placed: string[];
  moved: string[];
  rerouted: string[];
  reshaped: string[];
  pruned: string[];
  notes: string[];
}

export class RunReport {
  private static readonly VERTICAL_HINT = 'End the batch with a `layout` operation: it redraws the whole diagram and turns the lanes horizontal.';

  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
  ) {}

  assertHorizontal(rerouted: readonly string[]): void {
    const { place, newEdges, planes } = this.run;
    const changed = new Set([...place.placed, ...place.moved, ...rerouted, ...newEdges]);
    for (const plane of planes) {
      const vertical = plane.verticalBand();
      const touched = vertical ? [...changed].filter((id) => plane.shapes.has(id) || plane.edges.has(id)) : [];
      if (vertical && touched.length) {
        const message = `${vertical.kind === 'lane' ? 'lane' : 'pool'} ${vertical.id} is drawn vertically (isHorizontal=false); the incremental layout only edits horizontal pools and lanes (it would have changed ${touched.slice(0, 3).join(', ')})`;
        throw BpmnError.from(new ModelError(message, 'LAYOUT_INCREMENTAL', { hint: RunReport.VERTICAL_HINT }));
      }
    }
  }

  of(prunedNow: readonly string[], rerouted: string[], edgesBefore: ReadonlyMap<DEdge, EdgeBefore>): IncrementalReport {
    const { place, newEdges, relocated, notes } = this.run;
    const pruned = this.prunedSince(prunedNow);
    const routed = new Set([...rerouted, ...newEdges]);
    const reshaped = [...edgesBefore].filter(([edge, { points }]) => !routed.has(edge.id) && !pruned.has(edge.id) && !new Polyline(points).same(new Polyline(edge.points))).map(([edge]) => edge.id);
    return {
      placed: [...new Set([...place.placed, ...newEdges])].filter((id) => !relocated.has(id)),
      moved: this.movedShapes(),
      rerouted,
      reshaped: [...new Set(reshaped)],
      pruned: [...pruned],
      notes,
    };
  }

  private prunedSince(prunedNow: readonly string[]): Set<string> {
    const live = new Set<BpmnElement>(this.run.planes.flatMap((plane) => [...plane.shapes.values(), ...plane.edges.values()].flatMap((element) => element.di ?? [])));
    const pruned = new Set(prunedNow);
    for (const [di, entry] of this.before.byDi) {
      if (!live.has(di) && !this.run.semantics.byId.has(entry.id)) {
        pruned.add(entry.id);
      }
    }
    return pruned;
  }

  private movedShapes(): string[] {
    const { place, relocated, planes } = this.run;
    const moved = planes.flatMap((plane) => [...plane.shapes.values()].filter((shape) => {
      const old = shape.di && (!place.placed.has(shape.id) || relocated.has(shape.id)) ? this.before.byDi.get(shape.di) : undefined;
      return !!old?.bounds && !Box.same(old.bounds, shape.bounds);
    })).map((shape) => shape.id);
    return [...new Set([...moved, ...relocated])];
  }
}
