import type { Doc } from '../model/Doc.js';
import { CliError, type ErrorDetails } from '../shared/CliError.js';
import { modelError } from '../shared/utils/errors.js';
import { is, type El } from '../model/utils/moddle.js';
import { Reordering } from '../ops/Reordering.js';
import type { FormatOp, OrderOp } from '../ops/types.js';
import type { Attempt } from './Compaction.js';
import { cx } from '../drawing/utils/geom.js';
import { isHardProblem, problemKey, type LayoutMetrics, type LayoutProblem } from '../drawing/utils/problems.js';
import { LayoutAnalysis } from '../drawing/LayoutAnalysis.js';
import { idOf, raw, rawList } from '../drawing/utils/raw.js';
import { DiagramReader } from '../drawing/DiagramReader.js';
import { Semantics } from '../drawing/Semantics.js';
import type { DEdge, DShape, Plane } from '../drawing/types.js';
import { ElementSelector } from '../query/ElementSelector.js';
import { PlaneWriter } from '../drawing/PlaneWriter.js';
import { Drawing } from '../drawing/Drawing.js';
import { DrawingSnapshot } from '../drawing/DrawingSnapshot.js';
import { TrialGuard, type TrialPolicy } from '../drawing/TrialGuard.js';
import { RoomMaker } from './RoomMaker.js';
import { unique } from './utils/frames.js';
import { PlaceAction } from './PlaceAction.js';
import { AlignAction } from './AlignAction.js';
import { ColorAction } from './ColorAction.js';
import { LabelAction } from './LabelAction.js';
import { RouteAction } from './RouteAction.js';
import { SpaceAction } from './SpaceAction.js';
import { TidyAction } from './TidyAction.js';
import { CompactAction } from './CompactAction.js';
import { OrderAction } from './OrderAction.js';
import { RoomHint } from './RoomHint.js';

export interface FormatResult {
  op: FormatOp['op'] | 'order';
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
  op: FormatOp | OrderOp;
  index: number;
}

/** A change of one plane must not add a hard layout problem or raise the score. */
const GUARDED: TrialPolicy = { key: (p) => (isHardProblem(p) ? problemKey(p) : undefined), lower: false, rebase: false };

/**
 * Runs the format ops of a batch (place, align, color, label, route, space, tidy, compact,
 * lane order) on the kept drawing, in batch order; writes the planes back once at the end.
 * A failing op throws with its batch index in `details.op`, so the batch writes nothing.
 */
export class FormatOps {
  readonly sem: Semantics;
  readonly planes: Plane[];
  private readonly drawings = new Map<Plane, Drawing>();

  constructor(readonly doc: Doc) {
    this.sem = Semantics.of(doc.definitions);
    this.planes = new DiagramReader(doc.definitions, this.sem).planes();
  }

  /** `asFile`: `doc` holds the file's own drawing, so the first refusal may name a command. */
  run(entries: readonly FormatEntry[], asFile = false): FormatResult[] {
    const results: FormatResult[] = [];
    for (const [i, entry] of entries.entries()) {
      try {
        const r = this.runOne(entry, asFile && i === 0 && entry.index === 0);
        if (r) results.push(r);
      } catch (err) {
        if (err instanceof CliError) err.details['op'] = entry.index;
        throw err;
      }
    }
    new PlaneWriter(this.doc.moddle, this.doc.definitions).write(this.planes);
    this.doc.invalidate();
    return results;
  }

  noDiagram(): CliError {
    return modelError('E_NO_DIAGRAM', 'The file has no diagram; format operations need one', {
      hint: 'Draw it first: `bpmn layout <file>` (or run the command without --no-layout, which draws a file without diagram).',
    });
  }

