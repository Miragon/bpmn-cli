import type { Finding, Suggestion } from '../../api/index.js';
import { SuggestedCommand } from './SuggestedCommand.js';

export class FindingLines {
  static readonly FLOOD_MIN = 3;

  private static readonly FLOOD_IDS = 30;
  private static readonly NOT_A_RULE: ReadonlySet<string> = new Set(['W_LINT_UNAVAILABLE', 'W_LINT_FAILED', 'W_CONFIG_IGNORED', 'import-warning']);

  constructor(
    private readonly path: string,
    private readonly advisory: ReadonlySet<string> = new Set(),
  ) {}

  private static tag({ validator }: Finding): string {
    return validator ? `[${validator}] ` : '';
  }

  private static advisoryTag(finding: Finding): string {
    return finding.validator && finding.severity === 'error' ? `[${finding.validator} error] ` : FindingLines.tag(finding);
  }

  private static idsText(ids: readonly string[]): string {
    return ids.length > FindingLines.FLOOD_IDS ? `${ids.slice(0, FindingLines.FLOOD_IDS).join(', ')}, +${ids.length - FindingLines.FLOOD_IDS} more` : ids.join(', ');
  }

  private static grouped<TKey>(findings: readonly Finding[], keyOf: (finding: Finding) => TKey): Map<TKey, Finding[]> {
    const groups = new Map<TKey, Finding[]>();
    for (const finding of findings) {
      groups.set(keyOf(finding), [...(groups.get(keyOf(finding)) ?? []), finding]);
    }
    return groups;
  }

  private static elementsOf(findings: readonly Finding[]): string {
    return FindingLines.idsText(findings.map(({ element }) => element ?? '?'));
  }

  warnings(findings: readonly Finding[]): string[] {
    const groups = FindingLines.grouped(findings, (finding) => `${FindingLines.tag(finding)}${finding.code}`);
    return [...groups.values()].flatMap((group) => (group.length < FindingLines.FLOOD_MIN ? group.map((finding) => `warning ${this.line(finding, FindingLines.tag(finding))}`) : [`warning ${this.floodLine(group, FindingLines.tag(group[0]!), group[0]!.message)}`]));
  }

  forced(findings: readonly Finding[]): string[] {
    return findings.map((finding) => `forced ${FindingLines.tag(finding)}${finding.code}${finding.element ? ` ${finding.element}` : ''}: ${finding.message}`);
  }

  problems(findings: readonly Finding[]): string[] {
    const rulesOf = FindingLines.grouped(findings, (finding) => this.ruleKey(finding) ?? finding);
    return [...rulesOf.values()].flatMap((group) => {
      const first = group[0]!;
      const tag = this.isAdvisory(first) ? FindingLines.advisoryTag(first) : FindingLines.tag(first);
      return group.length < FindingLines.FLOOD_MIN ? group.map((finding) => this.line(finding, tag)) : [this.floodedRule(group, tag)];
    });
  }

  private isAdvisory({ validator }: Finding): boolean {
    return validator !== undefined && this.advisory.has(validator);
  }

  private ruleKey(finding: Finding): string | undefined {
    return this.isAdvisory(finding) && !FindingLines.NOT_A_RULE.has(finding.code) ? `${finding.validator}\n${finding.code}\n${finding.hint ?? ''}` : undefined;
  }

  private line(finding: Finding, tag: string): string {
    const { code, element, related, message } = finding;
    const relatedIds = related?.length ? ` [${related.join(', ')}]` : '';
    return `${tag}${code}${element ? ` ${element}` : ''}${relatedIds}: ${message}${this.remedy(finding)}`;
  }

  private floodLine(group: readonly Finding[], tag: string, message: string): string {
    return `${tag}${group[0]!.code} x${group.length} [${FindingLines.elementsOf(group)}]: ${message}${this.remedy(group[0]!)}`;
  }

  private floodedRule(group: readonly Finding[], tag: string): string {
    const messages = FindingLines.grouped(group, ({ message }) => message);
    const [message, same] = [...messages].reduce((best, candidate) => (candidate[1].length > best[1].length ? candidate : best));
    const others = messages.size - 1;
    const rest = group.length - same.length;
    const note = others ? ` (${same.length} of ${group.length}; ${rest} other${rest === 1 ? '' : 's'} with ${others} other message${others === 1 ? '' : 's'}, --json lists them)` : '';
    return `${tag}${group[0]!.code} x${group.length} [${FindingLines.elementsOf(same)}]: ${message}${note}${this.remedy(group[0]!)}`;
  }

  private remedy({ fix, hint }: { fix?: Suggestion | undefined; hint?: string | undefined }): string {
    const command = fix ? new SuggestedCommand(fix).line(this.path) : undefined;
    const remedy = command ?? hint;
    return remedy ? `  (${remedy})` : '';
  }
}
