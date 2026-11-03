import { PlaneReader, type Plane, type Semantics } from '../../drawing/index.js';
import { type BpmnDocument, DrawnPlane, ElementHomes, Kinds } from '../../model/index.js';
import { ProblemKinds, Scorer } from '../../scoring/index.js';
import { DiagramColumns, type PlaneShape } from './DiagramColumns.js';
import { DiagramViewText, type DiagramFacts, type PlaneRows, type RowFrame, type RowFrameKind } from './DiagramViewText.js';

export interface DiagramResult extends Omit<DiagramFacts, 'score'> {
  text: string;
  score: number | null;
}

export class DiagramView {
  readonly planes: Plane[];

  private readonly semantics: Semantics;

  constructor(private readonly document: BpmnDocument) {
    const reader = new PlaneReader(document.tree.definitions);
    this.semantics = reader.semantics;
    this.planes = reader.planes();
  }

  private static frameKind({ kind }: PlaneShape): RowFrameKind {
    return kind === 'participant' || kind === 'lane' ? kind : 'subProcess';
  }

  private static rootKind(plane: Plane): RowFrameKind {
    if (plane.root.is('bpmn:Collaboration')) {
      return 'collaboration';
    }
    return plane.root.is('bpmn:Process') ? 'process' : 'subProcess';
  }

  private static nameOf({ el }: PlaneShape): string | undefined {
    return el.peek<string>('name')?.replace(/\s+/g, ' ').trim() || undefined;
  }

  private static rowsOf(shapes: readonly PlaneShape[], tolerance: number): PlaneShape[][] {
    return DiagramColumns.clustered(shapes, 'y', tolerance).map((row) => row.sort((first, second) => first.bounds.center.x - second.bounds.center.x));
  }

  answer(): DiagramResult {
    if (!this.planes.some((plane) => plane.shapes.size + plane.edges.size > 0)) {
      return { text: 'no diagram: bpmn layout <file> draws one', score: null, counts: ProblemKinds.perKind(() => 0), problems: [], rows: [] };
    }
    const { score, counts, problems } = new Scorer().scoreDrawing(DrawnPlane.read(this.document), new ElementHomes(this.document));
    const result = { score, counts, problems, rows: this.planes.map((plane) => this.rowsOn(plane)) };
    return { text: new DiagramViewText(result).text(), ...result };
  }

  private rowsOn(plane: Plane): PlaneRows {
    const columns = new DiagramColumns(plane);
    const frames = [...plane.shapes.values()].filter(({ kind, container }) => kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && container));
    const parentOf = (shape: PlaneShape): string => this.parentOf(shape, plane);
    const members = new Map<string, PlaneShape[]>([[plane.rootId, []], ...frames.map((frame): [string, PlaneShape[]] => [frame.id, []])]);
    columns.nodes.forEach((shape) => members.get(parentOf(shape))?.push(shape));
    const { rowTol } = plane.spacing();
    const out: RowFrame[] = [];
    const visit = (id: string, kind: RowFrameKind, name: string | undefined, parent: string | undefined): void => {
      out.push(this.frame({ id, kind, name, parent }, DiagramView.rowsOf(members.get(id) ?? [], rowTol), columns));
      const inner = frames.filter((frame) => parentOf(frame) === id).sort((first, second) => first.bounds.y - second.bounds.y || first.bounds.x - second.bounds.x);
      inner.forEach((frame) => visit(frame.id, DiagramView.frameKind(frame), DiagramView.nameOf(frame), id));
    };
    visit(plane.rootId, DiagramView.rootKind(plane), plane.root.peek<string>('name') || undefined, undefined);
    const kept = out.filter((frame) => frame.kind !== 'collaboration' || frame.rows.length);
    const shown = kept.map((frame) => (kept.some(({ id }) => id === frame.parent) ? frame : { ...frame, parent: undefined }));
    return { id: plane.id, root: plane.rootId, columns: columns.count, gaps: columns.gaps, frames: shown };
  }

  private parentOf(shape: PlaneShape, plane: Plane): string {
    const drawn = (id: string | undefined): string | undefined => (id && plane.shapes.has(id) ? id : undefined);
    if (shape.kind === 'participant') {
      return plane.rootId;
    }
    if (shape.kind === 'lane') {
      return drawn(this.semantics.laneParent.get(shape.id)) ?? drawn(shape.poolId) ?? plane.rootId;
    }
    return drawn(shape.parentId) ?? drawn(shape.laneId) ?? drawn(shape.poolId) ?? plane.rootId;
  }

  private frame(frame: Pick<RowFrame, 'id' | 'kind' | 'name' | 'parent'>, shapeRows: readonly PlaneShape[][], columns: DiagramColumns): RowFrame {
    const gaps = shapeRows.flatMap((row, index) => {
      const before = row.flatMap((shape, position) => (position > 0 && shape.bounds.x - row[position - 1]!.bounds.right > columns.wide ? [position] : []));
      return before.length ? [{ row: index, before }] : [];
    });
    return {
      ...frame,
      rows: shapeRows.map((row) => row.map((shape) => ({ id: shape.id, kind: Kinds.labelOrType(shape.el), name: DiagramView.nameOf(shape) }))),
      columns: shapeRows.map((row) => row.map(({ id }) => columns.of.get(id) ?? 0)),
      gaps: gaps.length ? gaps : undefined,
    };
  }
}
