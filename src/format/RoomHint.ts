import { CliError } from '../shared/CliError.js';
import type { AlignOp, PlaceOp, SpaceOp } from '../ops/types.js';
import { cy, right } from '../diagram/utils/geom.js';
import { idOf, isLeaf, raw, rawList } from '../diagram/utils/plane.js';
import type { DShape } from '../diagram/types.js';
import { PlaneCheckpoint } from '../diagram/PlaneCheckpoint.js';
import type { FormatOps } from './FormatOps.js';
import { PlaceAction } from './PlaceAction.js';
import { AlignAction } from './AlignAction.js';
import { SpaceAction } from './SpaceAction.js';

export class RoomHint {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: PlaceOp | AlignOp,
    private readonly asFile: boolean,
  ) {}

  /**
   * Space-tool runs that may make the room a place / align request needs:
   * right of its column reference (after; before: right of the reference's
   * drawn predecessors left of it) by one to three columns, below its row
   * reference (below) by one or two rows, and right of the shapes left of the
   * moved ones on their row (rowOf).
   */
  private candidates(): SpaceOp[] {
    const out: SpaceOp[] = [];
    const cols = (after: string): void => {
      for (const by of ['1col', '2col', '3col'] as const) out.push({ op: 'space', after, by });
    };
    const shapeOf = (id: string | undefined): DShape | undefined => (id ? this.ops.planes.map((p) => p.shapes.get(id)).find((x) => !!x) : undefined);
    if (this.op.op === 'place') {
      if (this.op.after) cols(this.op.after);
      if (this.op.before) {
        const b = shapeOf(this.op.before);
        for (const f of rawList(this.ops.sem.byId.get(this.op.before), 'incoming')) {
          const p = shapeOf(idOf(raw(f, 'sourceRef')));
          if (b && p && right(p.bounds) <= b.bounds.x) cols(p.id);
        }
      }
      if (this.op.below) for (const by of ['1row', '2row'] as const) out.push({ op: 'space', below: this.op.below, by });
    }
    if ((this.op.op === 'place' && this.op.rowOf && !this.op.after && !this.op.before && !this.op.columnOf) || (this.op.op === 'align' && this.op.axis === 'row')) {
      // the moved shapes keep their column: room right of what lies left of them on the target row
      const ref = shapeOf(this.op.op === 'place' ? this.op.rowOf : (this.op.to ?? this.op.ids?.[0]));
      const first = shapeOf(this.op.ids?.[0]);
      if (ref && first) {
        const left = [...this.ops.planes.find((p) => p.shapes.has(ref.id))!.shapes.values()].filter((s) => isLeaf(s) && s.kind !== 'boundary' && !this.op.ids?.includes(s.id) && right(s.bounds) <= first.bounds.x && Math.abs(cy(s.bounds) - cy(ref.bounds)) <= s.bounds.height / 2).sort((a, b) => right(b.bounds) - right(a.bounds))[0];
        if (left) cols(left.id);
      }
    }
    return out.filter((c, i) => out.findIndex((d) => d.after === c.after && d.below === c.below && d.by === c.by) === i);
  }

  private spaceCommand(c: SpaceOp): string {
    return `bpmn space <file> ${c.after ? `--after ${c.after}` : `--below ${c.below}`} --by ${String(c.by)}`;
  }

  /**
   * Runs a place / align op; when it is refused (E_NO_ROOM), a dry run on the
   * drawing as the op found it tries the space-tool runs of roomCandidates,
   * each followed by the same op: of those that let the op succeed, the one
   * whose drawing scores best (fewest layout problems; on a tie the first,
   * the smallest) goes into the refusal as its batch op (details.ops). When
   * the op found the file's own drawing (`asFile`: the first op of a batch of
   * format ops only, e.g. one `bpmn place`), it is also one runnable command
   * (details.command, `<file>` stands for the file; the CLI fills it in);
   * after other ops of the batch (their changes are not in the file, their
   * new ids not either) only the batch op is named, to put before this op.
   * Without one, the hint names the shapes in the way, to be moved first.
   */
  run(attempt: () => string[]): string[] {
    const states = this.ops.planes.map((p) => new PlaneCheckpoint(p));
    try {
      return attempt();
    } catch (err) {
      if (!(err instanceof CliError) || err.code !== 'E_NO_ROOM') throw err;
      let found: SpaceOp | undefined;
      let best = Infinity;
      for (const c of this.candidates()) {
        states.forEach((st) => st.restore());
        try {
          new SpaceAction(this.ops, c, this.ops.snapshot(), []).run();
          if (this.op.op === 'place') new PlaceAction(this.ops, this.op, this.ops.snapshot(), []).run();
          else new AlignAction(this.ops, this.op, this.ops.snapshot(), []).run();
        } catch {
          continue;
        }
        const score = this.ops.measure().score;
        if (score < best) {
          best = score;
          found = c;
        }
      }
      states.forEach((st) => st.restore());
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
        const tried = this.candidates().map((c) => `--${c.after ? 'after' : 'below'} ${c.after ?? c.below} --by ${String(c.by)}`);
        err.details.hint = `No space-tool run makes this room (${tried.length ? `tried ${tried.join(', ')}` : 'the request names no column or row to make room at'}). ${inWay.length ? `Move ${inWay.join(', ')} out of the way first (\`bpmn place <file> ${inWay[0]} --below <id>\`), or use` : 'Use'} a reference inside the same lane / sub-process.`;
      }
      throw err;
    }
  }
}
