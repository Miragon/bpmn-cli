import { is } from '../model/utils/moddle.js';
import { cx, cy, median, right } from '../diagram/utils/geom.js';
import { spacingOf } from '../diagram/utils/plane.js';
import type { DShape, Plane } from '../diagram/types.js';
import type { LayoutGap, PlaneColumn } from './layout-view.js';

/** The columns of a diagram's flow nodes (see the contract of layout-view.ts). */
export class DiagramColumns {
  readonly nodes: DShape[];
  /** node id -> column index */
  readonly of = new Map<string, number>();
  readonly count: number;
  readonly gaps: LayoutGap[] = [];
  /** free width above which a gap counts as wide */
  readonly wide: number;

  constructor(plane: Plane) {
    this.nodes = [...plane.shapes.values()].filter((s) => is(s.el, 'bpmn:FlowNode') && s.kind !== 'boundary');
    const sp = spacingOf(plane);
    const tol = Math.min(40, Math.max(10, sp.gap / 2));
    const tasks = this.nodes.filter((s) => s.kind === 'task').map((s) => s.bounds.width);
    this.wide = (median(tasks) ?? 100) + 2 * sp.gap;
    const sorted = [...this.nodes].sort((a, b) => cx(a.bounds) - cx(b.bounds) || cy(a.bounds) - cy(b.bounds));
    const cols: DShape[][] = [];
    for (const s of sorted) {
      const col = cols[cols.length - 1];
      if (col && cx(s.bounds) - cx(col[0]!.bounds) <= tol) col.push(s);
      else cols.push([s]);
    }
    cols.forEach((col, i) => col.forEach((s) => this.of.set(s.id, i)));
    for (let i = 0; i + 1 < cols.length; i++) {
      const free = Math.min(...cols[i + 1]!.map((s) => s.bounds.x)) - Math.max(...cols[i]!.map((s) => right(s.bounds)));
      if (free > this.wide) this.gaps.push({ after: i, width: Math.round(free) });
    }
    this.count = cols.length;
  }

  /** The columns left to right, as layoutView numbers them (`bpmn render --tiles` cuts between them). */
  spans(): PlaneColumn[] {
    const out: PlaneColumn[] = Array.from({ length: this.count }, (_, index) => ({ index, ids: [], x0: Infinity, x1: -Infinity }));
    for (const s of this.nodes) {
      const c = out[this.of.get(s.id)!]!;
      c.ids.push(s.id);
      c.x0 = Math.min(c.x0, s.bounds.x);
      c.x1 = Math.max(c.x1, right(s.bounds));
    }
    return out;
  }
}
