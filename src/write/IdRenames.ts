import type { ChangeSet, Rename } from '../model/index.js';

export type RenamedId = Pick<Rename, 'from' | 'to' | 'takeover'>;

export class IdRenames {
  private readonly lasting = new Map<string, string>();
  private readonly takeovers: RenamedId[] = [];

  constructor(changes: ChangeSet) {
    for (const rename of changes.renames) {
      this.follow(rename);
    }
    const created = new Set(changes.created.map(({ id }) => id));
    for (const [from, to] of this.lasting) {
      if (from === to || created.has(to)) {
        this.lasting.delete(from);
      }
    }
  }

  private follow({ from, to, takeover }: Rename): void {
    const earlier = [...this.lasting].filter(([, now]) => now === from).map(([old]) => old);
    if (takeover) {
      earlier.forEach((old) => this.lasting.delete(old));
      this.takeovers.push({ from, to, takeover });
      return;
    }
    if (earlier.length) {
      earlier.forEach((old) => this.lasting.set(old, to));
    } else {
      this.lasting.set(from, to);
    }
  }

  list(): RenamedId[] {
    return [...[...this.lasting].map(([from, to]) => ({ from, to })), ...this.takeovers];
  }

  newIds(): ReadonlyMap<string, string> {
    return this.lasting;
  }
}
