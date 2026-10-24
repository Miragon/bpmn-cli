/**
 * Deleting DI that no longer shows what it should.
 *
 *  - pruneDi(defs, sem): deletes DI whose semantic element is gone (or is not
 *    the element registered under its id) and diagrams whose root is gone;
 *    returns the ids of the deleted DI's elements.
 *  - pruneEdges(defs, stale): deletes every BPMNEdge for which
 *    `stale(edge, plane, further)` is true (`further`: its diagram shows a
 *    root an earlier diagram already shows, a second view); returns the ids
 *    of their elements in document order. Used for the edges of flows whose
 *    ends changed (layout/Snapshot.ts pruneReEnded).
 */
import { is, type El } from '../../model/utils/moddle.js';
import type { Semantics } from '../Semantics.js';
import { displayRoot, idOf, raw, rawList } from './plane.js';

/** Deletes DI of elements that no longer exist (see module contract); returns their ids. */
export function pruneDi(defs: El, sem: Semantics): string[] {
  const pruned: string[] = [];
  const diagrams = rawList(defs, 'diagrams');
  for (let d = diagrams.length - 1; d >= 0; d--) {
    const plane = raw<El>(diagrams[d], 'plane');
    // a plane without bpmnElement shows the first process / collaboration (bpmn-js): kept, not deleted
    const root = raw<El>(plane, 'bpmnElement') ?? (plane ? displayRoot(defs) : undefined);
    const rootId = idOf(root);
    if (!plane || !root || !rootId || sem.byId.get(rootId) !== root) {
      diagrams.splice(d, 1);
      continue;
    }
    const elements = rawList(plane, 'planeElement');
    for (let i = elements.length - 1; i >= 0; i--) {
      const pe = elements[i];
      const target = raw<El>(pe, 'bpmnElement');
      const id = idOf(target);
      if (target && id && sem.byId.get(id) === target) continue;
      elements.splice(i, 1);
      pruned.push(id ?? idOf(pe) ?? '?');
    }
  }
  return pruned.reverse();
}

/** Deletes the BPMNEdges `stale` names (see module contract); returns their elements' ids. */
export function pruneEdges(defs: El, stale: (edge: El, plane: El, further: boolean) => boolean): string[] {
  const pruned: string[] = [];
  const shown = new Set<string>();
  for (const diagram of rawList(defs, 'diagrams')) {
    const plane = raw<El>(diagram, 'plane');
    const rootId = idOf(raw<El>(plane, 'bpmnElement') ?? (plane ? displayRoot(defs) : undefined));
    if (!plane || !rootId) continue;
    const further = shown.has(rootId);
    shown.add(rootId);
    const elements = rawList(plane, 'planeElement');
    for (let i = 0; i < elements.length; i++) {
      const pe = elements[i]!;
      if (!is(pe, 'bpmndi:BPMNEdge') || !stale(pe, plane, further)) continue;
      elements.splice(i--, 1);
      pruned.push(idOf(raw(pe, 'bpmnElement')) ?? idOf(pe) ?? '?');
    }
  }
  return pruned;
}
