import type { BpmnElement } from '../../../model/index.js';

export class DuplicateDiGuard {
  private readonly before: Map<string, number>;

  constructor(definitions: BpmnElement) {
    this.before = DuplicateDiGuard.counts(definitions);
  }

  private static counts(definitions: BpmnElement): Map<string, number> {
    const counts = new Map<string, number>();
    for (const diagram of definitions.list('diagrams')) {
      const plane = diagram.peek<BpmnElement>('plane');
      for (const planeElement of plane?.list('planeElement') ?? []) {
        const id = planeElement.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
        if (id) {
          const key = `${plane?.peek<string>('id') ?? '?'}|${id}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    return counts;
  }

  assertNone(definitions: BpmnElement): void {
    for (const [key, count] of DuplicateDiGuard.counts(definitions)) {
      if (count > Math.max(1, this.before.get(key) ?? 0)) {
        const [plane, id] = key.split('|');
        throw new Error(`internal: the incremental layout drew ${id} twice on ${plane}`);
      }
    }
  }
}
