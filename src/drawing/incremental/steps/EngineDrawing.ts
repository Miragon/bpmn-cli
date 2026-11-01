import { DocumentReader, DocumentWriter, type Box, type BpmnDocument, type BpmnElement, type LayoutRequests } from '../../../model/index.js';
import { FullLayout } from '../../full/FullLayout.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import { Semantics } from '../../plane/Semantics.js';

export interface Block {
  box: Box;
  shapes: DShape[];
  edges: DEdge[];
  planes: Plane[];
}

export class EngineDrawing {
  private static readonly MAX_DEPTH = 50;

  private constructor(
    readonly planes: Plane[],
    private readonly semantics: Semantics,
  ) {}

  static async of(document: BpmnDocument, expansions: LayoutRequests): Promise<EngineDrawing> {
    const drawn = await new DocumentReader().read(await new DocumentWriter().plain(document));
    new FullLayout(drawn, expansions).draw();
    const semantics = Semantics.of(drawn.tree.definitions);
    return new EngineDrawing(new PlaneReader(drawn.tree.definitions, semantics).planes(), semantics);
  }

  block(rootId: string, pool: boolean): Block | undefined {
    const plane = this.planes.find((candidate) => candidate.shapes.has(rootId));
    const root = plane?.shapes.get(rootId);
    if (!plane || !root) {
      return undefined;
    }
    const { shapes, edges } = pool ? this.poolContent(plane, rootId) : plane.contentOf(rootId);
    const planes = this.planes.filter((other) => other !== plane && (pool ? this.semantics.poolOfProcess.get(this.processOfScope(other.rootId)?.peek<string>('id') ?? '') === rootId : this.descendantOf(other.rootId, rootId)));
    return { box: root.bounds.copy(), shapes, edges, planes };
  }

  private poolContent(plane: Plane, poolId: string): { shapes: DShape[]; edges: DEdge[] } {
    const shapes = [...plane.shapes.values()].filter((shape) => shape.id !== poolId && shape.poolId === poolId);
    const inside = new Set(shapes.map((shape) => shape.id));
    const edges = [...plane.edges.values()].filter(({ kind, sourceId, targetId }) => kind !== 'messageFlow' && ((!!sourceId && inside.has(sourceId)) || (!!targetId && inside.has(targetId))));
    return { shapes, edges };
  }

  private descendantOf(id: string, ancestor: string): boolean {
    let scope = this.semantics.scopeOf.get(id);
    for (let depth = 0; scope && depth < EngineDrawing.MAX_DEPTH; depth++) {
      const scopeId = scope.peek<string>('id');
      if (scopeId === ancestor) {
        return true;
      }
      scope = this.semantics.scopeOf.get(scopeId ?? '');
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
