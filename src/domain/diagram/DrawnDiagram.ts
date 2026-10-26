import type { Doc } from '../document/Doc.js';
import { CliError, type ErrorDetails } from '../document/CliError.js';
import { modelError } from '../document/utils/errors.js';
import { is, type El } from '../document/utils/moddle.js';
import { isHardProblem, problemKey, type LayoutMetrics, type LayoutProblem } from './utils/problems.js';
import { LayoutAnalysis } from './di/LayoutAnalysis.js';
import { idOf, raw, rawList } from './utils/raw.js';
import { DiagramReader } from './di/DiagramReader.js';
import { Semantics } from './di/Semantics.js';
import type { DEdge, DShape, Plane, Side } from './di/types.js';
import { PlaneWriter } from './di/PlaneWriter.js';
import { Drawing } from './layout/incremental/Drawing.js';
import { DrawingSnapshot } from './layout/incremental/DrawingSnapshot.js';
import { TrialGuard, type TrialPolicy } from './di/TrialGuard.js';
import { RoomService } from './format/RoomService.js';
import { CompactionService, type Attempt } from './format/CompactionService.js';
import type { AlignShapes, ColorElements, CompactDiagram, PlaceLabel, RerouteFlow, TidyShapes } from '../commands/types.js';
import { setSwatch } from './utils/colors.js';
import { frameWord, outermost, problemWords, unique } from './utils/frames.js';
import { copyPoints, cx, cy, inside, sameBox, samePoints, type Box } from './utils/geom.js';
import { attachedSide } from './utils/sides.js';
import { Frames } from './di/Frames.js';
import { edgeLabelAt, hasExternalLabel, labelAt } from './utils/labels.js';
import { labelSize } from './utils/text.js';

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** A change of one plane must not add a hard layout problem or raise the score. */
const GUARDED: TrialPolicy = { key: (problem) => (isHardProblem(problem) ? problemKey(problem) : undefined), lower: false, rebase: false };

/**
 * The drawing of a document as the diagram commands change it: its planes, one drawing per
 * plane, the refusals when an element is not drawn, and the commands that need no service
 * of their own (color, route, tidy, align, label, compact). write() puts the planes back.
 */
export class DrawnDiagram {
  readonly sem: Semantics;
  readonly planes: Plane[];
  private readonly drawings = new Map<Plane, Drawing>();

  constructor(readonly doc: Doc) {
    this.sem = Semantics.of(doc.definitions);
    this.planes = new DiagramReader(doc.definitions, this.sem).planes();
  }

