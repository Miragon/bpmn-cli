import type { Doc } from '../document/Doc.js';
import type { Finding } from '../document/Finding.js';
import type { El } from '../document/utils/moddle.js';

/**
 * Lint warnings about a group of elements, or about one element and a list of others:
 * the same finding while the group only shrinks.
 */
const GROUP_CODES = new Set(['W_DUPLICATE_NAME']);
const LIST_CODES = new Set(['W_BRANCH_NAME', 'W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN']);

export interface MatchRules {
  bySubject?: boolean;
  reusedIdIsNew?: boolean;
}

/**
 * Tells a finding before an edit from the same finding after it: by code and element, an
 * element renamed or retyped still recognised by the element itself.
 */
export class FindingMatcher {
  constructor(
    /** id -> element before the edit */
    private readonly before: ReadonlyMap<string, El>,
    private readonly doc: Doc,
    private readonly rules: MatchRules = {},
  ) {}

  same(before: Finding, after: Finding): boolean {
    if (before.code !== after.code) return false;
    if (this.rules.bySubject && (before.subject ?? '') !== (after.subject ?? '')) {
      return false;
    }
    return this.sameElementOf(before.element, after.element);
  }

  /** A group or list warning is the same while it only shrinks; its first element may change. */
  sameWarning(before: Finding, after: Finding): boolean {
    if (before.code !== after.code) return false;
    if (GROUP_CODES.has(after.code) || LIST_CODES.has(after.code)) {
      if (LIST_CODES.has(after.code) && !this.same(before, after)) return false;
      const had = FindingMatcher.membersOf(before);
      return FindingMatcher.membersOf(after).every((id) => had.some((hadId) => this.sameElementOf(hadId, id)));
    }
    if (!this.same(before, after)) return false;
    const relatedBefore = before.related ?? [];
    const relatedAfter = after.related ?? [];
    return relatedBefore.length === relatedAfter.length && relatedBefore.every((id, index) => this.sameElementOf(id, relatedAfter[index]));
  }

  /** A group warning that still shares an element with `before` changed: it is not resolved. */
  stillAbout(before: Finding, after: Finding): boolean {
    if (before.code !== after.code || !(GROUP_CODES.has(after.code) || LIST_CODES.has(after.code))) {
      return false;
    }
    if (LIST_CODES.has(after.code)) return this.same(before, after);
    const had = FindingMatcher.membersOf(before);
    return FindingMatcher.membersOf(after).some((id) => had.some((hadId) => this.sameElementOf(hadId, id)));
  }

  /** Each finding is matched at most once. */
  delta<TFinding extends Finding>(before: readonly TFinding[], after: readonly TFinding[]): { added: TFinding[]; resolved: TFinding[] } {
    const resolved = [...before];
    const added = after.filter((finding) => !FindingMatcher.take(resolved, (earlier) => this.same(earlier, finding)));
    return { added, resolved };
  }

  renames(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [id, el] of this.before) {
      const now = (el as unknown as { id?: unknown }).id;
      if (typeof now === 'string' && now !== id && this.doc.get(now) === el) {
        out.set(id, now);
      }
    }
    return out;
  }

  static take<TItem>(pool: TItem[], match: (item: TItem) => boolean): boolean {
    const matchIndex = pool.findIndex(match);
    if (matchIndex === -1) return false;
    pool.splice(matchIndex, 1);
    return true;
  }

  /**
   * A validator finding's identity: its `key`, else code and element (renamed ids followed),
   * else its message. Ids are replaced as whole ids (XML NCName boundaries), in one pass:
   * ids swapped in one batch stay apart.
   */
  static identityAcross(renames: ReadonlyMap<string, string>): (finding: Finding) => string {
    const rename = FindingMatcher.renamer(renames);
    return (finding) => {
      if (finding.key !== undefined) {
        return `k|${finding.code}|${rename(finding.key)}`;
      }
      if (finding.element) {
        return `e|${finding.code}|${renames.get(finding.element) ?? finding.element}`;
      }
      return `m|${finding.code}|${rename(finding.message)}`;
    };
  }

  private sameElementOf(before: string | undefined, after: string | undefined): boolean {
    const was = before ? this.before.get(before) : undefined;
    if (this.rules.reusedIdIsNew) {
      const now = after ? this.doc.get(after) : undefined;
      return was && now ? was === now : before === after;
    }
    return before === after || (!!was && !!after && this.doc.get(after) === was);
  }

  private static membersOf(finding: Finding): string[] {
    return GROUP_CODES.has(finding.code) ? [...(finding.element ? [finding.element] : []), ...(finding.related ?? [])] : (finding.related ?? []);
  }

  private static renamer(renames: ReadonlyMap<string, string>): (text: string) => string {
    if (!renames.size) return (text) => text;
    const ids = [...renames.keys()].sort((first, second) => second.length - first.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(?<![\\w.-])(?:${ids.join('|')})(?![\\w.-])`, 'g');
    return (text) => text.replace(re, (id) => renames.get(id) ?? id);
  }
}
