/**
 * Format operations: diagram-only edits of a kept drawing ("format without
 * XML"). An agent names elements by id and says where they go; it never
 * writes coordinates.
 *
 * CONTRACT
 *  new FormatOps(doc).run(entries) (the public runFormatOps) runs, on the DI of `doc` and in the given
 *  (batch) order, the format ops (place, align, color, label, route, space,
 *  tidy) and the diagram part of lane `order` ops. The pipeline calls it
 *  after the semantic ops and the layout ran. Each op sees the drawing as the
 *  previous op left it; everything is written back once at the end. A failing
 *  op throws a CliError carrying its batch index (`details.op`), and the
 *  pipeline then writes nothing (all or nothing with the batch).
 *   - place: the ids move as one rigid group so that the first id (the
 *     reference) lands on the row (rowOf / below / above) and / or the column
 *     (columnOf / after / before) of another element. Rows and columns are
 *     centre lines; below / above / after / before keep one row / one gap of
 *     the drawing (spacingOf) and clear the element's unit (with boundary
 *     events). Boundary events, labels and the content of an expanded
 *     sub-process follow. With `side` (one id, a boundary event): the event
 *     moves to the top / bottom border of its host, to the spot nearest its
 *     centre that no other boundary event and no docking connection takes
 *     (E_NO_ROOM when none is left); its exception path drawn on the old
 *     side (the nodes only it leads to, beyond that border, in the host's
 *     own lane / pool / sub-process) is mirrored about the host's centre row
 *     (room made at the top of that frame, or at the bottom of a lane with a
 *     lane underneath, when the path would leave it) and the others give way
 *     (makeRoom); its outgoing flows are routed again.
 *   - align: every id moves on its own onto the centre line (row) or centre
 *     column of `to` (default: the first id, which then stays).
 *   - color: a SWATCHES colour (diagram/write.ts setSwatch) on shapes and edges;
 *     'default' removes every colour. The bioc / color namespaces are
 *     declared on the definitions when missing.
 *   - label: the external label box on one side of its element (diagram/LabelPlacer.ts
 *     labelOnSide: off lines, other labels and the titles of expanded
 *     sub-processes where possible, inside its frame below the title first;
 *     flows: edgeLabelAt), keeping the label's size. A label put above a
 *     shape in an expanded sub-process that has no room for it below the
 *     title gets room at the top of the sub-process first (space tool in
 *     frame mode: the content moves down, the sub-process grows; a note
 *     says so).
 *   - route: one flow routed again (diagram/EdgeRouter.ts routeEdge), `exit` / `entry`
 *     forcing the side it leaves / enters by. A sequence or message flow
 *     without a connection whose two ends are drawn on one plane (added, or
 *     its ends changed, with --no-layout) gets one there.
 *   - space: the space tool (diagram/SpaceTool.ts makeSpace) at the far edge of an
 *     element: `after` moves everything starting right of it (within its
 *     pool), `below` everything starting below it; pools, lanes and the
 *     sub-processes holding the element grow where the line crosses them,
 *     any other expanded sub-process crossing it moves as a whole or stays
 *     (anchored at the element). On a pool or lane the line is just inside
 *     its far edge, so the frame itself grows. `by`: 'column' (median task width + gap, default
 *     for after), 'row' (row spacing, default for below) or pixels.
 *   - tidy: diagram/Separation.ts tidy on the given shapes (default: every leaf shape
 *     of every diagram).
 *   - order (lanes): the lane bands of the owner follow the semantic lane
 *     order (ops/order.ts already reordered `laneSet.lanes`), stacked from
 *     the top of the first band, each keeping its height; nested lanes, lane
 *     members and the artifacts whose centre lies in a band move with it.
 *  place / align refuse (E_LEAVES_CONTAINER) when a moved shape would leave
 *  its innermost frame (expanded sub-process, lane, pool): its box before the
 *  frame's start (more than 10 px into a header), its centre in another lane or pool, or below a lane with a
 *  sibling lane underneath; past the right / bottom edge the frame grows
 *  (also for the shape's label). Then the moved shapes stay and the others
 *  give way (diagram/Separation.ts), first with the references fixed, else with them
 *  movable too; moved shapes still in conflict give way along the axis the
 *  request leaves free. The request must hold afterwards (row / column /
 *  side of the reference), no sub-process may have grown over a reference,
 *  no two shapes may overlap that did not before (a reference that stayed
 *  while its neighbours made room: then the references may move too), and
 *  a reference and its frames stay where they are: it is still inside
 *  every frame that held it, and none of its frames the moved shapes are not
 *  in has moved (a pool growing towards a reference in another pool would
 *  push that pool away), else E_NO_ROOM and nothing is written.
 *  After every geometric op: connections whose ends moved by the same
 *  offset are translated, connections now broken (diagram/EdgeRouter.ts brokenEdge)
 *  are routed again, named rerouted flows get their label placed again, a
 *  shape label a rerouted line runs over steps aside (keeping its side),
 *  and so does a label the op brought onto the title of an expanded
 *  sub-process that it was clear of before, to a spot off every title
 *  inside its sub-process or pool, else it stays (diagram/LabelPlacer.ts clearTitles;
 *  `space` widening a sub-process moves its centred title by half the
 *  added width).
 *  Result per op: {op, index, moved (shapes whose bounds changed), rerouted
 *  (connections routed again), colored?, labels?, notes?}.
 *  Refusals: E_NO_DIAGRAM (the file has no diagram), E_NO_SHAPE (the
 *  element is not drawn), E_DIFFERENT_DIAGRAM (reference on another diagram),
 *  E_WRONG_KIND (pool / lane / boundary event where a movable shape is
 *  needed, a task for `label`, ...), E_NO_LABEL (no name to place),
 *  E_INVALID_VALUE (label side the flow has no segment for),
 *  E_LEAVES_CONTAINER, E_NO_ROOM (after making room the requested row /
 *  column no longer holds, or a sub-process would grow over the reference).
 *  E_NO_ROOM of place / align carries one space-tool run that makes the
 *  room: a dry run on the drawing as the op found it tries space-tool runs
 *  (roomCandidates) each followed by the op, and of those that let it
 *  succeed the one with the best score is details.ops (the batch op) and,
 *  when the op found the file's own drawing (the first op of a batch of
 *  format ops only), details.command (`bpmn space <file> ...`); without
 *  one the hint names the shapes to move first.
 */
