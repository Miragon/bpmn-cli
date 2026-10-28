import { modelError, usageError } from '../../document/utils/errors.js';
import type { InsertSpace } from '../../commands/types.js';
import { parseSpaceAmount } from '../../commands/utils/space-amount.js';
import { Compactor, PAD as COMPACT_PAD } from './Compactor.js';
import { bottom, copyBox, median, right, type Box } from '../utils/geom.js';
import { Frames } from '../di/Frames.js';
import { PlaneQuery } from '../di/PlaneQuery.js';
import type { DShape, Plane } from '../di/types.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { problemWords } from '../utils/shape-sets.js';

export class SpaceInsertion {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: InsertSpace,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  private columnWidth(plane: Plane): number {
    const widths = [...plane.shapes.values()].filter((shape) => shape.kind === 'task').map((shape) => shape.bounds.width);
    return Math.round((median(widths) ?? 100) + PlaneQuery.spacingOf(plane).gap);
  }

  /**
   * Negative `space`: closes up to `amount` px of the empty space right of / below an element.
   * For a lane or pool the strip lies within the pool band, so the pool shrinks with a lane;
   * otherwise it starts past what touches the far edge (its label, ...).
   */
  private closeSpace(refId: string, plane: Plane, shape: DShape, axis: 'x' | 'y', amount: number): string[] {
    const compaction = new Compactor(this.diagram.drawing(plane));
    const gaps = compaction.gaps();
    const loose = compaction.looseEdges();
    const pool = shape.kind === 'participant' ? shape : shape.poolId ? plane.shapes.get(shape.poolId) : undefined;
    const far = (box: Box): number => (axis === 'x' ? right(box) : bottom(box));
    const where = axis === 'x' ? `right of ${refId}` : `below ${refId}`;
    let strip: { from: number; to: number; keep: number } | undefined;
    let within: Box | undefined;
    if (shape.container && shape.kind !== 'subProcess') {
      within = copyBox((pool ?? shape).bounds);
      const lanes = [...plane.shapes.values()].filter((lane) => lane.kind === 'lane' && (lane.poolId === shape.id || Frames.chain(plane, lane).includes(shape))).map((lane) => lane.id);
      const occ = compaction.occupied(axis, shape.bounds, { skip: new Set([shape.id, ...(pool ? [pool.id] : []), ...lanes]), loose });
      const last = occ.length ? occ[occ.length - 1]![1] : undefined;
      if (last !== undefined) strip = { from: last, to: far(shape.bounds), keep: COMPACT_PAD };
    } else {
      const unit = shape.container ? shape.bounds : this.diagram.drawing(plane).unitBox(shape);
      within = axis === 'x' && pool ? copyBox(pool.bounds) : undefined;
      const region = axis === 'x' ? { x: far(unit), y: (pool ?? shape).bounds.y, width: 1e6, height: (pool ?? shape).bounds.height } : { x: -1e6, y: far(unit), width: 2e6, height: 1e6 };
      if (axis === 'x' && !pool) Object.assign(region, { y: -1e6, height: 2e6 });
      const skip = new Set([shape.id, ...[...plane.shapes.values()].filter((frame) => frame.kind === 'lane' || frame.kind === 'participant').map((frame) => frame.id)]);
      const occ = compaction.occupied(axis, region, { skip, loose, solid: (other) => other.kind === 'subProcess' && other.container && other.id !== shape.id && !Frames.chain(plane, shape).includes(other) });
      let from = far(unit);
      for (const [start, end] of occ) if (start <= from + 1) from = Math.max(from, end);
      const next = occ.find(([start]) => start > from + 1);
      if (next) strip = { from, to: next[0], keep: axis === 'x' ? gaps.x : gaps.y };
      else if (shape.container) {
        this.notes.push(`nothing to close ${where}: nothing follows it`);
        return [];
      }
    }
    const room = strip ? Math.floor(strip.to - strip.from - strip.keep) : 0;
    if (!strip || room < 1) {
      this.notes.push(`nothing to close ${where}: no empty space there${strip ? ` (the next element is ${Math.round(strip.to - strip.from)} px away, the drawing keeps ${strip.keep} px)` : ''}`);
      return [];
    }
    const close = Math.min(room, Math.round(amount));
    const guard = this.diagram.guard(plane);
    const part = { from: strip.to - strip.keep - close, to: strip.to, keep: strip.keep };
    const kept = guard.attempt(() => compaction.closeEmpty(axis, part, within));
    if (!kept) {
      throw modelError('E_NO_ROOM', `Closing the space ${where} would ${guard.rejected.length ? `add ${problemWords(guard.rejected)}` : 'move something that is in the way'}; nothing was written`, {
        element: refId,
        ...(guard.rejected.length ? { related: [...new Set(guard.rejected.flatMap((problem) => problem.ids))] } : {}),
        hint: 'Close less (`--by -<px>`), or move what is in the way first (`bpmn place`), or use `bpmn compact`, which closes only what it can close without a new problem.',
      });
    }
    this.notes.push(close < amount ? `closed ${close} px ${where} (of ${Math.round(amount)} px asked for): the rest is not empty` : `closed ${close} px ${where}`);
    return this.diagram.drawing(plane).settle(this.snap);
  }

  /**
   * Inserts space right of / below the reference; a frame grows itself, as the line runs just
   * inside its far edge. A few pixels where a column or row was likely meant come with a hint how
   * to ask for one.
   */
  run(): string[] {
    const refId = (this.command.after ?? this.command.below)!;
    const { plane, shape } = this.diagram.drawnShape(refId);
    const axis = this.command.after ? 'x' : 'y';
    const by = parseSpaceAmount(this.command.by ?? (axis === 'x' ? 'column' : 'row'));
    if (!by) throw usageError(`space: --by ${String(this.command.by)} is no amount (column, row, 2col, 3rows, 80px, 80; negative closes space)`);
    const column = this.columnWidth(plane);
    const row = PlaneQuery.spacingOf(plane).row;
    const step = by.unit === 'column' ? column : by.unit === 'row' ? row : 1;
    const delta = Math.abs(by.count) * step;
    const where = axis === 'x' ? `right of ${refId}` : `below ${refId}`;
    if (by.count < 0) return this.closeSpace(refId, plane, shape, axis, delta);
    const steps = by.unit === 'px' ? '' : ` (${by.count} ${by.unit}${by.count > 1 ? 's' : ''} of ${step} px)`;
    const own = axis === 'x' ? column : row;
    const unitHint = by.unit === 'px' && delta < own / 4 ? `; one ${axis === 'x' ? 'column' : 'row'} is ${own} px: --by ${delta}${axis === 'x' ? 'col' : 'row'} moves by ${delta} ${axis === 'x' ? 'columns' : 'rows'}` : '';
    this.notes.push(`inserted ${delta} px${steps} ${where}${unitHint}`);
    const box = shape.container ? shape.bounds : this.diagram.drawing(plane).unitBox(shape);
    const line = shape.container ? (axis === 'x' ? right(box) - 1 : bottom(box) - 1) : axis === 'x' ? right(box) + 1 : bottom(box) + 1;
    const pool = shape.kind === 'participant' ? shape : shape.poolId ? plane.shapes.get(shape.poolId) : undefined;
    this.diagram.drawing(plane).makeSpace({ axis, line, delta, anchors: [shape.id], ...(axis === 'x' && pool ? { within: copyBox(pool.bounds) } : {}) });
    return this.diagram.drawing(plane).settle(this.snap);
  }
}
