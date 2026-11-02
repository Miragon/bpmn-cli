import { BpmnError, type BpmnElement } from '../../model/index.js';
import type { PlaceOperation, SpaceOperation } from '../../operations/index.js';
import { DrawingCheckpoint } from '../plane/DrawingCheckpoint.js';
import type { PlaneShape } from '../plane/PlaneShape.js';
import type { DrawnDiagram } from './DrawnDiagram.js';
import { ShapePlacement } from './ShapePlacement.js';
import { SpaceInsertion } from './SpaceInsertion.js';

export class RoomHint {
  private static readonly COLUMN_STEPS = ['1col', '2col', '3col'];
  private static readonly ROW_STEPS = ['1row', '2row'];

  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: PlaceOperation,
    private readonly asFile: boolean,
  ) {}

  private static spaceCommand({ after, below, by }: SpaceOperation): string {
    return `bpmn space <file> ${after ? `--after ${after}` : `--below ${below}`} --by ${String(by)}`;
  }

  private static columnsAfter(after: string): SpaceOperation[] {
    return RoomHint.COLUMN_STEPS.map((by) => ({ op: 'space', after, by }));
  }

  run(attempt: () => string[]): string[] {
    const checkpoints = this.diagram.planes.map((plane) => new DrawingCheckpoint(plane));
    try {
      return attempt();
    } catch (error) {
      if (!(error instanceof BpmnError) || error.code !== 'E_NO_ROOM') {
        throw error;
      }
      const found = this.bestCandidate(checkpoints);
      checkpoints.forEach((checkpoint) => checkpoint.restore());
      this.explain(error, found);
      throw error;
    }
  }

  private shapeOf(id: string | undefined): PlaneShape | undefined {
    return id ? this.diagram.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found) : undefined;
  }

  private candidates(): SpaceOperation[] {
    const { after, before, below } = this.operation;
    const candidates = [...(after ? RoomHint.columnsAfter(after) : []), ...(before ? this.beforeTarget(before) : []), ...RoomHint.ROW_STEPS.flatMap((by): SpaceOperation[] => (below ? [{ op: 'space', below, by }] : [])), ...this.leftOfRow()];
    return candidates.filter((candidate, index) => candidates.findIndex((other) => other.after === candidate.after && other.below === candidate.below && other.by === candidate.by) === index);
  }

  private beforeTarget(before: string): SpaceOperation[] {
    const { semantics } = this.diagram;
    const beforeShape = this.shapeOf(before);
    return (semantics.byId.get(before)?.list('incoming') ?? []).flatMap((flow) => {
      const source = this.shapeOf(flow.peek<BpmnElement>('sourceRef')?.peek<string>('id'));
      return beforeShape && source && source.bounds.right <= beforeShape.bounds.x ? RoomHint.columnsAfter(source.id) : [];
    });
  }

  private leftOfRow(): SpaceOperation[] {
    const { rowOf, after, before, columnOf, ids } = this.operation;
    const reference = this.shapeOf(rowOf);
    const first = this.shapeOf(ids?.[0]);
    if (after || before || columnOf || !reference || !first) {
      return [];
    }
    const row = reference.bounds.center.y;
    const plane = this.diagram.planes.find((candidate) => candidate.shapes.has(reference.id))!;
    const onTheLeft = plane.leaves().filter(({ id, kind, bounds }) => kind !== 'boundary' && !ids?.includes(id) && bounds.right <= first.bounds.x && Math.abs(bounds.center.y - row) <= bounds.height / 2);
    const nearest = onTheLeft.sort((one, other) => other.bounds.right - one.bounds.right)[0];
    return nearest ? RoomHint.columnsAfter(nearest.id) : [];
  }

  private bestCandidate(checkpoints: readonly DrawingCheckpoint[]): SpaceOperation | undefined {
    let found: SpaceOperation | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of this.candidates()) {
      checkpoints.forEach((checkpoint) => checkpoint.restore());
      const score = this.scoreAfter(candidate);
      if (score !== undefined && score < best) {
        best = score;
        found = candidate;
      }
    }
    return found;
  }

  private scoreAfter(candidate: SpaceOperation): number | undefined {
    const { diagram, operation } = this;
    try {
      new SpaceInsertion(diagram, candidate, diagram.snapshot(), []).run();
      new ShapePlacement(diagram, operation, diagram.snapshot(), []).run();
    } catch {
      return undefined;
    }
    return diagram.measure().score;
  }

  private explain(error: BpmnError, found: SpaceOperation | undefined): void {
    const { details } = error;
    if (found && this.asFile) {
      const command = RoomHint.spaceCommand(found);
      details['command'] = command;
      details['ops'] = [{ ...found }];
      details.hint = `Make room first: \`${command}\` (checked: the place fits then), and place again; in a batch, put ${JSON.stringify(found)} before this op.`;
    } else if (found) {
      details['ops'] = [{ ...found }];
      details.hint = `Make room first: in this batch, put ${JSON.stringify(found)} before this op (checked on the drawing the batch's earlier ops leave: the place fits then).`;
    } else {
      details.hint = this.noSpaceHelps(details.related ?? []);
    }
  }

  private noSpaceHelps(related: readonly string[]): string {
    const { ids } = this.operation;
    const inWay = related.filter((id) => !ids?.includes(id));
    const tried = this.candidates().map(({ after, below, by }) => `--${after ? 'after' : 'below'} ${after ?? below} --by ${String(by)}`);
    const triedWords = tried.length ? `tried ${tried.join(', ')}` : 'the request names no column or row to make room at';
    const way = inWay.length ? `Move ${inWay.join(', ')} out of the way first (\`bpmn place <file> ${inWay[0]} --below <id>\`), or use` : 'Use';
    return `No space-tool run makes this room (${triedWords}). ${way} a reference inside the same lane / sub-process.`;
  }
}
