import { BpmnError, Box, Samples } from '../../model/index.js';
import { SpaceAmount, type SpaceOperation } from '../../operations/index.js';
import type { Drawing } from '../incremental/Drawing.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import { BoxAxis, type Axis } from '../plane/BoxAxis.js';
import type { DShape } from '../plane/DShape.js';
import { Frames } from '../plane/Frames.js';
import type { Plane } from '../plane/Plane.js';
import { PlaneStrips, type Strip } from './compaction/PlaneStrips.js';
import { StripClosure } from './compaction/StripClosure.js';
import { DrawnDiagram } from './DrawnDiagram.js';

interface ClosingTarget {
  referenceId: string;
  plane: Plane;
  shape: DShape;
  axis: Axis;
  pool: DShape | undefined;
  where: string;
}

interface Closable {
  strip: Strip | undefined;
  within: Box | undefined;
  endOfDrawing?: boolean;
}

export class SpaceInsertion {
  private static readonly DEFAULT_COLUMN = 100;
  private static readonly FAR = 1e6;

  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: SpaceOperation,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  private static columnWidth(plane: Plane): number {
    const widths = [...plane.shapes.values()].filter((shape) => shape.kind === 'task').map((shape) => shape.bounds.width);
    return Math.round((new Samples(widths).median() ?? SpaceInsertion.DEFAULT_COLUMN) + plane.spacing().gap);
  }

  private static poolOf(plane: Plane, shape: DShape): DShape | undefined {
    if (shape.kind === 'participant') {
      return shape;
    }
    return shape.poolId ? plane.shapes.get(shape.poolId) : undefined;
  }

  private static unitNote(axis: Axis, delta: number, own: number): string {
    if (delta >= own / 4) {
      return '';
    }
    return axis === 'x' ? `; one column is ${own} px: --by ${delta}col moves by ${delta} columns` : `; one row is ${own} px: --by ${delta}row moves by ${delta} rows`;
  }

  private static lineAt(drawing: Drawing, shape: DShape, axis: Axis): number {
    const far = BoxAxis.of(axis).far(shape.container ? shape.bounds : drawing.space.unitBox(shape));
    return shape.container ? far - 1 : far + 1;
  }

  private static regionBeyond(axis: Axis, pool: DShape | undefined, far: number): Box {
    const { FAR } = SpaceInsertion;
    if (axis === 'y') {
      return new Box(-FAR, far, 2 * FAR, FAR);
    }
    return pool ? new Box(far, pool.bounds.y, FAR, pool.bounds.height) : new Box(far, -FAR, FAR, 2 * FAR);
  }

  run(): string[] {
    const { after, below } = this.operation;
    const referenceId = (after ?? below)!;
    const { plane, shape } = this.diagram.drawnShape(referenceId);
    const axis: Axis = after ? 'x' : 'y';
    const { count, unit } = SpaceAmount.parse(this.operation.by ?? (axis === 'x' ? 'column' : 'row'))!;
    const column = SpaceInsertion.columnWidth(plane);
    const { row } = plane.spacing();
    const steps: Record<typeof unit, number> = { column, row, px: 1 };
    const step = steps[unit];
    const delta = Math.abs(count) * step;
    const where = axis === 'x' ? `right of ${referenceId}` : `below ${referenceId}`;
    const pool = SpaceInsertion.poolOf(plane, shape);
    if (count < 0) {
      return this.closeSpace({ referenceId, plane, shape, axis, pool, where }, delta);
    }
    const stepWords = unit === 'px' ? '' : ` (${count} ${unit}${count > 1 ? 's' : ''} of ${step} px)`;
    const unitNote = unit === 'px' ? SpaceInsertion.unitNote(axis, delta, axis === 'x' ? column : row) : '';
    this.notes.push(`inserted ${delta} px${stepWords} ${where}${unitNote}`);
    const drawing = this.diagram.drawing(plane);
    const line = SpaceInsertion.lineAt(drawing, shape, axis);
    drawing.space.makeSpace({ axis, line, delta, anchors: [shape.id], ...(axis === 'x' && pool ? { within: pool.bounds.copy() } : {}) });
    return drawing.settle(this.before);
  }

