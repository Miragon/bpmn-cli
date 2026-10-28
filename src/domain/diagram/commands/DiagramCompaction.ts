import { modelError } from '../../document/utils/errors.js';
import type { CompactDiagram } from '../../commands/types.js';
import type { Plane } from '../di/types.js';
import type { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { LayoutProblem } from '../utils/problems.js';
import { problemWords, unique } from '../utils/shape-sets.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { Compactor } from './Compactor.js';

export class DiagramCompaction {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: CompactDiagram,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  /** A diagram's own root (a process without pool, a drill-down) targets the whole diagram. */
  private compactionTargets(ids: readonly string[]): Map<Plane, Set<string> | undefined> {
    const out = new Map<Plane, Set<string> | undefined>();
    for (const id of unique(ids)) {
      this.diagram.doc.require(id);
      if (!this.diagram.planes.length) throw this.diagram.noDiagram();
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
    const { diagram, notes } = this;
    if (!diagram.planes.length) throw diagram.noDiagram();
    const targets = this.command.ids ? this.compactionTargets(this.command.ids) : new Map(diagram.planes.map((plane) => [plane, undefined] as const));
    const rerouted: string[] = [];
    const total = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
    const rejected: LayoutProblem[] = [];
    for (const [plane, only] of targets) {
      const guard = diagram.guard(plane);
      const stats = new Compactor(diagram.drawing(plane)).compact({ ...(only ? { only } : {}), attempt: guard.attempt });
      for (const axis of ['x', 'y'] as const) {
        total.strips[axis] += stats.strips[axis];
        total.px[axis] += stats.px[axis];
      }
      total.refused += stats.refused;
      rejected.push(...guard.rejected);
      rerouted.push(...diagram.drawing(plane).settle(this.snap));
    }
    const closedStrips = total.strips.x + total.strips.y;
    if (!closedStrips) notes.push('nothing to compact: no empty row or column to close');
    else {
      const part = (count: number, px: number, what: string): string[] => (count ? [`${count} empty ${what}${count > 1 ? 's' : ''} (${px} px)`] : []);
      notes.push(`closed ${[...part(total.strips.x, total.px.x, 'column'), ...part(total.strips.y, total.px.y, 'row')].join(' and ')}`);
    }
    if (rejected.length) notes.push(`left ${total.refused} gap${total.refused > 1 ? 's' : ''} open: closing ${total.refused > 1 ? 'them' : 'it'} would add ${problemWords(rejected)}`);
    return rerouted;
  }
}
