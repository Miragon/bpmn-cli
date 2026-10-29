import { BpmnError } from '../../document/BpmnError.js';
import type { AlignShapes } from '../../commands/types.js';
import type { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import { cx, cy, type Box } from '../utils/geom.js';
import { frameWord, outermost, unique } from '../utils/shape-sets.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';

/** A `picked` member that would leave its frame is skipped; an explicit id is refused. */
export class ShapeAlignment {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: AlignShapes,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
    private readonly picked: ReadonlySet<string> = new Set(),
  ) {}

  run(): string[] {
    const { command, diagram, notes } = this;
    const refId = command.to ?? command.ids?.[0] ?? "";
    const { plane, shape: ref } = diagram.drawnShape(refId);
    const items = unique(command.ids ?? [])
      .filter((id) => id !== refId)
      .map((id) => diagram.movableShape(id));
    for (const item of items) {
      diagram.samePlane(plane, item.plane, item.shape.id, refId);
    }
    const shapes = outermost(plane, items.map((item) => item.shape));
    const moves = shapes.map((shape) => ({ shape, dx: command.axis === 'column' ? Math.round(cx(ref.bounds) - cx(shape.bounds)) : 0, dy: command.axis === 'row' ? Math.round(cy(ref.bounds) - cy(shape.bounds)) : 0 }));
    const kept: typeof moves = [];
    const left: string[] = [];
    for (const move of moves) {
      try {
        diagram.room(plane).checkFrames([move.shape], move.dx, move.dy, `in the ${command.axis} of ${refId}`, [ref]);
        kept.push(move);
      } catch (err) {
        if (!(err instanceof BpmnError) || err.code !== 'E_LEAVES_CONTAINER' || !this.picked.has(move.shape.id)) {
          throw err;
        }
        const frame = plane.shapes.get(err.details.related?.[0] ?? '');
        left.push(`${move.shape.id}${frame ? ` (${frameWord(frame)} ${frame.id})` : ''}`);
      }
    }
    if (left.length) {
      notes.push(`left out ${left.join(', ')}: on the ${command.axis} of ${refId} ${left.length > 1 ? 'they' : 'it'} would leave ${left.length > 1 ? 'their frames' : 'its frame'}`);
    }
    const moved = kept.filter((move) => move.dx || move.dy);
    if (!moved.length) {
      if (!left.length || kept.length) {
        notes.push(`already aligned on the ${command.axis} of ${refId}`);
      }
      return [];
    }
    for (const move of moved) {
      diagram.drawing(plane).shift(move.shape.id, move.dx, move.dy);
    }
    const line = (box: Box): number => (command.axis === 'column' ? cx(box) : cy(box));
    const holds = (): boolean => moved.every((move) => Math.abs(line(move.shape.bounds) - line(ref.bounds)) <= 1);
    diagram.room(plane).makeRoom(moved.map((move) => move.shape), [ref], this.snap, notes, `on the ${command.axis} of ${refId}`, holds, [command.axis === 'column' ? 'x' : 'y']);
    return diagram.drawing(plane).settle(this.snap);
  }
}
