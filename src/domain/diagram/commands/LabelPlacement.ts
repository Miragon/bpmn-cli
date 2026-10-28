import { modelError } from '../../document/utils/errors.js';
import { is } from '../../document/utils/moddle.js';
import type { PlaceLabel } from '../../commands/types.js';
import { Frames } from '../di/Frames.js';
import type { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import { inside, sameBox } from '../utils/geom.js';
import { edgeLabelAt, hasExternalLabel, labelAt } from '../utils/labels.js';
import { raw } from '../utils/raw.js';
import { labelSize } from '../utils/text.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';

/**
 * Above a shape at the top of a sub-process the title takes the room, so room is made below it
 * first.
 */
export class LabelPlacement {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: PlaceLabel,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  run(): { labels: string[]; rerouted: string[] } {
    const { command, diagram } = this;
    const el = diagram.doc.require(command.id);
    const name = raw<string>(el, 'name')?.trim();
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) {
      const { edge } = diagram.drawnEdge(command.id);
      if (!name) throw modelError('E_NO_LABEL', `${command.id} has no name, so it has no label`, { element: command.id, hint: `Name it first: \`bpmn set <file> ${command.id} name=...\`.` });
      const { width, height } = edge.label ?? labelSize(name);
      const size = { width, height };
      const box = edgeLabelAt(edge, size, command.side);
      if (!box) {
        const want = command.side === 'left' || command.side === 'right' ? 'vertical' : 'horizontal';
        throw modelError('E_INVALID_VALUE', `${command.id} has no ${want} segment to put its label ${command.side === 'left' || command.side === 'right' ? 'beside' : command.side}`, {
          element: command.id,
          hint: want === 'vertical' ? 'Use side above or below.' : 'Use side left or right.',
        });
      }
      const changed = !sameBox(edge.label, box);
      edge.label = box;
      return { labels: changed ? [command.id] : [], rerouted: [] };
    }
    const { plane, shape } = diagram.drawnShape(command.id);
    if (!hasExternalLabel(shape)) {
      throw modelError('E_WRONG_KIND', `"${command.id}" has no external label (tasks, sub-processes, pools and lanes carry their name inside the shape)`, {
        element: command.id,
        hint: 'Labels can be placed for events, gateways, data objects / stores and flows.',
      });
    }
    if (!name) throw modelError('E_NO_LABEL', `${command.id} has no name, so it has no label`, { element: command.id, hint: `Name it first: \`bpmn set <file> ${command.id} name=...\`.` });
    const { width, height } = shape.label ?? labelSize(name);
    const size = { width, height };
    let box = diagram.drawing(plane).labelOnSide(shape, command.side, size);
    let rerouted: string[] = [];
    const frame = shape.kind === 'boundary' ? undefined : Frames.of(plane, shape);
    const room = command.side === 'above' && frame?.kind === 'subProcess' && !inside(box, Frames.labelArea(frame)) ? diagram.drawing(plane).roomBelowTitle(frame, labelAt(shape, size, 'above'), shape.id) : undefined;
    if (room) {
      rerouted = diagram.drawing(plane).settle(this.snap);
      this.notes.push(`made ${room.delta} px of room above ${command.id} in its sub-process ${frame!.id} (for the label, below the title)`);
      box = diagram.drawing(plane).labelOnSide(shape, command.side, size);
    }
    const changed = !sameBox(shape.label, box);
    shape.label = box;
    return { labels: changed ? [command.id] : [], rerouted };
  }
}
