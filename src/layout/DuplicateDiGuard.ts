import type { El } from '../model/utils/moddle.js';
import { idOf, raw, rawList } from '../diagram/utils/plane.js';

/** Invariant: the run never gives an element a second DI element on one plane (duplicates the file already had are left alone). */
export class DuplicateDiGuard {
  private readonly before: Map<string, number>;

  constructor(defs: El) {
    this.before = DuplicateDiGuard.counts(defs);
  }

  assertNone(defs: El): void {
    for (const [key, n] of DuplicateDiGuard.counts(defs)) {
      if (n > Math.max(1, this.before.get(key) ?? 0)) throw new Error(`internal: the incremental layout drew ${key.split('|')[1]} twice on ${key.split('|')[0]}`);
    }
  }

  /** Number of BPMNShapes / BPMNEdges per plane and element (`plane id|element id`). */
  private static counts(defs: El): Map<string, number> {
    const out = new Map<string, number>();
    for (const diagram of rawList(defs, 'diagrams')) {
      const planeDi = raw<El>(diagram, 'plane');
      for (const pe of rawList(planeDi, 'planeElement')) {
        const id = idOf(raw(pe, 'bpmnElement'));
        if (!id) continue;
        const key = `${idOf(planeDi) ?? '?'}|${id}`;
        out.set(key, (out.get(key) ?? 0) + 1);
      }
    }
    return out;
  }
}
