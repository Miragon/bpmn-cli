import { is } from '../document/utils/moddle.js';
import { cx, cy, median, right } from '../diagram/utils/geom.js';
import { PlaneQuery } from '../diagram/di/PlaneQuery.js';
import type { DShape, Plane } from '../diagram/di/types.js';
import type { LayoutGap, PlaneColumn } from './layout-view.js';

/**
 * The columns of a diagram's flow nodes, clustered by centre x; `bpmn render --tiles` cuts
 * between them.
 */
export class DiagramColumns {
  readonly nodes: DShape[];
  readonly of = new Map<string, number>();
  readonly count: number;
  readonly gaps: LayoutGap[] = [];
  /** free width above which a gap counts as wide */
  readonly wide: number;

  constructor(plane: Plane) {
    this.nodes = [...plane.shapes.values()].filter((shape) => is(shape.el, 'bpmn:FlowNode') && shape.kind !== 'boundary');
    const sp = PlaneQuery.spacingOf(plane);
    const tol = Math.min(40, Math.max(10, sp.gap / 2));
    const tasks = this.nodes.filter((shape) => shape.kind === 'task').map((shape) => shape.bounds.width);
    this.wide = (median(tasks) ?? 100) + 2 * sp.gap;
    const sorted = [...this.nodes].sort((first, second) => cx(first.bounds) - cx(second.bounds) || cy(first.bounds) - cy(second.bounds));
    const cols: DShape[][] = [];
    for (const shape of sorted) {
      const col = cols[cols.length - 1];
      if (col && cx(shape.bounds) - cx(col[0]!.bounds) <= tol) {
        col.push(shape);
      } else {
        cols.push([shape]);
      }
    }
    cols.forEach((col, columnIndex) => col.forEach((shape) => this.of.set(shape.id, columnIndex)));
    for (let columnIndex = 0; columnIndex + 1 < cols.length; columnIndex++) {
      const free = Math.min(...cols[columnIndex + 1]!.map((shape) => shape.bounds.x)) - Math.max(...cols[columnIndex]!.map((shape) => right(shape.bounds)));
      if (free > this.wide) {
        this.gaps.push({ after: columnIndex, width: Math.round(free) });
      }
    }
    this.count = cols.length;
  }

  spans(): PlaneColumn[] {
    const out: PlaneColumn[] = Array.from({ length: this.count }, (_slot, index) => ({ index, ids: [], x0: Infinity, x1: -Infinity }));
    for (const shape of this.nodes) {
      const column = out[this.of.get(shape.id)!]!;
      column.ids.push(shape.id);
      column.x0 = Math.min(column.x0, shape.bounds.x);
      column.x1 = Math.max(column.x1, right(shape.bounds));
    }
    return out;
  }
}
