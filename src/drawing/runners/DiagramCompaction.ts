import { BpmnError } from '../../model/index.js';
import type { CompactOperation } from '../../operations/index.js';
import type { LayoutProblem } from '../../scoring/index.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import type { Plane } from '../plane/Plane.js';
import { Compactor } from './compaction/Compactor.js';
import { DrawnDiagram } from './DrawnDiagram.js';

type Targets = Map<Plane, Set<string> | undefined>;

interface Total {
  columns: number;
  rows: number;
  columnPx: number;
  rowPx: number;
  refused: number;
  rejected: LayoutProblem[];
}

export class DiagramCompaction {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: CompactOperation,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  private static closedWords(count: number, px: number, what: string): string[] {
    return count ? [`${count} empty ${what}${count > 1 ? 's' : ''} (${px} px)`] : [];
  }

  run(): string[] {
    const { diagram, operation } = this;
    if (!diagram.planes.length) {
      throw diagram.noDiagram();
    }
    const targets: Targets = operation.ids ? this.targetsOf(operation.ids) : new Map(diagram.planes.map((plane) => [plane, undefined]));
    const total: Total = { columns: 0, rows: 0, columnPx: 0, rowPx: 0, refused: 0, rejected: [] };
    const rerouted: string[] = [];
    for (const [plane, only] of targets) {
      this.compactPlane(plane, only, total);
      rerouted.push(...diagram.drawing(plane).settle(this.before));
    }
    this.report(total);
    return rerouted;
  }

  private targetsOf(ids: readonly string[]): Targets {
    const targets: Targets = new Map();
    for (const id of new Set(ids)) {
      this.addTarget(targets, id);
    }
    return targets;
  }

  private addTarget(targets: Targets, id: string): void {
    const { diagram } = this;
    diagram.document.tree.require(id);
    const root = diagram.planes.find((plane) => plane.rootId === id);
    if (root && !root.shapes.has(id)) {
      targets.set(root, undefined);
      return;
    }
    const { plane, shape } = diagram.drawnShape(id);
    if (!shape.container) {
      throw BpmnError.model('E_WRONG_KIND', `"${id}" is not a pool, lane or expanded sub-process`, {
        element: id,
        hint: 'compact takes frames: participant ids, lane ids, expanded sub-process ids (or no id for the whole drawing); to close one gap use `bpmn space <file> --after <id> --by -column`.',
      });
    }
    if (!targets.has(plane) || targets.get(plane)) {
      targets.set(plane, new Set([...(targets.get(plane) ?? []), id]));
    }
  }

  private compactPlane(plane: Plane, only: Set<string> | undefined, total: Total): void {
    const guard = this.diagram.guard(plane);
    const { strips, px, refused } = new Compactor(this.diagram.drawing(plane), { only, attempt: guard.attempt }).compact();
    total.columns += strips.x;
    total.rows += strips.y;
    total.columnPx += px.x;
    total.rowPx += px.y;
    total.refused += refused;
    total.rejected.push(...guard.rejected);
  }

  private report({ columns, rows, columnPx, rowPx, refused, rejected }: Total): void {
    if (columns + rows) {
      this.notes.push(`closed ${[...DiagramCompaction.closedWords(columns, columnPx, 'column'), ...DiagramCompaction.closedWords(rows, rowPx, 'row')].join(' and ')}`);
    } else {
      this.notes.push('nothing to compact: no empty row or column to close');
    }
    if (rejected.length) {
      this.notes.push(`left ${refused} gap${refused > 1 ? 's' : ''} open: closing ${refused > 1 ? 'them' : 'it'} would add ${DrawnDiagram.problemWords(rejected)}`);
    }
  }
}
