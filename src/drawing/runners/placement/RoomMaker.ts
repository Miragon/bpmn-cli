import { Box, BpmnError } from '../../../model/index.js';
import type { Drawing } from '../../incremental/Drawing.js';
import { DrawingCheckpoint } from '../../plane/DrawingCheckpoint.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { FrameEscape } from './FrameEscape.js';
import { RoomTrial, type RoomOutcome, type RoomRequest } from './RoomTrial.js';

interface Departure {
  shape: DShape;
  frame: DShape;
  there: DShape;
  box: Box;
  farReference: boolean;
}

export class RoomMaker {
  private readonly frames: Frames;

  constructor(
    private readonly plane: Plane,
    private readonly drawing: Drawing,
  ) {
    this.frames = new Frames(plane);
  }

  private static laneHint({ shape, frame, there, box }: Departure): string {
    if (there.kind === 'lane' && there !== frame) {
      return `That position is in lane ${there.id}. Assign the lane first (\`bpmn move <file> ${shape.id} --lane ${there.id}\`, in a batch a move op with "lane" before this op), or make room in ${frame.id} first (\`bpmn space <file> --below ${frame.id}\`).`;
    }
    if (there === frame && box.center.y >= frame.bounds.bottom) {
      return `That position is below lane ${frame.id}, in no lane of its pool (another lane follows underneath ${frame.id}): pick a reference inside lane ${frame.id}, make room in it first (\`bpmn space <file> --below ${frame.id}\`), or assign another lane first (\`bpmn move <file> ${shape.id} --lane <laneId>\`).`;
    }
    return `Pick a reference inside lane ${frame.id}, or assign another lane first (\`bpmn move <file> ${shape.id} --lane <laneId>\`).`;
  }

  private static subProcessHint({ shape, frame, farReference }: Departure): string {
    if (farReference) {
      return `The reference lies outside sub-process ${frame.id}, which would have to grow out to it: pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${shape.id} --in <scopeId>\`).`;
    }
    return `Pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${shape.id} --in <scopeId>\`).`;
  }

  private static departureHint(departure: Departure): string {
    const { frame } = departure;
    if (frame.kind === 'lane') {
      return RoomMaker.laneHint(departure);
    }
    return frame.kind === 'subProcess' ? RoomMaker.subProcessHint(departure) : `Nodes cannot leave their pool; pick a reference inside ${frame.id}.`;
  }

  private static blockage({ swallowed, displaced, collided, strayed }: RoomOutcome, references: readonly DShape[]): { why: string; related: string[] } {
    if (swallowed.length) {
      const ids = swallowed.map((frame) => frame.id);
      return { why: `its frame would have to grow over ${ids.join(', ')}`, related: ids };
    }
    if (displaced.length) {
      return {
        why: `its frame would have to push away ${displaced.map(({ reference, frame }) => `${frame.frameWord} ${frame.id} of ${reference.id}`).join(', ')}`,
        related: displaced.flatMap(({ reference, frame }) => [reference.id, frame.id]),
      };
    }
    if (collided.length) {
      return { why: `making room would put ${collided.map(([first, second]) => `${first} onto ${second}`).join(', ')}`, related: [...new Set(collided.flat())] };
    }
    if (strayed.length) {
      return {
        why: `making room would take ${strayed.map(({ shape, frame }) => `${shape.id} out of its ${frame.frameWord} ${frame.id}`).join(', ')}`,
        related: [...new Set(strayed.flatMap(({ shape, frame }) => [shape.id, frame.id]))],
      };
    }
    return { why: 'what is in the way cannot give way without moving the reference or the shapes off it', related: references.map((reference) => reference.id) };
  }

  checkFrames(shapes: readonly DShape[], dx: number, dy: number, target: string, references: readonly DShape[] = []): void {
    const escape = new FrameEscape(this.plane);
    for (const shape of shapes) {
      const frame = this.frames.of(shape);
      if (!frame) {
        continue;
      }
      const unit = this.drawing.space.unitBox(shape);
      const box = new Box(unit.x + dx, unit.y + dy, unit.width, unit.height);
      const escaped = escape.of(shape, frame, box);
      const farReference = !escaped && this.staysAwayFrom(references, frame, box);
      const there = escaped ?? (farReference ? frame : undefined);
      if (there) {
        throw this.leavesContainer({ shape, frame, there, box, farReference }, target);
      }
    }
  }

  makeRoom(request: RoomRequest, notes: string[]): void {
    const trial = new RoomTrial(this.plane, this.drawing, request);
    const { referenceIds } = trial;
    const start = new DrawingCheckpoint(this.plane);
    let outcome = trial.attempt(referenceIds);
    if (!outcome.ok && referenceIds.length) {
      start.restore();
      outcome = trial.attempt([]);
    }
    if (!outcome.ok) {
      throw this.noRoom(request, outcome);
    }
    notes.push(...outcome.notes);
  }

  private staysAwayFrom(references: readonly DShape[], frame: DShape, box: Box): boolean {
    return frame.kind === 'subProcess' && references.length > 0 && references.every((reference) => reference !== frame && !this.frames.chain(reference).includes(frame)) && !box.isInside(frame.bounds);
  }

  private leavesContainer(departure: Departure, target: string): BpmnError {
    const { shape, frame, there } = departure;
    const into = there === frame ? '' : ` (into ${there.kind === 'participant' ? 'pool' : 'lane'} ${there.id})`;
    return BpmnError.model('E_LEAVES_CONTAINER', `Placing ${shape.id} ${target} would move it out of its ${frame.frameWord} ${frame.id}${into}`, {
      element: shape.id,
      related: [frame.id, ...(there === frame ? [] : [there.id])],
      hint: RoomMaker.departureHint(departure),
    });
  }

  private noRoom({ moved, references, target }: RoomRequest, outcome: RoomOutcome): BpmnError {
    const { why, related } = RoomMaker.blockage(outcome, references);
    return BpmnError.model('E_NO_ROOM', `There is no room to put ${moved.map((shape) => shape.id).join(', ')} ${target}: ${why}`, {
      element: moved[0]!.id,
      related,
      hint: 'Use a reference inside the same lane / sub-process, or make room first (`bpmn space <file> --after <id>` / `--below <id>`) and place it again.',
    });
  }
}
