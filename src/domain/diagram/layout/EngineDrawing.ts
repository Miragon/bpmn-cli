import type { Doc } from '../../document/Doc.js';
import { is, parseXml, type El } from '../../document/utils/moddle.js';
import { DiagramReader } from '../di/DiagramReader.js';
import { Semantics } from '../di/Semantics.js';
import type { DEdge, DShape, Plane } from '../di/types.js';
import { copyBox, type Box } from '../utils/geom.js';
import { PlaneQuery } from '../di/PlaneQuery.js';
import { idOf } from '../utils/raw.js';
import { CleanEngine } from './clean/CleanEngine.js';
import { resolveExpanded } from '../utils/expansion.js';
import type { IncrementalOptions } from './incremental/IncrementalLayout.js';

/** A new expanded sub-process or pool with its content, copied from the engine drawing. */
export interface Block {
  box: Box;
  shapes: DShape[];
  edges: DEdge[];
  /** collapsed sub-processes inside the block */
  planes: Plane[];
}

/** What the clean engine draws for the document; the incremental layout takes blocks of it. */
export class EngineDrawing {
  private constructor(
    readonly planes: Plane[],
    readonly sem: Semantics,
  ) {}

  static async of(doc: Doc, opts: IncrementalOptions): Promise<EngineDrawing> {
    const model = await parseXml(await doc.toXml());
    const expanded = resolveExpanded(model, { expand: opts.expand ?? [], collapse: opts.collapse ?? [] });
    new CleanEngine(model, expanded).run();
    const sem = Semantics.of(model.definitions);
    return new EngineDrawing(new DiagramReader(model.definitions, sem).planes(), sem);
  }

  block(rootId: string, pool: boolean): Block | undefined {
    const plane = this.planes.find((candidate) => candidate.shapes.has(rootId));
    const root = plane?.shapes.get(rootId);
    if (!plane || !root) return undefined;
    let shapes: DShape[];
    let edges: DEdge[];
    if (pool) {
      shapes = [...plane.shapes.values()].filter((shape) => shape.id !== rootId && shape.poolId === rootId);
      const inside = new Set(shapes.map((shape) => shape.id));
      edges = [...plane.edges.values()].filter((edge) => edge.kind !== 'messageFlow' && ((edge.sourceId && inside.has(edge.sourceId)) || (edge.targetId && inside.has(edge.targetId))));
    } else {
      ({ shapes, edges } = PlaneQuery.contentOf(plane, rootId));
    }
    const planes = this.planes.filter((otherPlane) => otherPlane !== plane && (pool ? this.sem.poolOfProcess.get(idOf(this.processOfScope(otherPlane.rootId)) ?? '') === rootId : this.descendantOf(otherPlane.rootId, rootId)));
    return { box: copyBox(root.bounds), shapes, edges, planes };
  }

  private descendantOf(id: string, ancestor: string): boolean {
    let scope = this.sem.scopeOf.get(id);
    for (let depth = 0; scope && depth < 50; depth++) {
      if (idOf(scope) === ancestor) return true;
      scope = this.sem.scopeOf.get(idOf(scope) ?? '');
    }
    return false;
  }

  private processOfScope(id: string): El | undefined {
    let el: El | undefined = this.sem.byId.get(id);
    for (let depth = 0; el && depth < 50 && !is(el, 'bpmn:Process'); depth++) {
      el = this.sem.scopeOf.get(idOf(el) ?? '');
    }
    return el;
  }
}
