import { is, type El } from '../model/utils/moddle.js';
import { allIds, claimUnique, diStyles, namesRoot, rootDiId, styledId, type Style } from './utils/di-ids.js';
import { idOf, raw, rawList } from './utils/plane.js';

/** The DI ids of a document before a full redraw, to give the DI the engine writes the ids the file had (see utils/di-ids.ts). */
export class DiIdMemo {
  /** element id -> id of its BPMNShape / BPMNEdge */
  readonly shapes = new Map<string, string>();
  readonly edges = new Map<string, string>();
  /** per BPMNDiagram in document order: the id of the element its plane shows, the plane's and the diagram's id */
  readonly diagrams: Array<{ root?: string; plane?: string; diagram?: string }> = [];

  private constructor(
    /** the file's DI id styles (none: new DI takes the engine's form, `BPMNShape_<id>`) */
    readonly styles: { shape?: Style; edge?: Style },
  ) {}

  /** Records the DI ids of a document (before a full redraw replaces its DI). */
  static remember(defs: El): DiIdMemo {
    const memo = new DiIdMemo(diStyles(defs));
    for (const diagram of rawList(defs, 'diagrams')) {
      const plane = raw<El>(diagram, 'plane');
      memo.diagrams.push({ root: idOf(raw(plane, 'bpmnElement')), plane: idOf(plane), diagram: idOf(diagram) });
      for (const pe of rawList(plane, 'planeElement')) {
        const diId = idOf(pe);
        const elId = idOf(raw(pe, 'bpmnElement'));
        if (!diId || !elId) continue;
        const into = is(pe, 'bpmndi:BPMNShape') ? memo.shapes : is(pe, 'bpmndi:BPMNEdge') ? memo.edges : undefined;
        if (into && !into.has(elId)) into.set(elId, diId);
      }
    }
    return memo;
  }

  /** Gives the DI the engine wrote the ids the document had before (see the contract of utils/di-ids.ts). */
  restore(defs: El): void {
    const diagrams = rawList(defs, 'diagrams');
    const di = new Set<El>();
    for (const diagram of diagrams) {
      const plane = raw<El>(diagram, 'plane');
      di.add(diagram);
      if (plane) di.add(plane);
      for (const pe of rawList(plane, 'planeElement')) di.add(pe);
    }
    // every id but those of the new DI (they are given again)
    const taken = allIds(defs);
    for (const el of di) {
      const id = idOf(el);
      if (id) taken.delete(id);
    }
    // DI without an old id that is free: the id of its style (`base`), given once every old id is
    const fresh: Array<{ el: El; base: string }> = [];
    const claim = (el: El, wanted: string | undefined, base: string): void => {
      if (wanted && !taken.has(wanted)) {
        taken.add(wanted);
        el.set('id', wanted);
      } else fresh.push({ el, base });
    };
    const rootId = (kind: 'Plane' | 'Diagram', el: El, root: string | undefined): string => (root ? rootDiId(kind, root) : (idOf(el) ?? `BPMN${kind}_1`));
    const old = [...this.diagrams];
    const main = old[0];
    const derived = (o: { root?: string; plane?: string; diagram?: string }): boolean => !!o.root && (namesRoot('Plane', o.plane, o.root) || namesRoot('Diagram', o.diagram, o.root));
    const unmatched: El[] = [];
    for (const diagram of diagrams) {
      const plane = raw<El>(diagram, 'plane');
      const root = idOf(raw(plane, 'bpmnElement'));
      const i = old.findIndex((o) => o.root === root);
      if (i === -1) {
        unmatched.push(diagram);
        continue;
      }
      const [o] = old.splice(i, 1);
      if (plane) claim(plane, o!.plane, rootId('Plane', plane, root));
      claim(diagram, o!.diagram, rootId('Diagram', diagram, root));
    }
    for (const diagram of unmatched) {
      const plane = raw<El>(diagram, 'plane');
      const root = idOf(raw(plane, 'bpmnElement'));
      // only the main diagram takes over the ids of the old main diagram (its root changed, e.g. to a new collaboration)
      const o = diagram === diagrams[0] && main && old.includes(main) && !derived(main) ? main : undefined;
      if (o) old.splice(old.indexOf(o), 1);
      if (plane) claim(plane, o?.plane, rootId('Plane', plane, root));
      claim(diagram, o?.diagram, rootId('Diagram', diagram, root));
    }
    for (const diagram of diagrams) {
      for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
        const elId = idOf(raw(pe, 'bpmnElement'));
        if (!elId) continue;
        const kind = is(pe, 'bpmndi:BPMNShape') ? 'Shape' : is(pe, 'bpmndi:BPMNEdge') ? 'Edge' : undefined;
        if (!kind) continue;
        const wanted = (kind === 'Shape' ? this.shapes : this.edges).get(elId);
        const style = kind === 'Shape' ? this.styles.shape : this.styles.edge;
        claim(pe, wanted, styledId(style ?? 'bpmn', kind, elId));
      }
    }
    // the engine's ids that already are what their style gives first: a cut id never pushes one that needs no cut to `_2`
    const uncut = (f: { el: El; base: string }): boolean => idOf(f.el) === f.base;
    for (const { el, base } of [...fresh.filter(uncut), ...fresh.filter((f) => !uncut(f))]) el.set('id', claimUnique(taken, base));
  }
}
