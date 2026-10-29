import type { Doc } from '../../document/Doc.js';
import { BpmnError } from '../../document/BpmnError.js';
import type { DiagramCommand, ReorderElements } from '../../commands/types.js';
import { ReorderTarget } from '../../commands/ReorderTarget.js';
import { cx } from '../utils/geom.js';
import type { DShape } from '../di/types.js';
import { DrawnDiagram } from '../DrawnDiagram.js';
import { unique } from '../utils/shape-sets.js';
import { ShapePlacement } from './ShapePlacement.js';
import { ShapeAlignment } from './ShapeAlignment.js';
import { ElementColoring } from './ElementColoring.js';
import { LabelPlacement } from './LabelPlacement.js';
import { FlowRerouting } from './FlowRerouting.js';
import { SpaceInsertion } from './SpaceInsertion.js';
import { OverlapTidying } from './OverlapTidying.js';
import { DiagramCompaction } from './DiagramCompaction.js';
import { BandReordering } from './BandReordering.js';
import { RoomHint } from './RoomHint.js';
import { ElementSelector } from './ElementSelector.js';

export interface DiagramCommandResult {
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

export interface DiagramCommandEntry {
  op: DiagramCommand | ReorderElements;
  index: number;
}

/**
 * Runs diagram commands (place, align, color, label, route, space, tidy, compact, lane order)
 * through their handlers on the drawing, in batch order; writes the planes back once at the end.
 * A failing op throws with its batch index in `details.op`, so the batch writes nothing.
 */
export class DiagramCommands {
  readonly diagram: DrawnDiagram;

  constructor(readonly doc: Doc) {
    this.diagram = new DrawnDiagram(doc);
  }

  /**
   * `asFile`: `doc` holds the file's own drawing, so the first refusal may name a command.
   * An `order` of a node's outgoing flows leaves the drawing alone: only bands are redrawn.
   */
  run(entries: readonly DiagramCommandEntry[], asFile = false): DiagramCommandResult[] {
    const drawn = entries.filter((entry) => entry.op.op !== 'order' || new ReorderTarget(this.doc, entry.op).ordersBands());
    if (entries.length && !drawn.length) return [];
    const results: DiagramCommandResult[] = [];
    for (const [position, entry] of drawn.entries()) {
      try {
        results.push(this.runOne(entry, asFile && position === 0 && entry.index === 0));
      } catch (err) {
        if (err instanceof BpmnError) err.details['op'] = entry.index;
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
  private resolveSelection<TCommand extends DiagramCommand>(command: TCommand): { command: TCommand; picked: Set<string> } {
    const none = { command, picked: new Set<string>() };
    if (command.op !== 'place' && command.op !== 'align' && command.op !== 'color' && command.op !== 'tidy') {
      return none;
    }
    if (!command.path && !command.kind && !command.branch) return none;
    if (!this.diagram.planes.length) throw this.diagram.noDiagram();
    const shapeOf = (id: string): DShape | undefined => this.diagram.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found);
    const ids = new ElementSelector(this.doc).select(command, {
      shapesOnly: command.op !== 'color',
      drawn: (id) => this.diagram.planes.some((plane) => plane.shapes.has(id) || plane.edges.has(id)),
      centreX: (id) => {
        const shape = shapeOf(id);
        return shape ? cx(shape.bounds) : undefined;
      },
    });
    const explicit = new Set(command.ids ?? []);
    const picked = new Set(ids.filter((id) => !explicit.has(id)));
    if (command.op === 'align' && !command.to && !command.ids?.length && !command.path && !command.branch && command.axis === 'column') {
      const right = [...ids].sort((one, other) => cx(shapeOf(other)?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) - cx(shapeOf(one)?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }))[0];
      return { command: { ...command, ids, ...(right ? { to: right } : {}) }, picked };
    }
    return { command: { ...command, ids }, picked };
  }

  private runOne(entry: DiagramCommandEntry, asFile: boolean): DiagramCommandResult {
    const index = entry.index;
    const resolved = entry.op.op === 'order' ? { command: entry.op, picked: new Set<string>() } : this.resolveSelection(entry.op);
    const command = resolved.command;
    const snap = this.diagram.snapshot();
    const notes: string[] = [];
    let rerouted: string[] = [];
    const extra: Partial<DiagramCommandResult> = {};
    const diagram = this.diagram;
    switch (command.op) {
      case 'place': {
        const place = () => new ShapePlacement(diagram, command, snap, notes).run();
        rerouted = command.side ? place() : new RoomHint(diagram, command, asFile).run(place);
        break;
      }
      case 'align':
        rerouted = new RoomHint(diagram, command, asFile).run(() => new ShapeAlignment(diagram, command, snap, notes, resolved.picked).run());
        break;
      case 'color':
        extra.colored = new ElementColoring(diagram, command).run();
        break;
      case 'label': {
        const labelled = new LabelPlacement(diagram, command, snap, notes).run();
        extra.labels = labelled.labels;
        rerouted = labelled.rerouted;
        break;
      }
      case 'route':
        rerouted = new FlowRerouting(diagram, command).run();
        break;
      case 'space':
        rerouted = new SpaceInsertion(diagram, command, snap, notes).run();
        break;
      case 'tidy':
        rerouted = new OverlapTidying(diagram, command, snap, notes).run();
        break;
      case 'compact':
        rerouted = new DiagramCompaction(diagram, command, snap, notes).run();
        break;
      case 'order':
        rerouted = new BandReordering(diagram, command, snap, notes).run();
        break;
    }
    const routed = unique(rerouted);
    const reshaped = snap.changedEdges().filter((id) => !routed.includes(id));
    return { op: command.op, index, moved: snap.changedShapes(), rerouted: routed, ...(reshaped.length ? { reshaped } : {}), ...extra, ...(notes.length ? { notes } : {}) };
  }
}