  noShape(el: El, id: string, what = 'shape'): CliError {
    const details: ErrorDetails = { element: id, hint: 'It is not drawn (written with --no-layout, or outside the drawn root): the next model edit without --no-layout places it, `bpmn layout <file>` redraws all.' };
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) {
      details.hint = `It has no line (added, or its ends changed, with --no-layout): \`bpmn route <file> ${id}\` draws it, and so does the next model edit without --no-layout.`;
    } else if (is(el, 'bpmn:Process')) {
      const pool = rawList(this.sem.collaboration, 'participants').find((p) => raw(p, 'processRef') === el);
      if (pool) details.hint = `A process is drawn as its pool: use the participant id ${idOf(pool)}.`;
      else details.hint = 'A process without pool is the diagram itself; name the shapes inside it.';
    }
    return modelError('E_NO_SHAPE', `${id} has no ${what} in the diagram`, details);
  }

  drawnShape(id: string): { plane: Plane; shape: DShape } {
    const el = this.doc.require(id);
    if (!this.planes.length) throw this.noDiagram();
    for (const plane of this.planes) {
      const shape = plane.shapes.get(id);
      if (shape) return { plane, shape };
    }
    if (this.isConnectionEl(el)) throw modelError('E_WRONG_KIND', `"${id}" is a connection, expected a shape`, { element: id, hint: 'Connections follow their ends; use `bpmn route` to route one again.' });
    throw this.noShape(el, id);
  }

  /** With `draw`, a flow without a line whose ends share a plane gets a new, unrouted one. */
  drawnEdge(id: string, draw = false): { plane: Plane; edge: DEdge } {
    const el = this.doc.require(id, ['bpmn:SequenceFlow', 'bpmn:MessageFlow'], 'sequence or message flow');
    if (!this.planes.length) throw this.noDiagram();
    for (const plane of this.planes) {
      const edge = plane.edges.get(id);
      if (edge) return { plane, edge };
    }
    const ends = DiagramReader.edgeEnds(el);
    const drawsBoth = (p: Plane | undefined): p is Plane => !!p && !!ends.sourceId && !!ends.targetId && p.shapes.has(ends.sourceId) && p.shapes.has(ends.targetId);
    const plane = !draw ? undefined : is(el, 'bpmn:MessageFlow') ? this.sem.homePlane(this.planes, id) : this.planes.find(drawsBoth);
    if (drawsBoth(plane)) {
      const edge: DEdge = { id, el, kind: DiagramReader.edgeKind(el), ...ends, points: [] };
      plane.edges.set(id, edge);
      return { plane, edge };
    }
    throw this.noShape(el, id, 'connection');
  }

  private isConnectionEl(el: El): boolean {
    return is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');
  }

  movableShape(id: string): { plane: Plane; shape: DShape } {
    const found = this.drawnShape(id);
    const s = found.shape;
    if (s.kind === 'boundary') {
      throw modelError('E_WRONG_KIND', `"${id}" is a boundary event; it follows its host ${s.hostId ?? ''}`.trim(), { element: id, ...(s.hostId ? { related: [s.hostId] } : {}), hint: `Place the host instead${s.hostId ? ` (${s.hostId})` : ''}; \`bpmn place <file> ${id} --side top|bottom\` moves it to the other border of its host, \`bpmn move <file> ${id} --on <activityId>\` attaches it elsewhere.` });
    }
    if (s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group' || s.kind === 'other') {
      throw modelError('E_WRONG_KIND', `"${id}" is a ${s.kind === 'participant' ? 'pool' : s.kind}, expected a node, data element or annotation`, {
        element: id,
        hint: 'Pools and lanes are bands: `bpmn order <file> <collaborationId> <participantIds...>` reorders pools, `bpmn order <file> <poolId> <laneIds...>` reorders lanes, `bpmn space <file> --below <laneId>` makes one taller (`--by -row` smaller).',
      });
    }
    return found;
  }

  samePlane(plane: Plane, other: Plane, id: string, refId: string): void {
    if (plane === other) return;
    throw modelError('E_DIFFERENT_DIAGRAM', `${id} and ${refId} are drawn on different diagrams`, {
      element: id,
      related: [refId],
      hint: 'Shapes inside a collapsed sub-process live on their own diagram; refer to elements of the same one (or expand the sub-process: `bpmn set <file> <subProcessId> expanded=true`).',
    });
  }

  drawing(plane: Plane): Drawing {
    let d = this.drawings.get(plane);
    if (!d) this.drawings.set(plane, (d = new Drawing(plane)));
    return d;
  }

  room(plane: Plane): RoomMaker {
    return new RoomMaker(plane, this.drawing(plane));
  }

  measure(): LayoutMetrics {
    new PlaneWriter(this.doc.moddle, this.doc.definitions).write(this.planes);
    return LayoutAnalysis.of(this.doc.definitions);
  }

  snapshot(): DrawingSnapshot {
    return new DrawingSnapshot(this.planes.map((p) => this.drawing(p)));
  }

  /**
   * Changes of one plane are undone when they add a hard layout problem or raise the score.
   * `rejected` collects what the undone changes would have added.
   */
  guard(plane: Plane): { attempt: Attempt; rejected: LayoutProblem[] } {
    const trials = new TrialGuard(() => this.measure(), GUARDED);
    const d = this.drawing(plane);
    return { attempt: (change, force) => d.attempt(trials, change, force), rejected: trials.rejected };
  }

  /**
   * Explicit ids first, then what --branch, --path and --kind name. A column align picked by
   * --kind alone aligns on the rightmost shape, so nothing moves left. `picked`: ids only a
   * selector named; align skips those that would leave their frame.
   */
  private resolveSelection<T extends FormatOp>(op: T): { op: T; picked: Set<string> } {
    const none = { op, picked: new Set<string>() };
    if (op.op !== 'place' && op.op !== 'align' && op.op !== 'color' && op.op !== 'tidy') return none;
    if (!op.path && !op.kind && !op.branch) return none;
    if (!this.planes.length) throw this.noDiagram();
    const shapeOf = (id: string): DShape | undefined => this.planes.map((p) => p.shapes.get(id)).find((s) => !!s);
    const ids = new ElementSelector(this.doc).select(op, {
      shapesOnly: op.op !== 'color',
      drawn: (id) => this.planes.some((p) => p.shapes.has(id) || p.edges.has(id)),
      centreX: (id) => {
        const s = shapeOf(id);
        return s ? cx(s.bounds) : undefined;
      },
    });
    const explicit = new Set(op.ids ?? []);
    const picked = new Set(ids.filter((id) => !explicit.has(id)));
    if (op.op === 'align' && !op.to && !op.ids?.length && !op.path && !op.branch && op.axis === 'column') {
      const right = [...ids].sort((a, b) => cx(shapeOf(b)?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) - cx(shapeOf(a)?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }))[0];
      return { op: { ...op, ids, ...(right ? { to: right } : {}) }, picked };
    }
    return { op: { ...op, ids }, picked };
  }

  private runOne(entry: FormatEntry, asFile: boolean): FormatResult | undefined {
    const index = entry.index;
    const resolved = entry.op.op === 'order' ? { op: entry.op, picked: new Set<string>() } : this.resolveSelection(entry.op);
    const op = resolved.op;
    if (op.op === 'order' && !new Reordering(this.doc, op).ordersBands()) return undefined;
    const snap = this.snapshot();
    const notes: string[] = [];
    let rerouted: string[] = [];
    const extra: Partial<FormatResult> = {};
    switch (op.op) {
      case 'place':
        rerouted = op.side ? new PlaceAction(this, op, snap, notes).run() : new RoomHint(this, op, asFile).run(() => new PlaceAction(this, op, snap, notes).run());
        break;
      case 'align':
        rerouted = new RoomHint(this, op, asFile).run(() => new AlignAction(this, op, snap, notes, resolved.picked).run());
        break;
      case 'color':
        extra.colored = new ColorAction(this, op).run();
        break;
      case 'label': {
        const r = new LabelAction(this, op, snap, notes).run();
        extra.labels = r.labels;
        rerouted = r.rerouted;
        break;
      }
      case 'route':
        rerouted = new RouteAction(this, op).run();
        break;
      case 'space':
        rerouted = new SpaceAction(this, op, snap, notes).run();
        break;
      case 'tidy':
        rerouted = new TidyAction(this, op, snap, notes).run();
        break;
      case 'compact':
        rerouted = new CompactAction(this, op, snap, notes).run();
        break;
      case 'order':
        rerouted = new OrderAction(this, op, snap, notes).run();
        break;
    }
    const routed = unique(rerouted);
    const reshaped = snap.changedEdges().filter((id) => !routed.includes(id));
    return { op: op.op, index, moved: snap.changedShapes(), rerouted: routed, ...(reshaped.length ? { reshaped } : {}), ...extra, ...(notes.length ? { notes } : {}) };
  }
}