import type { Doc } from '../model/document.js';
import { CliError, type ErrorDetails } from '../shared/CliError.js';
import { modelError } from '../shared/utils/errors.js';
import { is, type El } from '../model/utils/moddle.js';
import { ordersLanes, ordersPools } from '../ops/order.js';
import type { FormatOp, OrderOp } from '../ops/types.js';
import type { Attempt } from './Compaction.js';
import { cx } from '../diagram/utils/geom.js';
import { isHardProblem, problemKey, type LayoutMetrics, type LayoutProblem } from '../diagram/utils/problems.js';
import { LayoutAnalysis } from '../diagram/LayoutAnalysis.js';
import { edgeEnds, edgeKind, idOf, raw, rawList } from '../diagram/utils/plane.js';
import { DiagramReader } from '../diagram/DiagramReader.js';
import { Semantics } from '../diagram/Semantics.js';
import type { DEdge, DShape, Plane } from '../diagram/types.js';
import { selection } from '../query/select.js';
import { PlaneWriter } from '../diagram/PlaneWriter.js';
import { Drawing } from '../diagram/Drawing.js';
import { DrawingSnapshot } from '../diagram/DrawingSnapshot.js';
import { TrialGuard, type TrialPolicy } from '../diagram/TrialGuard.js';
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
  /** index of the op in the batch */
  index: number;
  /** shapes whose bounds changed (moved, pushed aside, grown) */
  moved: string[];
  /** connections routed again */
  rerouted: string[];
  /** connections whose waypoints changed without being routed again (stretched or shortened by moves, the space tool, compact) */
  reshaped?: string[];
  /** color: elements whose colour changed */
  colored?: string[];
  /** label: elements whose label was placed */
  labels?: string[];
  notes?: string[];
}

export interface FormatEntry {
  op: FormatOp | OrderOp;
  index: number;
}

