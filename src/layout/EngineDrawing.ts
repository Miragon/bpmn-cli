import type { Doc } from '../model/document.js';
import { is, parseXml, type El } from '../model/utils/moddle.js';
import { DiagramReader } from '../diagram/DiagramReader.js';
import { Semantics } from '../diagram/Semantics.js';
import type { DEdge, DShape, Plane } from '../diagram/types.js';
import { copyBox, type Box } from '../diagram/utils/geom.js';
import { contentOf, idOf } from '../diagram/utils/plane.js';
import { layoutClean } from './clean/engine.js';
import { resolveExpanded } from '../diagram/utils/expansion.js';
import type { IncrementalOptions } from './IncrementalLayout.js';

/** A part of the engine's drawing the incremental layout copies in: a new expanded sub-process or pool with its content. */
export interface Block {
  /** bounds of the block root in the engine drawing */
  box: Box;
  shapes: DShape[];
  edges: DEdge[];
  /** whole planes (collapsed sub-processes inside the block) */
  planes: Plane[];
}

/** What the clean engine draws for the document (the incremental layout takes blocks of it). */
export class EngineDrawing {
  private constructor(
    readonly planes: Plane[],
    readonly sem: Semantics,
  ) {}

  static async of(doc: Doc, opts: IncrementalOptions): Promise<EngineDrawing> {
    const model = await parseXml(await doc.toXml());
    const expanded = resolveExpanded(model, { expand: opts.expand ?? [], collapse: opts.collapse ?? [] });
    layoutClean(model, expanded);
    const sem = Semantics.of(model.definitions);
    return new EngineDrawing(new DiagramReader(model.definitions, sem).planes(), sem);
  }

  block(rootId: string, pool: boolean): Block | undefined {
    const plane = this.planes.find((p) => p.shapes.has(rootId));
    const root = plane?.shapes.get(rootId);
    if (!plane || !root) return undefined;
    let shapes: DShape[];
    let edges: DEdge[];
    if (pool) {
      shapes = [...plane.shapes.values()].filter((s) => s.id !== rootId && s.poolId === rootId);
      const inside = new Set(shapes.map((s) => s.id));
      edges = [...plane.edges.values()].filter((e) => e.kind !== 'messageFlow' && ((e.sourceId && inside.has(e.sourceId)) || (e.targetId && inside.has(e.targetId))));
    } else {
      ({ shapes, edges } = contentOf(plane, rootId));
    }
    const planes = this.planes.filter((p) => p !== plane && (pool ? this.sem.poolOfProcess.get(idOf(this.processOfScope(p.rootId)) ?? '') === rootId : this.descendantOf(p.rootId, rootId)));
    return { box: copyBox(root.bounds), shapes, edges, planes };
  }

  private descendantOf(id: string, ancestor: string): boolean {
    let scope = this.sem.scopeOf.get(id);
    for (let i = 0; scope && i < 50; i++) {
      if (idOf(scope) === ancestor) return true;
      scope = this.sem.scopeOf.get(idOf(scope) ?? '');
    }
    return false;
  }

  private processOfScope(id: string): El | undefined {
    let el: El | undefined = this.sem.byId.get(id);
    for (let i = 0; el && i < 50 && !is(el, 'bpmn:Process'); i++) el = this.sem.scopeOf.get(idOf(el) ?? '');
    return el;
  }
}
