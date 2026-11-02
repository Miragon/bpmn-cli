import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, BpmnError } from '../../model/index.js';
import type { LabelOperation } from '../../operations/index.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import { PlaneShape, type LabelSide } from '../plane/PlaneShape.js';
import { Frames } from '../plane/Frames.js';
import type { Plane } from '../plane/Plane.js';
import type { DrawnDiagram } from './DrawnDiagram.js';

export interface PlacedLabel {
  labels: string[];
  rerouted: string[];
}

export class LabelPlacement {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: LabelOperation,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  private static sizeOf(label: Box | undefined, name: string): Pick<Box, 'width' | 'height'> {
    const { width, height } = label ?? TextMetrics.labelSize(name);
    return { width, height };
  }

  run(): PlacedLabel {
    const { id } = this.operation;
    const element = this.diagram.document.tree.require(id);
    const name = element.peek<string>('name')?.trim();
    return element.is('bpmn:SequenceFlow') || element.is('bpmn:MessageFlow') ? this.placeOnFlow(name) : this.placeOnShape(name);
  }

  private named(name: string | undefined): string {
    if (!name) {
      const { id } = this.operation;
      throw BpmnError.model('E_NO_LABEL', `${id} has no name, so it has no label`, { element: id, hint: `Name it first: \`bpmn set <file> ${id} name=...\`.` });
    }
    return name;
  }

  private placeOnFlow(name: string | undefined): PlacedLabel {
    const { id, side } = this.operation;
    const { edge } = this.diagram.drawnEdge(id);
    const box = edge.labelAt(LabelPlacement.sizeOf(edge.label, this.named(name)), side);
    if (!box) {
      throw this.noSegment(side);
    }
    const changed = !Box.same(edge.label, box);
    edge.label = box;
    return { labels: changed ? [id] : [], rerouted: [] };
  }

  private noSegment(side: LabelSide): BpmnError {
    const beside = side === 'left' || side === 'right';
    return BpmnError.model('E_INVALID_VALUE', `${this.operation.id} has no ${beside ? 'vertical' : 'horizontal'} segment to put its label ${beside ? 'beside' : side}`, {
      element: this.operation.id,
      hint: beside ? 'Use side above or below.' : 'Use side left or right.',
    });
  }

  private placeOnShape(name: string | undefined): PlacedLabel {
    const { id, side } = this.operation;
    const { plane, shape } = this.diagram.drawnShape(id);
    if (!PlaneShape.hasExternalLabel(shape.kind)) {
      throw BpmnError.model('E_WRONG_KIND', `"${id}" has no external label (tasks, sub-processes, pools and lanes carry their name inside the shape)`, {
        element: id,
        hint: 'Labels can be placed for events, gateways, data objects / stores and flows.',
      });
    }
    const size = LabelPlacement.sizeOf(shape.label, this.named(name));
    const rerouted = this.roomForTitle(plane, shape, size);
    const box = this.diagram.drawing(plane).labels.labelOnSide(shape, side, size);
    const changed = !Box.same(shape.label, box);
    shape.label = box;
    return { labels: changed ? [id] : [], rerouted };
  }

  private roomForTitle(plane: Plane, shape: PlaneShape, size: Pick<Box, 'width' | 'height'>): string[] {
    const { id, side } = this.operation;
    const drawing = this.diagram.drawing(plane);
    const frame = shape.kind === 'boundary' ? undefined : new Frames(plane).of(shape);
    if (side !== 'above' || frame?.kind !== 'subProcess' || drawing.labels.labelOnSide(shape, side, size).isInside(Frames.labelArea(frame))) {
      return [];
    }
    const room = drawing.space.roomBelowTitle(frame, shape.labelAt(size, 'above'), shape.id);
    if (!room) {
      return [];
    }
    this.notes.push(`made ${room.delta} px of room above ${id} in its sub-process ${frame.id} (for the label, below the title)`);
    return drawing.settle(this.before);
  }
}
