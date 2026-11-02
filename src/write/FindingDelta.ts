import type { Finding, ValidatorIssue } from '../model/index.js';
import type { ValidatorRun } from './HostValidators.js';

export interface HostDelta {
  added: ValidatorIssue[];
  blocking: ValidatorIssue[];
  preexisting: ValidatorIssue[];
}

type Comparable = Pick<Finding, 'code' | 'element' | 'key' | 'message'>;

export class FindingDelta {
  constructor(private readonly renames: ReadonlyMap<string, string>) {}

  private static take<TItem>(pool: TItem[], match: (item: TItem) => boolean): boolean {
    const index = pool.findIndex(match);
    if (index === -1) {
      return false;
    }
    pool.splice(index, 1);
    return true;
  }

  private static hostIdentity({ code, element, key, message }: Comparable, rename: (text: string) => string): string {
    if (key !== undefined) {
      return `key|${code}|${rename(key)}`;
    }
    return element ? `element|${code}|${rename(element)}` : `message|${code}|${rename(message)}`;
  }

  private static same(text: string): string {
    return text;
  }

  newErrors(errors: readonly Finding[], before: readonly Finding[]): Finding[] {
    const known = before.map(({ code, element }) => `${code}|${element && this.renamed(element)}`);
    return errors.filter(({ code, element }) => !FindingDelta.take(known, (earlier) => earlier === `${code}|${element}`));
  }

  ofHostValidators(before: readonly ValidatorRun[], after: readonly ValidatorRun[]): HostDelta {
    const delta: HostDelta = { added: [], blocking: [], preexisting: [] };
    const seen = new Map<string, number>();
    for (const run of after) {
      const nth = seen.get(run.name) ?? 0;
      seen.set(run.name, nth + 1);
      this.compareRun(before.filter(({ name }) => name === run.name)[nth], run, delta);
    }
    return delta;
  }

  private compareRun(earlier: ValidatorRun | undefined, run: ValidatorRun, delta: HostDelta): void {
    const rename = this.renamer();
    const left = (earlier?.issues ?? []).map((issue) => ({ issue, identity: FindingDelta.hostIdentity(issue, rename) }));
    const blocks = run.blocks !== false;
    for (const issue of run.issues) {
      const identity = FindingDelta.hostIdentity(issue, FindingDelta.same);
      const known = FindingDelta.take(left, (entry) => entry.identity === identity && entry.issue.severity === issue.severity);
      const isBlockingError = blocks && issue.severity === 'error';
      if (!known) {
        delta.added.push(issue);
        if (isBlockingError) {
          delta.blocking.push(issue);
        }
      } else if (isBlockingError) {
        delta.preexisting.push(issue);
      }
    }
  }

  private renamed(id: string): string {
    return this.renames.get(id) ?? id;
  }

  private renamer(): (text: string) => string {
    if (!this.renames.size) {
      return FindingDelta.same;
    }
    const ids = [...this.renames.keys()].sort((first, second) => second.length - first.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const wholeIds = new RegExp(`(?<![\\w.-])(?:${ids.join('|')})(?![\\w.-])`, 'g');
    return (text) => text.replace(wholeIds, (id) => this.renamed(id));
  }
}
