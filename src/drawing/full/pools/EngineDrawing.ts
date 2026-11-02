import { DocumentReader, DocumentWriter, type BpmnDocument, type BpmnElement, type Box, type LayoutRequests } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import { Semantics } from '../../plane/Semantics.js';
import { CleanEngine } from './CleanEngine.js';

export interface Block {
  box: Box;
  shapes: PlaneShape[];
  edges: PlaneEdge[];
  planes: Plane[];
}

export class EngineDrawing {
  private static readonly MAX_DEPTH = 50;

  private constructor(
    readonly planes: Plane[],
    readonly semantics: Semantics,
  ) {}

  static async of(document: BpmnDocument, expansions: LayoutRequests): Promise<EngineDrawing> {
    const copy = await new DocumentReader().read(await new DocumentWriter().plain(document));
    new CleanEngine(copy, copy.diagram.expandedIds(expansions.expansion())).run();
    const { definitions } = copy.tree;
    const semantics = Semantics.of(definitions);
    return new EngineDrawing(new PlaneReader(definitions, semantics).planes(), semantics);
  }

  private static poolContent(plane: Plane, rootId: string): Pick<Block, 'shapes' | 'edges'> {
    const shapes = [...plane.shapes.values()].filter((shape) => shape.id !== rootId && shape.poolId === rootId);
    const inside = new Set(shapes.map((shape) => shape.id));
    const edges = [...plane.edges.values()].filter((edge) => edge.kind !== 'messageFlow' && ((edge.sourceId && inside.has(edge.sourceId)) || (edge.targetId && inside.has(edge.targetId))));
    return { shapes, edges };
  }

  block(rootId: string, pool: boolean): Block | undefined {
    const plane = this.planes.find((candidate) => candidate.shapes.has(rootId));
    const root = plane?.shapes.get(rootId);
    if (!plane || !root) {
      return undefined;
    }
    const { shapes, edges } = pool ? EngineDrawing.poolContent(plane, rootId) : plane.contentOf(rootId);
    const planes = this.planes.filter((other) => other !== plane && this.belongsTo(other, rootId, pool));
    return { box: root.bounds.copy(), shapes, edges, planes };
  }

  private belongsTo(plane: Plane, rootId: string, pool: boolean): boolean {
    if (pool) {
      return this.semantics.poolOfProcess.get(this.processOfScope(plane.rootId)?.peek<string>('id') ?? '') === rootId;
    }
    return this.descendantOf(plane.rootId, rootId);
  }

  private descendantOf(id: string, ancestor: string): boolean {
    let scope = this.semantics.scopeOf.get(id);
    for (let depth = 0; scope && depth < EngineDrawing.MAX_DEPTH; depth++) {
      if (scope.peek<string>('id') === ancestor) {
        return true;
      }
      scope = this.semantics.scopeOf.get(scope.peek<string>('id') ?? '');
    }
    return false;
  }

  private processOfScope(id: string): BpmnElement | undefined {
    let element = this.semantics.byId.get(id);
    for (let depth = 0; element && depth < EngineDrawing.MAX_DEPTH && !element.is('bpmn:Process'); depth++) {
      element = this.semantics.scopeOf.get(element.peek<string>('id') ?? '');
    }
    return element;
  }
}
