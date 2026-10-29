import { is, type El } from '../../document/utils/moddle.js';
import { allIds, claimUnique, diStyles, namesRoot, rootDiId, styledId, type Style } from '../utils/di-ids.js';
import { idOf, raw, rawList } from '../utils/raw.js';

/** Remembers the DI ids before a full redraw and gives them back to the DI the engine writes. */
export class DiIdMemo {
  readonly shapes = new Map<string, string>();
  readonly edges = new Map<string, string>();
  /** per BPMNDiagram in document order */
  readonly diagrams: Array<{ root?: string; plane?: string; diagram?: string }> = [];

  private constructor(
    /** none: new DI takes the engine's form, `BPMNShape_<id>` */
    readonly styles: { shape?: Style; edge?: Style },
  ) {}

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

  /**
   * DI of elements that had none follows the file's DI id style.
   * DI without a free old id gets its style's id once every old id is given, uncut ids first, so a
   * cut id never pushes one that needs no cut to `_2`. A main diagram whose root changed (e.g. to a
   * new collaboration) keeps the old main ids.
   */
  restore(defs: El): void {
    const diagrams = rawList(defs, 'diagrams');
    const di = new Set<El>();
    for (const diagram of diagrams) {
      const plane = raw<El>(diagram, 'plane');
      di.add(diagram);
      if (plane) di.add(plane);
      for (const pe of rawList(plane, 'planeElement')) {
        di.add(pe);
      }
    }
    const taken = allIds(defs);
    for (const el of di) {
      const id = idOf(el);
      if (id) taken.delete(id);
    }
    const fresh: Array<{ el: El; base: string }> = [];
    const claim = (el: El, wanted: string | undefined, base: string): void => {
      if (wanted && !taken.has(wanted)) {
        taken.add(wanted);
        el.set('id', wanted);
      } else {
        fresh.push({ el, base });
      }
    };
    const rootId = (kind: 'Plane' | 'Diagram', el: El, root: string | undefined): string => (root ? rootDiId(kind, root) : (idOf(el) ?? `BPMN${kind}_1`));
    const old = [...this.diagrams];
    const main = old[0];
    const derived = (memo: { root?: string; plane?: string; diagram?: string }): boolean => !!memo.root && (namesRoot('Plane', memo.plane, memo.root) || namesRoot('Diagram', memo.diagram, memo.root));
    const unmatched: El[] = [];
    for (const diagram of diagrams) {
      const plane = raw<El>(diagram, 'plane');
      const root = idOf(raw(plane, 'bpmnElement'));
      const memoIndex = old.findIndex((memo) => memo.root === root);
      if (memoIndex === -1) {
        unmatched.push(diagram);
        continue;
      }
      const [matchedMemo] = old.splice(memoIndex, 1);
      if (plane) claim(plane, matchedMemo!.plane, rootId('Plane', plane, root));
      claim(diagram, matchedMemo!.diagram, rootId('Diagram', diagram, root));
    }
    for (const diagram of unmatched) {
      const plane = raw<El>(diagram, 'plane');
      const root = idOf(raw(plane, 'bpmnElement'));
      const reusedMemo = diagram === diagrams[0] && main && old.includes(main) && !derived(main) ? main : undefined;
      if (reusedMemo) old.splice(old.indexOf(reusedMemo), 1);
      if (plane) claim(plane, reusedMemo?.plane, rootId('Plane', plane, root));
      claim(diagram, reusedMemo?.diagram, rootId('Diagram', diagram, root));
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
    const uncut = (candidate: { el: El; base: string }): boolean => idOf(candidate.el) === candidate.base;
    for (const { el, base } of [...fresh.filter(uncut), ...fresh.filter((candidate) => !uncut(candidate))]) {
      el.set('id', claimUnique(taken, base));
    }
  }
}
