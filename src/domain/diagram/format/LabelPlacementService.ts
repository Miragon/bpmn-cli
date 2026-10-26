import { modelError } from '../../document/utils/errors.js';
import { is } from '../../document/utils/moddle.js';
import type { PlaceLabel } from '../../commands/types.js';
import { inside, sameBox } from '../utils/geom.js';
import { Frames } from '../di/Frames.js';
import { edgeLabelAt, hasExternalLabel, labelAt } from '../utils/labels.js';
import { raw } from '../utils/raw.js';
import { labelSize } from '../utils/text.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';

export class LabelPlacementService {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly op: PlaceLabel,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  run(): { labels: string[]; rerouted: string[] } {
    const el = this.diagram.doc.require(this.op.id);
    const name = raw<string>(el, 'name')?.trim();
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) {
      const { edge } = this.diagram.drawnEdge(this.op.id);
      if (!name) throw modelError('E_NO_LABEL', `${this.op.id} has no name, so it has no label`, { element: this.op.id, hint: `Name it first: \`bpmn set <file> ${this.op.id} name=...\`.` });
      const { width, height } = edge.label ?? labelSize(name);
      const size = { width, height };
      const box = edgeLabelAt(edge, size, this.op.side);
      if (!box) {
        const want = this.op.side === 'left' || this.op.side === 'right' ? 'vertical' : 'horizontal';
        throw modelError('E_INVALID_VALUE', `${this.op.id} has no ${want} segment to put its label ${this.op.side === 'left' || this.op.side === 'right' ? 'beside' : this.op.side}`, {
          element: this.op.id,
          hint: want === 'vertical' ? 'Use side above or below.' : 'Use side left or right.',
        });
      }
      const changed = !sameBox(edge.label, box);
      edge.label = box;
      return { labels: changed ? [this.op.id] : [], rerouted: [] };
    }
    const { plane, shape } = this.diagram.drawnShape(this.op.id);
    if (!hasExternalLabel(shape)) {
      throw modelError('E_WRONG_KIND', `"${this.op.id}" has no external label (tasks, sub-processes, pools and lanes carry their name inside the shape)`, {
        element: this.op.id,
        hint: 'Labels can be placed for events, gateways, data objects / stores and flows.',
      });
    }
    if (!name) throw modelError('E_NO_LABEL', `${this.op.id} has no name, so it has no label`, { element: this.op.id, hint: `Name it first: \`bpmn set <file> ${this.op.id} name=...\`.` });
    const { width, height } = shape.label ?? labelSize(name);
    const size = { width, height };
    let box = this.diagram.drawing(plane).labelOnSide(shape, this.op.side, size);
    let rerouted: string[] = [];
    // a sub-process title takes the room above its top shapes: make room below it first
    const frame = shape.kind === 'boundary' ? undefined : Frames.of(plane, shape);
    const room = this.op.side === 'above' && frame?.kind === 'subProcess' && !inside(box, Frames.labelArea(frame)) ? this.diagram.drawing(plane).roomBelowTitle(frame, labelAt(shape, size, 'above'), shape.id) : undefined;
    if (room) {
      rerouted = this.diagram.drawing(plane).settle(this.snap);
      this.notes.push(`made ${room.delta} px of room above ${this.op.id} in its sub-process ${frame!.id} (for the label, below the title)`);
      box = this.diagram.drawing(plane).labelOnSide(shape, this.op.side, size);
    }
    const changed = !sameBox(shape.label, box);
    shape.label = box;
    return { labels: changed ? [this.op.id] : [], rerouted };
  }
}