  private closeSpace(target: ClosingTarget, amount: number): string[] {
    const { referenceId, plane, shape, axis, where } = target;
    const drawing = this.diagram.drawing(plane);
    const strips = new PlaneStrips(plane);
    const { strip, within, endOfDrawing } = shape.container && shape.kind !== 'subProcess' ? this.closableInBand(target, strips) : this.closableBeyond(target, strips, drawing);
    if (endOfDrawing) {
      this.notes.push(`nothing to close ${where}: nothing follows it`);
      return [];
    }
    const room = strip ? Math.floor(strip.to - strip.from - strip.keep) : 0;
    if (!strip || room < 1) {
      const kept = strip ? ` (the next element is ${Math.round(strip.to - strip.from)} px away, the drawing keeps ${strip.keep} px)` : '';
      this.notes.push(`nothing to close ${where}: no empty space there${kept}`);
      return [];
    }
    const close = Math.min(room, Math.round(amount));
    const part = { from: strip.to - strip.keep - close, to: strip.to, keep: strip.keep };
    const guard = this.diagram.guard(plane);
    if (!guard.attempt(() => new StripClosure(drawing).close(axis, part, within))) {
      const harm = guard.rejected.length ? `add ${DrawnDiagram.problemWords(guard.rejected)}` : 'move something that is in the way';
      throw BpmnError.model('E_NO_ROOM', `Closing the space ${where} would ${harm}; nothing was written`, {
        element: referenceId,
        ...(guard.rejected.length ? { related: [...new Set(guard.rejected.flatMap((problem) => problem.ids))] } : {}),
        hint: 'Close less (`--by -<px>`), or move what is in the way first (`bpmn place`), or use `bpmn compact`, which closes only what it can close without a new problem.',
      });
    }
    this.notes.push(close < amount ? `closed ${close} px ${where} (of ${Math.round(amount)} px asked for): the rest is not empty` : `closed ${close} px ${where}`);
    return drawing.settle(this.before);
  }

  private closableInBand({ plane, shape, axis, pool }: ClosingTarget, strips: PlaneStrips): Closable {
    const frames = new Frames(plane);
    const lanes = [...plane.shapes.values()].filter((lane) => lane.kind === 'lane' && (lane.poolId === shape.id || frames.chain(lane).includes(shape))).map((lane) => lane.id);
    const skip = new Set([shape.id, ...(pool ? [pool.id] : []), ...lanes]);
    const last = strips.occupied(axis, shape.bounds, { skip, loose: strips.looseEdges() }).at(-1);
    return {
      strip: last ? { from: last[1], to: BoxAxis.of(axis).far(shape.bounds), keep: PlaneStrips.PAD } : undefined,
      within: (pool ?? shape).bounds.copy(),
    };
  }

  private closableBeyond({ plane, shape, axis, pool }: ClosingTarget, strips: PlaneStrips, drawing: Drawing): Closable {
    const frames = new Frames(plane);
    const far = BoxAxis.of(axis).far(shape.container ? shape.bounds : drawing.space.unitBox(shape));
    const bands = [...plane.shapes.values()].filter((frame) => frame.kind === 'lane' || frame.kind === 'participant');
    const occupied = strips.occupied(axis, SpaceInsertion.regionBeyond(axis, pool, far), {
      skip: new Set([shape.id, ...bands.map((frame) => frame.id)]),
      loose: strips.looseEdges(),
      solid: (other) => other.kind === 'subProcess' && other.container && other.id !== shape.id && !frames.chain(shape).includes(other),
    });
    let from = far;
    for (const [start, end] of occupied) {
      if (start <= from + 1) {
        from = Math.max(from, end);
      }
    }
    const next = occupied.find(([start]) => start > from + 1);
    const gaps = strips.gaps();
    return {
      strip: next ? { from, to: next[0], keep: gaps[axis] } : undefined,
      within: axis === 'x' && pool ? pool.bounds.copy() : undefined,
      endOfDrawing: !next && shape.container,
    };
  }
}