  write(): void {
    new PlaneWriter(this.doc.moddle, this.doc.definitions).write(this.planes);
    this.doc.invalidate();
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
      const pool = rawList(this.sem.collaboration, 'participants').find((participant) => raw(participant, 'processRef') === el);
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
    const drawsBoth = (candidate: Plane | undefined): candidate is Plane => !!candidate && !!ends.sourceId && !!ends.targetId && candidate.shapes.has(ends.sourceId) && candidate.shapes.has(ends.targetId);
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
    const shape = found.shape;
    if (shape.kind === 'boundary') {
      throw modelError('E_WRONG_KIND', `"${id}" is a boundary event; it follows its host ${shape.hostId ?? ''}`.trim(), { element: id, ...(shape.hostId ? { related: [shape.hostId] } : {}), hint: `Place the host instead${shape.hostId ? ` (${shape.hostId})` : ''}; \`bpmn place <file> ${id} --side top|bottom\` moves it to the other border of its host, \`bpmn move <file> ${id} --on <activityId>\` attaches it elsewhere.` });
    }
    if (shape.kind === 'participant' || shape.kind === 'lane' || shape.kind === 'group' || shape.kind === 'other') {
      throw modelError('E_WRONG_KIND', `"${id}" is a ${shape.kind === 'participant' ? 'pool' : shape.kind}, expected a node, data element or annotation`, {
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
    let drawing = this.drawings.get(plane);
    if (!drawing) this.drawings.set(plane, (drawing = new Drawing(plane)));
    return drawing;
  }

  room(plane: Plane): RoomService {
    return new RoomService(plane, this.drawing(plane));
  }

  measure(): LayoutMetrics {
    new PlaneWriter(this.doc.moddle, this.doc.definitions).write(this.planes);
    return LayoutAnalysis.of(this.doc.definitions);
  }

  snapshot(): DrawingSnapshot {
    return new DrawingSnapshot(this.planes.map((plane) => this.drawing(plane)));
  }

  /**
   * Changes of one plane are undone when they add a hard layout problem or raise the score.
   * `rejected` collects what the undone changes would have added.
   */
  guard(plane: Plane): { attempt: Attempt; rejected: LayoutProblem[] } {
    const trials = new TrialGuard(() => this.measure(), GUARDED);
    const drawing = this.drawing(plane);
    return { attempt: (change, force) => drawing.attempt(trials, change, force), rejected: trials.rejected };
  }

  colorElements(command: ColorElements): string[] {
    const colored: string[] = [];
    const swatch = command.color === 'default' ? undefined : command.color;
    for (const id of unique(command.ids ?? [])) {
      const el = this.doc.require(id);
      if (!this.planes.length) throw this.noDiagram();
      const shape = this.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found);
      const edge = shape ? undefined : this.planes.map((plane) => plane.edges.get(id)).find((found) => !!found);
      const di = shape?.di ?? edge?.di;
      if (!di) throw this.noShape(el, id, 'shape or connection');
      if (setSwatch(di, swatch)) colored.push(id);
    }
    if (swatch && colored.length) {
      this.doc.declareNamespace('bioc');
      this.doc.declareNamespace('color');
    }
    return colored;
  }

  /** A side forced on a boundary event that points into its host would run through the host. */
  private refuseIntoHost(plane: Plane, endId: string | undefined, side: Side | undefined, role: 'exit' | 'entry', flowId: string): void {
    const end = endId ? plane.shapes.get(endId) : undefined;
    const host = end?.hostId ? plane.shapes.get(end.hostId) : undefined;
    if (!end || !host || !side) return;
    const border = attachedSide(end.bounds, host.bounds);
    if (side !== OPPOSITE[border]) return;
    throw modelError('E_INVALID_VALUE', `--${role} ${side} would run ${flowId} through ${host.id}: ${end.id} sits on the ${border} border of its host`, {
      element: flowId,
      related: [end.id, host.id],
      hint: `A boundary event's flow leaves away from its host: use --${role} ${border}${border === 'bottom' || border === 'top' ? ', left or right' : ', top or bottom'}.`,
    });
  }

  rerouteFlow(command: RerouteFlow): string[] {
    const { plane, edge } = this.drawnEdge(command.id, true);
    this.refuseIntoHost(plane, edge.sourceId, command.exit, 'exit', command.id);
    this.refuseIntoHost(plane, edge.targetId, command.entry, 'entry', command.id);
    const before = copyPoints(edge.points);
    const ok = this.drawing(plane).reroute(edge, { ...(command.exit ? { sourceSides: [command.exit] } : {}), ...(command.entry ? { targetSides: [command.entry] } : {}) });
    if (!ok) {
      if (!edge.di) plane.edges.delete(command.id);
      throw modelError('E_NO_SHAPE', `${command.id} cannot be routed: an end has no shape in its diagram`, { element: command.id, hint: 'Run `bpmn layout <file>` to draw the missing shapes.' });
    }
    this.drawing(plane).clearLabels([edge]);
    return samePoints(before, edge.points) ? [] : [command.id];
  }

  removeOverlaps(command: TidyShapes, snap: DrawingSnapshot, notes: string[]): string[] {
    if (!this.planes.length) throw this.noDiagram();
    const byPlane = new Map<Plane, string[]>();
    if (command.ids) {
      for (const id of unique(command.ids)) {
        const { plane } = this.drawnShape(id);
        byPlane.set(plane, [...(byPlane.get(plane) ?? []), id]);
      }
    } else for (const plane of this.planes) byPlane.set(plane, []);
    const rerouted: string[] = [];
    for (const [plane, ids] of byPlane) {
      const tidied = this.drawing(plane).tidy(ids.length ? { ids } : {});
      if (tidied.unresolved.length) notes.push(`overlap left: ${tidied.unresolved.map(([first, second]) => `${first}~${second}`).join(', ')}`);
      rerouted.push(...this.drawing(plane).settle(snap));
    }
    return rerouted;
  }

  /** A `picked` member that would leave its frame is skipped; an explicit id is refused. */
  alignShapes(command: AlignShapes, snap: DrawingSnapshot, notes: string[], picked: ReadonlySet<string> = new Set()): string[] {
    const refId = command.to ?? command.ids?.[0] ?? "";
    const { plane, shape: ref } = this.drawnShape(refId);
    const items = unique(command.ids ?? [])
      .filter((id) => id !== refId)
      .map((id) => this.movableShape(id));
    for (const item of items) this.samePlane(plane, item.plane, item.shape.id, refId);
    const shapes = outermost(plane, items.map((item) => item.shape));
    const moves = shapes.map((shape) => ({ shape, dx: command.axis === 'column' ? Math.round(cx(ref.bounds) - cx(shape.bounds)) : 0, dy: command.axis === 'row' ? Math.round(cy(ref.bounds) - cy(shape.bounds)) : 0 }));
    const kept: typeof moves = [];
    const left: string[] = [];
    for (const move of moves) {
      try {
        this.room(plane).checkFrames([move.shape], move.dx, move.dy, `in the ${command.axis} of ${refId}`, [ref]);
        kept.push(move);
      } catch (err) {
        if (!(err instanceof CliError) || err.code !== 'E_LEAVES_CONTAINER' || !picked.has(move.shape.id)) throw err;
        const frame = plane.shapes.get(err.details.related?.[0] ?? '');
        left.push(`${move.shape.id}${frame ? ` (${frameWord(frame)} ${frame.id})` : ''}`);
      }
    }
    if (left.length) notes.push(`left out ${left.join(', ')}: on the ${command.axis} of ${refId} ${left.length > 1 ? 'they' : 'it'} would leave ${left.length > 1 ? 'their frames' : 'its frame'}`);
    const moved = kept.filter((move) => move.dx || move.dy);
    if (!moved.length) {
      if (!left.length || kept.length) notes.push(`already aligned on the ${command.axis} of ${refId}`);
      return [];
    }
    for (const move of moved) this.drawing(plane).shift(move.shape.id, move.dx, move.dy);
    const line = (box: Box): number => (command.axis === 'column' ? cx(box) : cy(box));
    const holds = (): boolean => moved.every((move) => Math.abs(line(move.shape.bounds) - line(ref.bounds)) <= 1);
    this.room(plane).makeRoom(moved.map((move) => move.shape), [ref], snap, notes, `on the ${command.axis} of ${refId}`, holds, [command.axis === 'column' ? 'x' : 'y']);
    return this.drawing(plane).settle(snap);
  }

  /**
   * Above a shape at the top of a sub-process the title takes the room, so room is made below it
   * first.
   */
  placeLabel(command: PlaceLabel, snap: DrawingSnapshot, notes: string[]): { labels: string[]; rerouted: string[] } {
    const el = this.doc.require(command.id);
    const name = raw<string>(el, 'name')?.trim();
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) {
      const { edge } = this.drawnEdge(command.id);
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
    const { plane, shape } = this.drawnShape(command.id);
    if (!hasExternalLabel(shape)) {
      throw modelError('E_WRONG_KIND', `"${command.id}" has no external label (tasks, sub-processes, pools and lanes carry their name inside the shape)`, {
        element: command.id,
        hint: 'Labels can be placed for events, gateways, data objects / stores and flows.',
      });
    }
    if (!name) throw modelError('E_NO_LABEL', `${command.id} has no name, so it has no label`, { element: command.id, hint: `Name it first: \`bpmn set <file> ${command.id} name=...\`.` });
    const { width, height } = shape.label ?? labelSize(name);
    const size = { width, height };
    let box = this.drawing(plane).labelOnSide(shape, command.side, size);
    let rerouted: string[] = [];
    const frame = shape.kind === 'boundary' ? undefined : Frames.of(plane, shape);
    const room = command.side === 'above' && frame?.kind === 'subProcess' && !inside(box, Frames.labelArea(frame)) ? this.drawing(plane).roomBelowTitle(frame, labelAt(shape, size, 'above'), shape.id) : undefined;
    if (room) {
      rerouted = this.drawing(plane).settle(snap);
      notes.push(`made ${room.delta} px of room above ${command.id} in its sub-process ${frame!.id} (for the label, below the title)`);
      box = this.drawing(plane).labelOnSide(shape, command.side, size);
    }
    const changed = !sameBox(shape.label, box);
    shape.label = box;
    return { labels: changed ? [command.id] : [], rerouted };
  }

  /** A diagram's own root (a process without pool, a drill-down) targets the whole diagram. */
  private compactionTargets(ids: readonly string[]): Map<Plane, Set<string> | undefined> {
    const out = new Map<Plane, Set<string> | undefined>();
    for (const id of unique(ids)) {
      this.doc.require(id);
      if (!this.planes.length) throw this.noDiagram();
      const root = this.planes.find((plane) => plane.rootId === id);
      if (root && !root.shapes.has(id)) {
        out.set(root, undefined);
        continue;
      }
      const { plane, shape } = this.drawnShape(id);
      if (!shape.container) {
        throw modelError('E_WRONG_KIND', `"${id}" is not a pool, lane or expanded sub-process`, {
          element: id,
          hint: 'compact takes frames: participant ids, lane ids, expanded sub-process ids (or no id for the whole drawing); to close one gap use `bpmn space <file> --after <id> --by -column`.',
        });
      }
      if (out.has(plane) && out.get(plane) === undefined) continue;
      out.set(plane, new Set([...(out.get(plane) ?? []), id]));
    }
    return out;
  }

  compactDiagram(command: CompactDiagram, snap: DrawingSnapshot, notes: string[]): string[] {
    if (!this.planes.length) throw this.noDiagram();
    const targets = command.ids ? this.compactionTargets(command.ids) : new Map(this.planes.map((plane) => [plane, undefined] as const));
    const rerouted: string[] = [];
    const total = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
    const rejected: LayoutProblem[] = [];
    for (const [plane, only] of targets) {
      const guard = this.guard(plane);
      const stats = new CompactionService(this.drawing(plane)).compact({ ...(only ? { only } : {}), attempt: guard.attempt });
      for (const axis of ['x', 'y'] as const) {
        total.strips[axis] += stats.strips[axis];
        total.px[axis] += stats.px[axis];
      }
      total.refused += stats.refused;
      rejected.push(...guard.rejected);
      rerouted.push(...this.drawing(plane).settle(snap));
    }
    const closedStrips = total.strips.x + total.strips.y;
    if (!closedStrips) notes.push('nothing to compact: no empty row or column to close');
    else {
      const part = (count: number, px: number, what: string): string[] => (count ? [`${count} empty ${what}${count > 1 ? 's' : ''} (${px} px)`] : []);
      notes.push(`closed ${[...part(total.strips.x, total.px.x, 'column'), ...part(total.strips.y, total.px.y, 'row')].join(' and ')}`);
    }
    if (rejected.length) notes.push(`left ${total.refused} gap${total.refused > 1 ? 's' : ''} open: closing ${total.refused > 1 ? 'them' : 'it'} would add ${problemWords(rejected)}`);
    return rerouted;
  }
}
