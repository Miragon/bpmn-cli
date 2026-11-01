import type { DrawingReport, FormatResult } from '../drawing/index.js';
import type { OperationRun } from '../edit/index.js';
import { type Change, type Finding, type FindingCounts, Findings, type ValidatorIssue } from '../model/index.js';
import type { ScoreChange } from '../scoring/index.js';
import type { HostDelta } from './FindingDelta.js';
import type { IdRenames, RenamedId } from './IdRenames.js';

export interface EditResult {
  xml: string;
  unchanged: boolean;
  created: Change[];
  changed: Change[];
  removed: Change[];
  renamed: RenamedId[];
  aliases: Record<string, string>;
  findings: Finding[];
  preexisting: ValidatorIssue[];
  state: FindingCounts;
  score: ScoreChange;
  format: FormatResult[];
  notes: string[];
}

export interface WriteOutcomeParts {
  input: string;
  xml: string;
  run: OperationRun;
  drawing: DrawingReport;
  renames: IdRenames;
  checks: readonly Finding[];
  host: HostDelta;
  score: ScoreChange;
}

export class WriteOutcome {
  constructor(private readonly parts: WriteOutcomeParts) {}

  private static findingKey({ code, element, related }: Finding): string {
    return `${code}|${element ?? ''}${code === 'W_EVENT_GATEWAY_TARGET' ? `|${related?.[0] ?? ''}` : ''}`;
  }

  result(): EditResult {
    const { input, xml, run, drawing, renames, checks, host, score } = this.parts;
    const { created, changed, removed, notes } = run.changes;
    return {
      xml,
      unchanged: xml === input,
      created,
      changed,
      removed,
      renamed: renames.list(),
      aliases: run.aliases,
      findings: [...this.atTouchedElements(), ...host.added, ...drawing.warnings.map(Findings.ofLayout)],
      preexisting: host.preexisting,
      state: Findings.countOf(checks),
      score,
      format: drawing.format,
      notes: [...notes, ...drawing.notes],
    };
  }

  private atTouchedElements(): Finding[] {
    const { run, checks } = this.parts;
    const touched = new Set(run.changes.touchedIds());
    const found = checks.filter(({ element }) => element !== undefined && touched.has(element));
    const reported = new Set(found.map(WriteOutcome.findingKey));
    return [...run.changes.warnings.filter((warning) => !reported.has(WriteOutcome.findingKey(warning))), ...found];
  }
}
