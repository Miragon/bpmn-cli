import { is, type El } from '../model/utils/moddle.js';
import { DiagramReader } from './DiagramReader.js';
import type { Semantics } from './Semantics.js';
import { idOf, raw, rawList } from './utils/raw.js';

/** Deletes DI that no longer shows what it should. */
export class DiPruner {
  /**
   * Deletes DI whose semantic element is gone (or is not the element registered under its id)
   * and diagrams whose root is gone; returns the ids of the deleted DI's elements.
   */
  static prune(defs: El, sem: Semantics): string[] {
    const pruned: string[] = [];
    const diagrams = rawList(defs, 'diagrams');
    for (let diagramIndex = diagrams.length - 1; diagramIndex >= 0; diagramIndex--) {
      const plane = raw<El>(diagrams[diagramIndex], 'plane');
      // bpmn-js shows the first process / collaboration on a plane without bpmnElement: keep it
      const root = raw<El>(plane, 'bpmnElement') ?? (plane ? DiagramReader.displayRoot(defs) : undefined);
      const rootId = idOf(root);
      if (!plane || !root || !rootId || sem.byId.get(rootId) !== root) {
        diagrams.splice(diagramIndex, 1);
        continue;
      }
      const elements = rawList(plane, 'planeElement');
      for (let index = elements.length - 1; index >= 0; index--) {
        const pe = elements[index];
        const target = raw<El>(pe, 'bpmnElement');
        const id = idOf(target);
        if (target && id && sem.byId.get(id) === target) continue;
        elements.splice(index, 1);
        pruned.push(id ?? idOf(pe) ?? '?');
      }
    }
    return pruned.reverse();
  }

  /**
   * Deletes every BPMNEdge `stale` names (`further`: its diagram shows a root an earlier diagram
   * already shows, a second view); returns the ids of their elements in document order.
   */
  static pruneEdges(defs: El, stale: (edge: El, plane: El, further: boolean) => boolean): string[] {
    const pruned: string[] = [];
    const shown = new Set<string>();
    for (const diagram of rawList(defs, 'diagrams')) {
      const plane = raw<El>(diagram, 'plane');
      const rootId = idOf(raw<El>(plane, 'bpmnElement') ?? (plane ? DiagramReader.displayRoot(defs) : undefined));
      if (!plane || !rootId) continue;
      const further = shown.has(rootId);
      shown.add(rootId);
      const elements = rawList(plane, 'planeElement');
      for (let index = 0; index < elements.length; index++) {
        const pe = elements[index]!;
        if (!is(pe, 'bpmndi:BPMNEdge') || !stale(pe, plane, further)) continue;
        elements.splice(index--, 1);
        pruned.push(idOf(raw(pe, 'bpmnElement')) ?? idOf(pe) ?? '?');
      }
    }
    return pruned;
  }
}
