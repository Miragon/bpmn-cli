import { CliError } from '../../document/CliError.js';
import type { AlignShapes } from '../../commands/types.js';
import { cx, cy, type Box } from '../utils/geom.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { frameWord, outermost, unique } from '../utils/frames.js';

export class ShapeAlignmentService {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly op: AlignShapes,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
    private readonly picked: ReadonlySet<string> = new Set(),
  ) {}

  /** A `picked` member that would leave its frame is skipped; an explicit id is refused. */
  run(): string[] {
    const refId = this.op.to ?? this.op.ids?.[0] ?? "";
    const { plane, shape: ref } = this.diagram.drawnShape(refId);
    const items = unique(this.op.ids ?? [])
      .filter((id) => id !== refId)
      .map((id) => this.diagram.movableShape(id));
    for (const item of items) this.diagram.samePlane(plane, item.plane, item.shape.id, refId);
    const shapes = outermost(plane, items.map((item) => item.shape));
    const moves = shapes.map((shape) => ({ shape, dx: this.op.axis === 'column' ? Math.round(cx(ref.bounds) - cx(shape.bounds)) : 0, dy: this.op.axis === 'row' ? Math.round(cy(ref.bounds) - cy(shape.bounds)) : 0 }));
    const kept: typeof moves = [];
    const left: string[] = [];
    for (const move of moves) {
      try {
        this.diagram.room(plane).checkFrames([move.shape], move.dx, move.dy, `in the ${this.op.axis} of ${refId}`, [ref]);
        kept.push(move);
      } catch (err) {
        if (!(err instanceof CliError) || err.code !== 'E_LEAVES_CONTAINER' || !this.picked.has(move.shape.id)) throw err;
        const frame = plane.shapes.get(err.details.related?.[0] ?? '');
        left.push(`${move.shape.id}${frame ? ` (${frameWord(frame)} ${frame.id})` : ''}`);
      }
    }
    if (left.length) this.notes.push(`left out ${left.join(', ')}: on the ${this.op.axis} of ${refId} ${left.length > 1 ? 'they' : 'it'} would leave ${left.length > 1 ? 'their frames' : 'its frame'}`);
    const moved = kept.filter((move) => move.dx || move.dy);
    if (!moved.length) {
      if (!left.length || kept.length) this.notes.push(`already aligned on the ${this.op.axis} of ${refId}`);
      return [];
    }
    for (const move of moved) this.diagram.drawing(plane).shift(move.shape.id, move.dx, move.dy);
    const line = (box: Box): number => (this.op.axis === 'column' ? cx(box) : cy(box));
    const holds = (): boolean => moved.every((move) => Math.abs(line(move.shape.bounds) - line(ref.bounds)) <= 1);
    this.diagram.room(plane).makeRoom(moved.map((move) => move.shape), [ref], this.snap, this.notes, `on the ${this.op.axis} of ${refId}`, holds, [this.op.axis === 'column' ? 'x' : 'y']);
    return this.diagram.drawing(plane).settle(this.snap);
  }
}
