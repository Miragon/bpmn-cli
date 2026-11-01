import { BpmnError, type BpmnDocument, type BpmnElement, type ErrorDetails } from '../../model/index.js';
import { ElementHomes, ProblemReport, Scorer, type LayoutProblem, type LayoutScore } from '../../scoring/index.js';
import { Drawing } from '../incremental/Drawing.js';
import { OperationBefore } from '../incremental/OperationBefore.js';
import type { DEdge } from '../plane/DEdge.js';
import type { DShape } from '../plane/DShape.js';
import { Plane } from '../plane/Plane.js';
import { PlaneReader } from '../plane/PlaneReader.js';
import { PlaneWriter } from '../plane/PlaneWriter.js';
import { Semantics } from '../plane/Semantics.js';
import { TrialGuard } from '../plane/TrialGuard.js';
import type { Attempt } from './compaction/Compactor.js';

export interface PlaneGuard {
  attempt: Attempt;
  rejected: LayoutProblem[];
}

export class DrawnDiagram {
  private static readonly SHOWN_PROBLEMS = 3;

  readonly semantics: Semantics;
  readonly planes: Plane[];
  private readonly drawings = new Map<Plane, Drawing>();
  private homes: ElementHomes | undefined;

  constructor(readonly document: BpmnDocument) {
    this.semantics = Semantics.of(document.tree.definitions);
    this.planes = new PlaneReader(document.tree.definitions, this.semantics).planes();
  }

  static problemWords(problems: readonly LayoutProblem[]): string {
    const distinct = [...new Map(problems.map((problem) => [ProblemReport.identityOf(problem), problem])).values()];
    const shown = distinct.slice(0, DrawnDiagram.SHOWN_PROBLEMS).map((problem) => `${problem.kind} [${problem.ids.join(', ')}]`);
    return shown.join(', ') + (distinct.length > DrawnDiagram.SHOWN_PROBLEMS ? ', ...' : '');
  }

  private static isConnection(element: BpmnElement): boolean {
    return ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation'].some((type) => element.is(type));
  }

  write(): void {
    new PlaneWriter(this.document.tree).write(this.planes);
    this.document.tree.invalidate();
  }

  noDiagram(): BpmnError {
    return BpmnError.model('E_NO_DIAGRAM', 'The file has no diagram; drawing operations need one', { hint: 'Draw it first: `bpmn layout <file>`.' });
  }

  noShape(element: BpmnElement, id: string, what = 'shape'): BpmnError {
    return BpmnError.model('E_NO_SHAPE', `${id} has no ${what} in the diagram`, { element: id, hint: this.noShapeHint(element, id) });
  }

  drawnShape(id: string): { plane: Plane; shape: DShape } {
    const element = this.document.tree.require(id);
    if (!this.planes.length) {
      throw this.noDiagram();
    }
    for (const plane of this.planes) {
      const shape = plane.shapes.get(id);
      if (shape) {
        return { plane, shape };
      }
    }
    if (DrawnDiagram.isConnection(element)) {
      throw BpmnError.model('E_WRONG_KIND', `"${id}" is a connection, expected a shape`, { element: id, hint: 'Connections follow their ends; use `bpmn route` to route one again.' });
    }
    throw this.noShape(element, id);
  }

  drawnEdge(id: string, draw = false): { plane: Plane; edge: DEdge } {
    const element = this.document.tree.require(id, ['bpmn:SequenceFlow', 'bpmn:MessageFlow'], 'sequence or message flow');
    if (!this.planes.length) {
      throw this.noDiagram();
    }
    for (const plane of this.planes) {
      const edge = plane.edges.get(id);
      if (edge) {
        return { plane, edge };
      }
    }
    const plane = draw ? this.planeShowingEnds(element, id) : undefined;
    if (!plane) {
      throw this.noShape(element, id, 'connection');
    }
    const edge = PlaneReader.edgeOf(element, id);
    plane.edges.set(id, edge);
    return { plane, edge };
  }

