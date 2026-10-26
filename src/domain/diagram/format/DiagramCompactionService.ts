import { modelError } from '../../document/utils/errors.js';
import type { CompactDiagram } from '../../commands/types.js';
import { CompactionService } from './CompactionService.js';
import type { LayoutProblem } from '../utils/problems.js';
import type { Plane } from '../di/types.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { problemWords, unique } from '../utils/frames.js';

export class DiagramCompactionService {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly op: CompactDiagram,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  private compactTargets(ids: readonly string[]): Map<Plane, Set<string> | undefined> {
    const out = new Map<Plane, Set<string> | undefined>();
    for (const id of unique(ids)) {
      this.diagram.doc.require(id);
      if (!this.diagram.planes.length) throw this.diagram.noDiagram();
      // a diagram's own root (a process without pool, a drill-down): the whole diagram
      const root = this.diagram.planes.find((plane) => plane.rootId === id);
      if (root && !root.shapes.has(id)) {
        out.set(root, undefined);
        continue;
      }
      const { plane, shape } = this.diagram.drawnShape(id);
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
    if (!this.diagram.planes.length) throw this.diagram.noDiagram();
    const targets = this.op.ids ? this.compactTargets(this.op.ids) : new Map(this.diagram.planes.map((plane) => [plane, undefined] as const));
    const rerouted: string[] = [];
    const total = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
    const rejected: LayoutProblem[] = [];
    for (const [plane, only] of targets) {
      const guard = this.diagram.guard(plane);
      const stats = new CompactionService(this.diagram.drawing(plane)).compact({ ...(only ? { only } : {}), attempt: guard.attempt });
      for (const axis of ['x', 'y'] as const) {
        total.strips[axis] += stats.strips[axis];
        total.px[axis] += stats.px[axis];
      }
      total.refused += stats.refused;
      rejected.push(...guard.rejected);
      rerouted.push(...this.diagram.drawing(plane).settle(this.snap));
    }
    const closedStrips = total.strips.x + total.strips.y;
    if (!closedStrips) this.notes.push('nothing to compact: no empty row or column to close');
    else {
      const part = (count: number, px: number, what: string): string[] => (count ? [`${count} empty ${what}${count > 1 ? 's' : ''} (${px} px)`] : []);
      this.notes.push(`closed ${[...part(total.strips.x, total.px.x, 'column'), ...part(total.strips.y, total.px.y, 'row')].join(' and ')}`);
    }
    if (rejected.length) this.notes.push(`left ${total.refused} gap${total.refused > 1 ? 's' : ''} open: closing ${total.refused > 1 ? 'them' : 'it'} would add ${problemWords(rejected)}`);
    return rerouted;
  }
}
