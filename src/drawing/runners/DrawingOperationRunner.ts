import { BpmnError, type BpmnDocument } from '../../model/index.js';
import { ReorderTarget, type DrawingOperation, type OrderOperation } from '../../operations/index.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import { BandReordering } from './BandReordering.js';
import { DiagramCompaction } from './DiagramCompaction.js';
import { DrawnDiagram } from './DrawnDiagram.js';
import { ElementColoring } from './ElementColoring.js';
import { ElementSelector } from './ElementSelector.js';
import { FlowRerouting } from './FlowRerouting.js';
import { LabelPlacement } from './LabelPlacement.js';
import { OverlapTidying } from './OverlapTidying.js';
import { RoomHint } from './RoomHint.js';
import { ShapePlacement } from './ShapePlacement.js';
import { SpaceInsertion } from './SpaceInsertion.js';

export type DrawnOperation = DrawingOperation | OrderOperation;

type RanOperation = Exclude<DrawnOperation, { op: 'layout' }>;

interface Outcome {
  rerouted: string[];
  colored?: string[];
  labels?: string[];
}

export interface FormatResult {
  op: DrawnOperation['op'];
  index: number;
  moved: string[];
  rerouted: string[];
  reshaped?: string[];
  colored?: string[];
  labels?: string[];
  notes?: string[];
}

export class DrawingOperationRunner {
  constructor(private readonly document: BpmnDocument) {}

  private static outcomeOf(diagram: DrawnDiagram, operation: RanOperation, before: OperationBefore, notes: string[], asFile: boolean): Outcome {
    switch (operation.op) {
      case 'place': {
        const place = (): string[] => new ShapePlacement(diagram, operation, before, notes).run();
        return { rerouted: operation.side ? place() : new RoomHint(diagram, operation, asFile).run(place) };
      }
      case 'color':
        return { rerouted: [], colored: new ElementColoring(diagram, operation).run() };
      case 'label':
        return new LabelPlacement(diagram, operation, before, notes).run();
      case 'route':
        return { rerouted: new FlowRerouting(diagram, operation).run() };
      case 'space':
        return { rerouted: new SpaceInsertion(diagram, operation, before, notes).run() };
      case 'tidy':
        return { rerouted: new OverlapTidying(diagram, operation, before, notes).run() };
      case 'compact':
        return { rerouted: new DiagramCompaction(diagram, operation, before, notes).run() };
      case 'order':
        return { rerouted: new BandReordering(diagram, operation, before, notes).run() };
    }
  }

  run(operations: readonly DrawnOperation[], asFile = false): FormatResult[] {
    const drawn = [...operations.entries()].filter((entry): entry is [number, RanOperation] => this.isDrawn(entry[1]));
    if (!drawn.length) {
      return [];
    }
    const diagram = new DrawnDiagram(this.document);
    const results = drawn.map(([index, operation]) => {
      try {
        return this.runOne(diagram, operation, index, asFile && index === 0);
      } catch (error) {
        if (error instanceof BpmnError) {
          error.details.op = index;
        }
        throw error;
      }
    });
    diagram.write();
    return results;
  }

  private isDrawn(operation: DrawnOperation): boolean {
    if (operation.op === 'order') {
      return new ReorderTarget(this.document, operation).ordersBands();
    }
    return operation.op !== 'layout';
  }

  private withSelection<TOperation extends RanOperation>(diagram: DrawnDiagram, operation: TOperation): TOperation {
    if ((operation.op !== 'place' && operation.op !== 'color') || (!operation.path && !operation.branch)) {
      return operation;
    }
    const { planes } = diagram;
    if (!planes.length) {
      throw diagram.noDiagram();
    }
    const ids = new ElementSelector(this.document).select(operation, {
      shapesOnly: operation.op !== 'color',
      drawn: (id) => planes.some((plane) => plane.shapes.has(id) || plane.edges.has(id)),
      centreX: (id) => planes.map((plane) => plane.shapes.get(id)).find((found) => !!found)?.bounds.center.x,
    });
    return { ...operation, ids };
  }

  private runOne(diagram: DrawnDiagram, given: RanOperation, index: number, asFile: boolean): FormatResult {
    const operation = this.withSelection(diagram, given);
    const before = diagram.snapshot();
    const notes: string[] = [];
    const { rerouted, ...drawn } = DrawingOperationRunner.outcomeOf(diagram, operation, before, notes, asFile);
    const routed = [...new Set(rerouted)];
    const reshaped = before.changedEdges().filter((id) => !routed.includes(id));
    return { op: operation.op, index, moved: before.changedShapes(), rerouted: routed, ...(reshaped.length ? { reshaped } : {}), ...drawn, ...(notes.length ? { notes } : {}) };
  }
}
