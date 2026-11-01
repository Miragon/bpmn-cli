import type { DrawingReport, FormatResult } from '../drawing/index.js';
import type { OperationRun } from '../edit/index.js';
import { type Change, type Finding, type FindingCounts, Findings, type ValidatorIssue } from '../model/index.js';
import type { LayoutProblem, ScoreChange, ScoreSummary } from '../scoring/index.js';
import type { HostDelta } from './FindingDelta.js';
import type { IdRenames, RenamedId } from './IdRenames.js';

export interface ScoreDifference {
  before?: ScoreSummary;
  after: ScoreSummary;
  added: LayoutProblem[];
  resolved: LayoutProblem[];
}

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
  score: ScoreDifference;
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
  addedErrors: readonly Finding[];
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
    const { before, after, added, resolved } = score;
    const { created, changed, removed, notes } = run.changes;
    return {
      xml,
      unchanged: xml === input,
      created,
      changed,
      removed,
      renamed: renames.list(),
      aliases: run.aliases,
      findings: [...this.ofTheChange(), ...host.added, ...drawing.warnings.map(Findings.ofLayout)],
      preexisting: host.preexisting,
      state: Findings.countOf(checks),
      score: { ...(before ? { before } : {}), after, added, resolved },
      format: drawing.format,
      notes: [...notes, ...drawing.notes],
    };
  }

  private ofTheChange(): Finding[] {
    const { run, checks, addedErrors } = this.parts;
    const touched = new Set(run.changes.touchedIds());
    const added = new Set(addedErrors);
    const found = checks.filter((finding) => added.has(finding) || (finding.element !== undefined && touched.has(finding.element)));
    const reported = new Set(found.map(WriteOutcome.findingKey));
    return [...run.changes.warnings.filter((warning) => !reported.has(WriteOutcome.findingKey(warning))), ...found];
  }
}
