import { modelError } from '../shared/utils/errors.js';
import type { CompactOp } from '../ops/types.js';
import { Compaction } from './Compaction.js';
import type { LayoutProblem } from '../diagram/utils/problems.js';
import type { Plane } from '../diagram/types.js';
import { DrawingSnapshot } from '../diagram/DrawingSnapshot.js';
import type { FormatOps } from './FormatOps.js';
import { problemWords, unique } from './utils/frames.js';

export class CompactAction {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: CompactOp,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  private compactTargets(ids: readonly string[]): Map<Plane, Set<string> | undefined> {
    const out = new Map<Plane, Set<string> | undefined>();
    for (const id of unique(ids)) {
      this.ops.doc.require(id);
      if (!this.ops.planes.length) throw this.ops.noDiagram();
      // a diagram's own root (a process without pool, a drill-down): the whole diagram
      const root = this.ops.planes.find((p) => p.rootId === id);
      if (root && !root.shapes.has(id)) {
        out.set(root, undefined);
        continue;
      }
      const { plane, shape } = this.ops.drawnShape(id);
      if (!shape.container) {
        throw modelError('E_WRONG_KIND', `"${id}" is not a pool, lane or expanded sub-process`, {
          element: id,
          hint: 'compact takes frames: participant ids, lane ids, expanded sub-process ids (or no id for the whole drawing); to close one gap use `bpmn space <file> --after <id> --by -column`.',
        });
      }
      if (out.has(plane) && out.get(plane) === undefined) continue;
      out.set(plane, new Set([...(out.get(plane) ?? []), id]));
    }
    return out;
  }

  run(): string[] {
    if (!this.ops.planes.length) throw this.ops.noDiagram();
    const targets = this.op.ids ? this.compactTargets(this.op.ids) : new Map(this.ops.planes.map((p) => [p, undefined] as const));
    const rerouted: string[] = [];
    const total = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
    const rejected: LayoutProblem[] = [];
    for (const [plane, only] of targets) {
      const g = this.ops.guard(plane);
      const st = new Compaction(this.ops.drawing(plane)).compact({ ...(only ? { only } : {}), attempt: g.attempt });
      for (const axis of ['x', 'y'] as const) {
        total.strips[axis] += st.strips[axis];
        total.px[axis] += st.px[axis];
      }
      total.refused += st.refused;
      rejected.push(...g.rejected);
      rerouted.push(...this.ops.drawing(plane).settle(this.snap));
    }
    const n = total.strips.x + total.strips.y;
    if (!n) this.notes.push('nothing to compact: no empty row or column to close');
    else {
      const part = (k: number, px: number, what: string): string[] => (k ? [`${k} empty ${what}${k > 1 ? 's' : ''} (${px} px)`] : []);
      this.notes.push(`closed ${[...part(total.strips.x, total.px.x, 'column'), ...part(total.strips.y, total.px.y, 'row')].join(' and ')}`);
    }
    if (rejected.length) this.notes.push(`left ${total.refused} gap${total.refused > 1 ? 's' : ''} open: closing ${total.refused > 1 ? 'them' : 'it'} would add ${problemWords(rejected)}`);
    return rerouted;
  }
}
