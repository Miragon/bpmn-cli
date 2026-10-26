import type { Doc } from '../document/Doc.js';
import { CliError } from '../document/CliError.js';
import type { DiagramCommand, ReorderElements } from '../commands/types.js';
import { cx } from '../diagram/utils/geom.js';
import type { DShape } from '../diagram/di/types.js';
import { DrawnDiagram } from '../diagram/DrawnDiagram.js';
import { unique } from '../diagram/utils/frames.js';
import { ShapePlacementService } from '../diagram/format/ShapePlacementService.js';
import { ShapeAlignmentService } from '../diagram/format/ShapeAlignmentService.js';
import { ColoringService } from '../diagram/format/ColoringService.js';
import { LabelPlacementService } from '../diagram/format/LabelPlacementService.js';
import { FlowRoutingService } from '../diagram/format/FlowRoutingService.js';
import { SpaceInsertionService } from '../diagram/format/SpaceInsertionService.js';
import { OverlapRemovalService } from '../diagram/format/OverlapRemovalService.js';
import { DiagramCompactionService } from '../diagram/format/DiagramCompactionService.js';
import { RoomHint } from '../diagram/format/RoomHint.js';
import { ElementOrderService } from '../editing/ElementOrderService.js';
import { LaneBandService } from '../editing/LaneBandService.js';
import { ElementSelector } from '../views/ElementSelector.js';

export interface FormatResult {
  op: DiagramCommand['op'] | 'order';
  index: number;
  moved: string[];
  rerouted: string[];
  /** waypoints changed without a new route (stretched by moves, the space tool, compact) */
  reshaped?: string[];
  colored?: string[];
  labels?: string[];
  notes?: string[];
}

export interface FormatEntry {
  op: DiagramCommand | ReorderElements;
  index: number;
}

/**
 * Runs diagram commands (place, align, color, label, route, space, tidy, compact, lane order)
 * through their domain services on the drawing, in batch order; writes the planes back once at the end.
 * A failing op throws with its batch index in `details.op`, so the batch writes nothing.
 */
export class DiagramCommandService {
  readonly diagram: DrawnDiagram;

  constructor(readonly doc: Doc) {
    this.diagram = new DrawnDiagram(doc);
  }

  /** `asFile`: `doc` holds the file's own drawing, so the first refusal may name a command. */
  run(entries: readonly FormatEntry[], asFile = false): FormatResult[] {
    const results: FormatResult[] = [];
    for (const [position, entry] of entries.entries()) {
      try {
        const result = this.runOne(entry, asFile && position === 0 && entry.index === 0);
        if (result) results.push(result);
      } catch (err) {
        if (err instanceof CliError) err.details['op'] = entry.index;
        throw err;
      }
    }
    this.diagram.write();
    return results;
  }

  /**
   * Explicit ids first, then what --branch, --path and --kind name. A column align picked by
   * --kind alone aligns on the rightmost shape, so nothing moves left. `picked`: ids only a
   * selector named; align skips those that would leave their frame.
   */
  private resolveSelection<TOp extends DiagramCommand>(op: TOp): { op: TOp; picked: Set<string> } {
    const none = { op, picked: new Set<string>() };
    if (op.op !== 'place' && op.op !== 'align' && op.op !== 'color' && op.op !== 'tidy') return none;
    if (!op.path && !op.kind && !op.branch) return none;
    if (!this.diagram.planes.length) throw this.diagram.noDiagram();
    const shapeOf = (id: string): DShape | undefined => this.diagram.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found);
    const ids = new ElementSelector(this.doc).select(op, {
      shapesOnly: op.op !== 'color',
      drawn: (id) => this.diagram.planes.some((plane) => plane.shapes.has(id) || plane.edges.has(id)),
      centreX: (id) => {
        const shape = shapeOf(id);
        return shape ? cx(shape.bounds) : undefined;
      },
    });
    const explicit = new Set(op.ids ?? []);
    const picked = new Set(ids.filter((id) => !explicit.has(id)));
    if (op.op === 'align' && !op.to && !op.ids?.length && !op.path && !op.branch && op.axis === 'column') {
      const right = [...ids].sort((one, other) => cx(shapeOf(other)?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) - cx(shapeOf(one)?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }))[0];
      return { op: { ...op, ids, ...(right ? { to: right } : {}) }, picked };
    }
    return { op: { ...op, ids }, picked };
  }

  private runOne(entry: FormatEntry, asFile: boolean): FormatResult | undefined {
    const index = entry.index;
    const resolved = entry.op.op === 'order' ? { op: entry.op, picked: new Set<string>() } : this.resolveSelection(entry.op);
    const op = resolved.op;
    if (op.op === 'order' && !new ElementOrderService(this.doc, op).ordersBands()) return undefined;
    const snap = this.diagram.snapshot();
    const notes: string[] = [];
    let rerouted: string[] = [];
    const extra: Partial<FormatResult> = {};
    const diagram = this.diagram;
    switch (op.op) {
      case 'place': {
        const place = () => new ShapePlacementService(diagram, op, snap, notes).run();
        rerouted = op.side ? place() : new RoomHint(diagram, op, asFile).run(place);
        break;
      }
      case 'align':
        rerouted = new RoomHint(diagram, op, asFile).run(() => new ShapeAlignmentService(diagram, op, snap, notes, resolved.picked).run());
        break;
      case 'color':
        extra.colored = new ColoringService(diagram, op).run();
        break;
      case 'label': {
        const labelled = new LabelPlacementService(diagram, op, snap, notes).run();
        extra.labels = labelled.labels;
        rerouted = labelled.rerouted;
        break;
      }
      case 'route':
        rerouted = new FlowRoutingService(diagram, op).run();
        break;
      case 'space':
        rerouted = new SpaceInsertionService(diagram, op, snap, notes).run();
        break;
      case 'tidy':
        rerouted = new OverlapRemovalService(diagram, op, snap, notes).run();
        break;
      case 'compact':
        rerouted = new DiagramCompactionService(diagram, op, snap, notes).run();
        break;
      case 'order':
        rerouted = new LaneBandService(diagram, op, snap, notes).run();
        break;
    }
    const routed = unique(rerouted);
    const reshaped = snap.changedEdges().filter((id) => !routed.includes(id));
    return { op: op.op, index, moved: snap.changedShapes(), rerouted: routed, ...(reshaped.length ? { reshaped } : {}), ...extra, ...(notes.length ? { notes } : {}) };
  }
}
