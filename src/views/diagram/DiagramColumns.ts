import { Samples } from '../../model/index.js';
import type { Plane } from '../../drawing/index.js';

export interface WideGap {
  after: number;
  width: number;
}

export type PlaneShape = ReturnType<Plane['leaves']>[number];

export class DiagramColumns {
  readonly nodes: PlaneShape[];
  readonly of = new Map<string, number>();
  readonly gaps: WideGap[] = [];
  readonly wide: number;
  readonly count: number;

  constructor(plane: Plane) {
    this.nodes = [...plane.shapes.values()].filter((shape) => shape.el.is('bpmn:FlowNode') && shape.kind !== 'boundary');
    const { gap } = plane.spacing();
    const tolerance = Math.min(40, Math.max(10, gap / 2));
    const widths = this.nodes.filter(({ kind }) => kind === 'task').map(({ bounds }) => bounds.width);
    this.wide = (new Samples(widths).median() ?? 100) + 2 * gap;
    const columns = DiagramColumns.clustered(this.nodes, 'x', tolerance);
    columns.forEach((column, index) => column.forEach(({ id }) => this.of.set(id, index)));
    this.count = columns.length;
    for (const [index, column] of columns.entries()) {
      const next = columns[index + 1];
      const free = next ? Math.min(...next.map(({ bounds }) => bounds.x)) - Math.max(...column.map(({ bounds }) => bounds.right)) : 0;
      if (free > this.wide) {
        this.gaps.push({ after: index, width: Math.round(free) });
      }
    }
  }

  static clustered(shapes: readonly PlaneShape[], axis: 'x' | 'y', tolerance: number): PlaneShape[][] {
    const other = axis === 'x' ? 'y' : 'x';
    const sorted = [...shapes].sort((first, second) => first.bounds.center[axis] - second.bounds.center[axis] || first.bounds.center[other] - second.bounds.center[other]);
    const clusters: PlaneShape[][] = [];
    for (const shape of sorted) {
      const cluster = clusters.at(-1);
      if (cluster && shape.bounds.center[axis] - cluster[0]!.bounds.center[axis] <= tolerance) {
        cluster.push(shape);
      } else {
        clusters.push([shape]);
      }
    }
    return clusters;
  }
}