/** A change of one plane must not add a hard layout problem or raise the score (compact.ts Attempt). */
const GUARDED: TrialPolicy = { key: (p) => (isHardProblem(p) ? problemKey(p) : undefined), lower: false, rebase: false };

export class FormatOps {
  readonly sem: Semantics;
  readonly planes: Plane[];
  private readonly drawings = new Map<Plane, Drawing>();

  constructor(readonly doc: Doc) {
    this.sem = Semantics.of(doc.definitions);
    this.planes = new DiagramReader(doc.definitions, this.sem).planes();
  }

  /**
   * Runs the format ops of a batch on the drawing of `doc` (see module
   * contract). `asFile`: the drawing of `doc` is the file's (a batch of format
   * ops only): the first op's refusal may name a runnable command.
   */
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

  /** The connection of a flow; with `draw`, a flow without one whose two ends are drawn on one plane gets a new, unrouted one there (route). */
  drawnEdge(id: string, draw = false): { plane: Plane; edge: DEdge } {
    const el = this.doc.require(id, ['bpmn:SequenceFlow', 'bpmn:MessageFlow'], 'sequence or message flow');
    if (!this.planes.length) throw this.noDiagram();
    for (const plane of this.planes) {
      const edge = plane.edges.get(id);
      if (edge) return { plane, edge };
    }
    const ends = edgeEnds(el);
    const drawsBoth = (p: Plane | undefined): p is Plane => !!p && !!ends.sourceId && !!ends.targetId && p.shapes.has(ends.sourceId) && p.shapes.has(ends.targetId);
    const plane = !draw ? undefined : is(el, 'bpmn:MessageFlow') ? this.sem.homePlane(this.planes, id) : this.planes.find(drawsBoth);
    if (drawsBoth(plane)) {
      const edge: DEdge = { id, el, kind: edgeKind(el), ...ends, points: [] };
      plane.edges.set(id, edge);
      return { plane, edge };
    }
    throw this.noShape(el, id, 'connection');
  }

  private isConnectionEl(el: El): boolean {
    return is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');
  }

  /** A shape place / align may move: a flow node (not a boundary event), data element or annotation. */
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

  /** The current layout problems of the document (the planes written first). */
  measure(): LayoutMetrics {
    new PlaneWriter(this.doc.moddle, this.doc.definitions).write(this.planes);
    return LayoutAnalysis.of(this.doc.definitions);
  }

  /** What the drawing shows before an op. */
  snapshot(): DrawingSnapshot {
    return new DrawingSnapshot(this.planes.map((p) => this.drawing(p)));
  }

  /**
   * Runs changes of one plane that must not make the drawing worse (Drawing
   * attempt): after each change the connections it broke are routed again,
   * and the change is undone when it added a hard layout problem or raised
   * the score. `rejected` collects what the undone changes would have added.
   */
  guard(plane: Plane): { attempt: Attempt; rejected: LayoutProblem[] } {
    const trials = new TrialGuard(() => this.measure(), GUARDED);
    const d = this.drawing(plane);
    return { attempt: (change, force) => d.attempt(trials, change, force), rejected: trials.rejected };
  }

  /**
   * The ids of a format op with selectors (query/select.ts): explicit ids first, then
   * what --branch, --path and --kind name (connections for color only). An
   * align without explicit ids or `to` aligns on the first selected element,
   * with only --kind and --axis column on the rightmost one (nothing moves left).
   * `picked`: the ids only a selector named (align leaves those out that would
   * leave their frame, see alignOp).
   */
  private resolveSelection<T extends FormatOp>(op: T): { op: T; picked: Set<string> } {
    const none = { op, picked: new Set<string>() };
    if (op.op !== 'place' && op.op !== 'align' && op.op !== 'color' && op.op !== 'tidy') return none;
    if (!op.path && !op.kind && !op.branch) return none;
    if (!this.planes.length) throw this.noDiagram();
    const shapeOf = (id: string): DShape | undefined => this.planes.map((p) => p.shapes.get(id)).find((s) => !!s);
    const ids = selection(this.doc, op, {
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
    if (op.op === 'order' && !ordersLanes(this.doc, op) && !ordersPools(this.doc, op)) return undefined;
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
