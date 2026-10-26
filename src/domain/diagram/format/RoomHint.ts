import { CliError } from '../../document/CliError.js';
import type { AlignShapes, PlaceShapes, InsertSpace } from '../../commands/types.js';
import { cy, right } from '../utils/geom.js';
import { PlaneQuery } from '../di/PlaneQuery.js';
import { idOf, raw, rawList } from '../utils/raw.js';
import type { DShape } from '../di/types.js';
import { DrawingCheckpoint } from '../di/DrawingCheckpoint.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { ShapePlacementService } from './ShapePlacementService.js';
import { ShapeAlignmentService } from './ShapeAlignmentService.js';
import { SpaceInsertionService } from './SpaceInsertionService.js';

/**
 * When place / align is refused with E_NO_ROOM, dry-runs space-tool candidates followed by the
 * op and puts the best-scoring one that lets it succeed into the refusal as a batch op.
 */
export class RoomHint {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly op: PlaceShapes | AlignShapes,
    private readonly asFile: boolean,
  ) {}

  private candidates(): InsertSpace[] {
    const out: InsertSpace[] = [];
    const cols = (after: string): void => {
      for (const by of ['1col', '2col', '3col'] as const) out.push({ op: 'space', after, by });
    };
    const shapeOf = (id: string | undefined): DShape | undefined => (id ? this.diagram.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found) : undefined);
    if (this.op.op === 'place') {
      if (this.op.after) cols(this.op.after);
      if (this.op.before) {
        const beforeShape = shapeOf(this.op.before);
        for (const flow of rawList(this.diagram.sem.byId.get(this.op.before), 'incoming')) {
          const source = shapeOf(idOf(raw(flow, 'sourceRef')));
          if (beforeShape && source && right(source.bounds) <= beforeShape.bounds.x) cols(source.id);
        }
      }
      if (this.op.below) for (const by of ['1row', '2row'] as const) out.push({ op: 'space', below: this.op.below, by });
    }
    if ((this.op.op === 'place' && this.op.rowOf && !this.op.after && !this.op.before && !this.op.columnOf) || (this.op.op === 'align' && this.op.axis === 'row')) {
      // the moved shapes keep their column: room right of what lies left of them on the row
      const ref = shapeOf(this.op.op === 'place' ? this.op.rowOf : (this.op.to ?? this.op.ids?.[0]));
      const first = shapeOf(this.op.ids?.[0]);
      if (ref && first) {
        const left = [...this.diagram.planes.find((plane) => plane.shapes.has(ref.id))!.shapes.values()].filter((shape) => PlaneQuery.isLeaf(shape) && shape.kind !== 'boundary' && !this.op.ids?.includes(shape.id) && right(shape.bounds) <= first.bounds.x && Math.abs(cy(shape.bounds) - cy(ref.bounds)) <= shape.bounds.height / 2).sort((one, other) => right(other.bounds) - right(one.bounds))[0];
        if (left) cols(left.id);
      }
    }
    return out.filter((candidate, index) => out.findIndex((other) => other.after === candidate.after && other.below === candidate.below && other.by === candidate.by) === index);
  }

  private spaceCommand(candidate: InsertSpace): string {
    return `bpmn space <file> ${candidate.after ? `--after ${candidate.after}` : `--below ${candidate.below}`} --by ${String(candidate.by)}`;
  }

  /**
   * Only on the file's own drawing (`asFile`) is the run also a command: after earlier batch ops
   * the file lacks their changes, so only the batch op is named.
   */
  run(attempt: () => string[]): string[] {
    const states = this.diagram.planes.map((plane) => new DrawingCheckpoint(plane));
    try {
      return attempt();
    } catch (err) {
      if (!(err instanceof CliError) || err.code !== 'E_NO_ROOM') throw err;
      let found: InsertSpace | undefined;
      let best = Infinity;
      for (const candidate of this.candidates()) {
        states.forEach((state) => state.restore());
        try {
          new SpaceInsertionService(this.diagram, candidate, this.diagram.snapshot(), []).run();
          if (this.op.op === 'place') new ShapePlacementService(this.diagram, this.op, this.diagram.snapshot(), []).run();
          else new ShapeAlignmentService(this.diagram, this.op, this.diagram.snapshot(), []).run();
        } catch {
          continue;
        }
        const score = this.diagram.measure().score;
        if (score < best) {
          best = score;
          found = candidate;
        }
      }
      states.forEach((state) => state.restore());
      const again = this.op.op === 'place' ? 'place' : 'align';
      if (found && this.asFile) {
        err.details['command'] = this.spaceCommand(found);
        err.details['ops'] = [{ ...found }];
        err.details.hint = `Make room first: \`${this.spaceCommand(found)}\` (checked: the ${again} fits then), and ${again} again; in a batch, put ${JSON.stringify(found)} before this op.`;
      } else if (found) {
        err.details['ops'] = [{ ...found }];
        err.details.hint = `Make room first: in this batch, put ${JSON.stringify(found)} before this op (checked on the drawing the batch's earlier ops leave: the ${again} fits then).`;
      } else {
        const inWay = (err.details.related ?? []).filter((id) => !(this.op.ids ?? []).includes(id));
        const tried = this.candidates().map((candidate) => `--${candidate.after ? 'after' : 'below'} ${candidate.after ?? candidate.below} --by ${String(candidate.by)}`);
        err.details.hint = `No space-tool run makes this room (${tried.length ? `tried ${tried.join(', ')}` : 'the request names no column or row to make room at'}). ${inWay.length ? `Move ${inWay.join(', ')} out of the way first (\`bpmn place <file> ${inWay[0]} --below <id>\`), or use` : 'Use'} a reference inside the same lane / sub-process.`;
      }
      throw err;
    }
  }
}
