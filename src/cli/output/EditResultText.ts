import type { Change, EditResult, Finding, FormatResult, ScoreDifference } from '../../api/index.js';
import { FindingLines } from './FindingLines.js';

export interface WriteReport {
  file: string;
  written: boolean;
  dryRun: boolean;
}

type ListedProblem = ScoreDifference['added'][number];

export class EditResultText {
  static readonly MAX_BYTES = 1024;

  private static readonly MAX_IDS = 8;
  private static readonly MAX_PROBLEMS = 6;

  private readonly findings: FindingLines;

  constructor(
    private readonly result: Omit<EditResult, 'xml'>,
    private readonly report: WriteReport,
  ) {
    this.findings = new FindingLines(report.file);
  }

  private static idList(ids: readonly string[]): string {
    return ids.length <= EditResultText.MAX_IDS ? ids.join(', ') : `${ids.slice(0, EditResultText.MAX_IDS).join(', ')} (+${ids.length - EditResultText.MAX_IDS} more)`;
  }

  private static createdLines(created: readonly Change[]): string[] {
    const kinds = new Map<string, string[]>();
    for (const { kind, id } of created) {
      kinds.set(kind, [...(kinds.get(kind) ?? []), id]);
    }
    return [...kinds].map(([kind, ids]) => `created ${kind}: ${EditResultText.idList(ids)}`);
  }

  private static formatLine({ op, index, colored = [], labels = [], moved, rerouted, notes = [] }: FormatResult): string {
    const parts = [
      ...(colored.length ? [`colored ${EditResultText.idList(colored)}`] : []),
      ...(labels.length ? [`label placed ${EditResultText.idList(labels)}`] : []),
      ...(moved.length ? [`moved ${EditResultText.idList(moved)}`] : []),
      ...(rerouted.length ? [`rerouted ${EditResultText.idList(rerouted)}`] : []),
    ];
    return `format ${op} #${index}: ${[...(parts.length ? parts : ['no change']), ...notes.map((note) => `note: ${note}`)].join('; ')}`;
  }

  private static problemText({ kind, ids, detail }: ListedProblem): string {
    return `${kind} ${ids.join(ids.length === 2 ? ' x ' : ', ')}${detail ? ` ${detail}` : ''}`;
  }

  private static problemList(problems: readonly ListedProblem[]): string {
    const shown = problems.slice(0, EditResultText.MAX_PROBLEMS).map(EditResultText.problemText).join(', ');
    return problems.length > EditResultText.MAX_PROBLEMS ? `${shown} (+${problems.length - EditResultText.MAX_PROBLEMS} more)` : shown;
  }

  private static counted(count: number, what: string): string {
    return `${count} ${what}${count === 1 ? '' : 's'}`;
  }

  private static bytes(lines: readonly string[]): number {
    return Buffer.byteLength(lines.join('\n'));
  }

  private static fitted(head: readonly string[], tail: readonly string[]): string[] {
    const reserve = `... ${head.length} more lines (--json lists them)`;
    const room = EditResultText.MAX_BYTES - EditResultText.bytes([...tail, reserve]);
    const kept: string[] = [];
    for (const line of head) {
      if (EditResultText.bytes([...kept, line]) >= room) {
        return [...kept, `... ${head.length - kept.length} more lines (--json lists them)`, ...tail];
      }
      kept.push(line);
    }
    return [...kept, ...tail];
  }

  text(): string {
    const tail = [this.scoreLine(), this.stateLine(), ...this.fileLines()];
    return EditResultText.fitted(this.headLines(), tail).join('\n');
  }

  private headLines(): string[] {
    const { created, changed, removed, renamed, aliases, format, notes, findings } = this.result;
    const createdIds = new Set(created.map(({ id }) => id));
    const changedIds = this.result.unchanged ? [] : [...new Set(changed.map(({ id }) => id))].filter((id) => !createdIds.has(id));
    const changes = [
      ...EditResultText.createdLines(created),
      ...(Object.keys(aliases).length ? [`aliases: ${Object.entries(aliases).map(([alias, id]) => `${alias} = ${id}`).join(', ')}`] : []),
      ...(changedIds.length ? [`changed: ${EditResultText.idList(changedIds)}`] : []),
      ...(renamed.length ? [`renamed: ${renamed.map(({ from, to }) => `${from} -> ${to}`).join(', ')}`] : []),
      ...(removed.length ? [`removed: ${EditResultText.idList(removed.map(({ id }) => id || '(no id)'))}`] : []),
      ...format.map(EditResultText.formatLine),
    ];
    const nothingListed = this.result.unchanged ? 'no changes' : 'drawing changed';
    return [...(changes.length ? changes : [nothingListed]), ...this.findingLines(findings), ...notes.map((note) => `note: ${note}`)];
  }

  private findingLines(findings: readonly Finding[]): string[] {
    const isError = ({ severity }: Finding): boolean => severity === 'error';
    return [...this.findings.forced(findings.filter(isError)), ...this.findings.warnings(findings.filter((finding) => !isError(finding)))];
  }

  private scoreLine(): string {
    const { before, after, added, resolved } = this.result.score;
    return `layout quality: ${[
      before ? `score ${before.score} -> ${after.score}` : `score ${after.score}`,
      ...(added.length ? [`${before ? 'added' : 'problems'}: ${EditResultText.problemList(added)}`] : []),
      ...(resolved.length ? [`resolved: ${EditResultText.problemList(resolved)}`] : []),
    ].join('; ')}`;
  }

  private stateLine(): string {
    const { errors, warnings } = this.result.state;
    return `state: ${EditResultText.counted(errors, 'error')}, ${EditResultText.counted(warnings, 'warning')} (bpmn validate lists them and runs the project's lint)`;
  }

  private fileLines(): string[] {
    const { file, written, dryRun } = this.report;
    const { unchanged } = this.result;
    if (written) {
      return [`written: ${file}${unchanged ? ' (unchanged copy of the input)' : ''}`];
    }
    if (unchanged && !dryRun) {
      return [`unchanged: ${file} (the result equals the file; nothing written)`];
    }
    return [`dry run: ${file} not written${unchanged ? ' (unchanged)' : ''}`];
  }
}