  movableShape(id: string): { plane: Plane; shape: DShape } {
    const found = this.drawnShape(id);
    const { kind } = found.shape;
    if (kind === 'boundary') {
      throw this.boundaryFollowsHost(id, found.shape);
    }
    if (kind === 'participant' || kind === 'lane' || kind === 'group' || kind === 'other') {
      const hint = 'Pools and lanes are bands: `bpmn order <file> <collaborationId> <participantIds...>` reorders pools, `bpmn order <file> <poolId> <laneIds...>` reorders lanes, `bpmn space <file> --below <laneId>` makes one taller (`--by -row` smaller).';
      throw BpmnError.model('E_WRONG_KIND', `"${id}" is a ${kind === 'participant' ? 'pool' : kind}, expected a node, data element or annotation`, { element: id, hint });
    }
    return found;
  }

  samePlane(plane: Plane, other: Plane, id: string, referenceId: string): void {
    if (plane !== other) {
      const hint = 'Shapes inside a collapsed sub-process live on their own diagram; refer to elements of the same one (or expand the sub-process: `bpmn set <file> <subProcessId> expanded=true`).';
      throw BpmnError.model('E_DIFFERENT_DIAGRAM', `${id} and ${referenceId} are drawn on different diagrams`, { element: id, related: [referenceId], hint });
    }
  }

  drawing(plane: Plane): Drawing {
    const drawing = this.drawings.get(plane) ?? new Drawing(plane);
    this.drawings.set(plane, drawing);
    return drawing;
  }

  measure(): LayoutScore {
    return new Scorer().scoreDrawing(Plane.drawingsOf(this.planes), this.elementHomes());
  }

  snapshot(): OperationBefore {
    return new OperationBefore(this.planes.map((plane) => this.drawing(plane)));
  }

  guard(plane: Plane): PlaneGuard {
    const trials = new TrialGuard(this.planes, this.elementHomes());
    const drawing = this.drawing(plane);
    return { attempt: (change, force) => drawing.attempt(trials, change, force), rejected: trials.rejected };
  }

  private elementHomes(): ElementHomes {
    this.homes ??= new ElementHomes(this.document);
    return this.homes;
  }

  private noShapeHint(element: BpmnElement, id: string): string {
    if (element.is('bpmn:SequenceFlow') || element.is('bpmn:MessageFlow')) {
      return `It has no line: \`bpmn route <file> ${id}\` draws it, and so does the next model edit.`;
    }
    if (element.is('bpmn:Process')) {
      const pool = this.semantics.collaboration?.list('participants').find((participant) => participant.peek('processRef') === element);
      return pool ? `A process is drawn as its pool: use the participant id ${pool.peek<string>('id')}.` : 'A process without pool is the diagram itself; name the shapes inside it.';
    }
    return 'It is not drawn: the next model edit places it, `bpmn layout <file>` redraws all.';
  }

  private planeShowingEnds(element: BpmnElement, id: string): Plane | undefined {
    const { sourceId, targetId } = PlaneReader.edgeEnds(element);
    const showsBoth = (candidate: Plane | undefined): candidate is Plane => !!candidate && !!sourceId && !!targetId && candidate.shapes.has(sourceId) && candidate.shapes.has(targetId);
    const plane = element.is('bpmn:MessageFlow') ? this.semantics.homePlane(this.planes, id) : this.planes.find(showsBoth);
    return showsBoth(plane) ? plane : undefined;
  }

  private boundaryFollowsHost(id: string, { hostId }: DShape): BpmnError {
    const details: ErrorDetails = {
      element: id,
      ...(hostId ? { related: [hostId] } : {}),
      hint: `Place the host instead${hostId ? ` (${hostId})` : ''}; \`bpmn place <file> ${id} --side top|bottom\` moves it to the other border of its host, \`bpmn move <file> ${id} --on <activityId>\` attaches it elsewhere.`,
    };
    return BpmnError.model('E_WRONG_KIND', `"${id}" is a boundary event; it follows its host ${hostId ?? ''}`.trim(), details);
  }
}
