import type { Doc } from '../document/Doc.js';
import type { CliError, ErrorDetails } from '../document/CliError.js';
import { modelError } from '../document/utils/errors.js';
import { is, type El } from '../document/utils/moddle.js';
import type { Attempt } from './format/CompactionService.js';
import { isHardProblem, problemKey, type LayoutMetrics, type LayoutProblem } from './utils/problems.js';
import { LayoutAnalysis } from './di/LayoutAnalysis.js';
import { idOf, raw, rawList } from './utils/raw.js';
import { DiagramReader } from './di/DiagramReader.js';
import { Semantics } from './di/Semantics.js';
import type { DEdge, DShape, Plane } from './di/types.js';
import { PlaneWriter } from './di/PlaneWriter.js';
import { Drawing } from './layout/incremental/Drawing.js';
import { DrawingSnapshot } from './layout/incremental/DrawingSnapshot.js';
import { TrialGuard, type TrialPolicy } from './di/TrialGuard.js';
import { RoomService } from './format/RoomService.js';

/** A change of one plane must not add a hard layout problem or raise the score. */
const GUARDED: TrialPolicy = { key: (problem) => (isHardProblem(problem) ? problemKey(problem) : undefined), lower: false, rebase: false };

/**
 * The drawing of a document as the diagram commands change it: its planes, one drawing per
 * plane, and the refusals when an element is not drawn. write() puts the planes back.
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

}
