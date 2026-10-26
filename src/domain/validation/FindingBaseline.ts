import { Doc } from '../document/Doc.js';
import type { Warning } from '../document/CliError.js';
import { modelError } from '../document/utils/errors.js';
import type { El } from '../document/utils/moddle.js';
import type { EditCommand } from '../commands/types.js';
import { PlatformDetection, type PlatformChoice } from '../document/vendor/PlatformDetection.js';
import type { ProfileFinding } from '../document/utils/finding.js';
import { PLATFORM_PROFILES, type ProfileBaseline, type ProfileReport } from './profiles/PlatformProfiles.js';
import { StructuralValidator, type ValidationResult } from './StructuralValidator.js';
import { lintCoveredBy } from './utils/lint-coverage.js';
import { coveredLint, counts, keyOf, leftOutOf, lintKey, preexisting, validatorRefusal, withValidatorReports } from './utils/validator-issues.js';
import type { Validator, ValidatorContext, ValidatorIssue, ValidatorReport, ValidatorRun } from './validators.js';
import { ValidatorSet } from './ValidatorSet.js';
import { once } from './utils/once.js';

/** A mutation's validation findings compared with the document before the ops. */
export interface ValidationDelta {
  added: Warning[];
  resolved: Warning[];
  /** warnings the document already had and still has (`bpmn validate` lists them) */
  preexisting: number;
}

export interface BaselineOptions {
  platform?: PlatformChoice;
  force?: boolean;
  validators?: Validator[];
  file?: string;
  ops: readonly EditCommand[];
}

/**
 * Lint warnings about a group of elements, or about one element and a list of others:
 * the same finding while the group only shrinks.
 */
const GROUP_CODES = new Set(['W_DUPLICATE_NAME']);
const LIST_CODES = new Set(['W_BRANCH_NAME', 'W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN']);

/**
 * The findings a document had before an edit and what the edit did to them.
 * Only what the change introduced blocks the write and is reported; errors the document
 * already had become W_PREEXISTING_ERROR warnings.
 */
export class FindingBaseline {
  /** before pre-existing errors became W_PREEXISTING_ERROR */
  private raw: ValidationResult | undefined;
  private profileAfter: ProfileReport | undefined;
  private validation: ValidationResult | undefined;
  /** lint warnings the validators' resolved findings say again: listed once, as those findings */
  private readonly validatorCovered = new Set<string>();

  private constructor(
    private readonly doc: Doc,
    private readonly opts: BaselineOptions,
    private readonly before: ValidationResult,
    /** id -> element before the ops: an element renamed or retyped is still recognised */
    private readonly index: Map<string, El>,
    private readonly profile: ProfileBaseline,
    private readonly validators: ValidatorSet,
    private readonly context: Omit<ValidatorContext, 'doc' | 'phase'>,
    private readonly validatorsBefore: ValidatorRun[],
  ) {}

  static async capture(doc: Doc, opts: BaselineOptions): Promise<FindingBaseline> {
    const { errors, warnings } = new StructuralValidator(doc).validate();
    const profile = PLATFORM_PROFILES.baseline(doc, opts.platform);
    const index = new Map(doc.byId());
    const validators = new ValidatorSet(opts.validators);
    const context: Omit<ValidatorContext, 'doc' | 'phase'> = { ...(opts.file ? { file: opts.file } : {}), platform: validators.size ? PlatformDetection.of(doc).resolve(opts.platform ?? 'auto').platform : 'none', ops: opts.ops };
    const validatorsBefore = validators.size ? await validators.run({ xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...context, phase: 'before' }) : [];
    return new FindingBaseline(doc, opts, { errors, warnings }, index, doc.source ? profile : { report: { ...profile.report, findings: [] }, elements: [] }, validators, context, validatorsBefore);
  }

  /** The ops can change the platform (camunda: / zeebe: content), so its rules may load now. */
  async afterOps(): Promise<ValidationResult> {
    const validator = new StructuralValidator(this.doc);
    const raw = (this.raw = validator.validate());
    const structural = this.separatePreexisting(raw);
    await PLATFORM_PROFILES.ensure(this.doc, this.opts.platform);
    const after = (this.profileAfter = PLATFORM_PROFILES.run(this.doc, this.opts.platform));
    const delta = PLATFORM_PROFILES.delta(this.doc, this.profile, after);
    const validation = (this.validation = validator.withProfile(structural, after, delta.added, delta));
    if (validation.errors.length && !this.opts.force) {
      throw modelError('E_VALIDATION', `The change would introduce ${validation.errors.length} structural error(s); nothing was written`, {
        errors: validation.errors,
        hint: 'Fix the listed problems, make the edit in one transaction (`bpmn apply <file> ops.json`) so that it ends in a valid model, or pass --force to write anyway.',
      });
    }
    return validation;
  }

  /**
   * `candidate` is exactly what would be written. For a created document an advisory
   * validator reports everything it finds.
   */
  async onCandidate(candidate: string): Promise<ValidationResult> {
    const validation = this.validation!;
    if (!this.validators.size) return validation;
    const after = await this.validators.run({ xml: async () => candidate, doc: once(() => Doc.fromXml(candidate, this.opts.file)) }, { ...this.context, phase: 'after' });
    const reports = FindingBaseline.compareRuns(this.doc.source ? this.validatorsBefore : this.validatorsBefore.filter((run) => run.blocks !== false), after, this.renames());
    const introduced = reports.flatMap((report) => report.errors);
    if (introduced.length && !this.opts.force) throw validatorRefusal(introduced);
    reports.forEach((report, index) => {
      for (const issue of report.resolved) {
        const key = coveredLint(after[index]!, issue);
        if (key) this.validatorCovered.add(key);
      }
    });
    return (this.validation = withValidatorReports(validation, reports, after));
  }

  /**
   * Each finding is matched once. Undefined for a document created in memory: no warning
   * was already there. A lint warning a platform or validator finding repeats counts once.
   * Platform findings that are not new are only counted: the result lists the added ones.
   */
  delta(): ValidationDelta | undefined {
    if (!this.doc.source) return undefined;
    const raw = this.raw!;
    const final = this.validation!;
    const before = this.before.warnings;
    const remaining = [...raw.warnings];
    const platformResolved = final.platform?.resolved ?? [];
    const coveredByPlatform = lintCoveredBy(platformResolved);
    const covered = (warning: Warning): boolean => coveredByPlatform(warning) || this.validatorCovered.has(lintKey(warning));
    const resolved = before.filter((earlier) => !FindingBaseline.takeMatch(remaining, (candidate) => this.sameWarning(earlier, candidate)) && !raw.warnings.some((current) => this.stillAbout(earlier, current)) && !covered(earlier));
    const errors = [...raw.errors];
    resolved.push(...this.before.errors.filter((earlier) => !FindingBaseline.takeMatch(errors, (candidate) => this.sameFinding(earlier, candidate))));
    resolved.push(...platformResolved, ...(final.validators ?? []).flatMap((report) => report.resolved));
    const addedFindings = new Set<ProfileFinding>(final.platform?.added ?? []);
    const kept = (this.profileAfter?.findings ?? []).filter((finding) => !addedFindings.has(finding));
    const keptCount = final.platform ? Math.max(0, Object.values(final.platform.counts).reduce((sum, count) => sum + count, 0) - addedFindings.size) : 0;
    const coveredByKept = lintCoveredBy(kept);
    const pool = [...before];
    const added: Warning[] = [];
    let preexistingCount = keptCount;
    for (const warning of final.warnings) {
      if (warning.code === 'W_PREEXISTING_ERROR') preexistingCount++;
      else if (FindingBaseline.takeMatch(pool, (earlier) => this.sameWarning(earlier, warning))) preexistingCount += coveredByKept(warning) ? 0 : 1;
      else added.push(warning);
    }
    return { added, resolved, preexisting: preexistingCount };
  }

  /**
   * Findings match by code and element (renamed ids followed) or by `key`, else by message;
   * the n-th run of a name compares with the n-th run before. An advisory run reports its
   * introduced errors among the warnings. Left-out findings are counted, not compared.
   * Without a run before (a created document) nothing is compared and every finding is reported;
   * a finding the file had that is now left out stays in the result, not resolved.
   */
  static compareRuns(before: ValidatorRun[], after: ValidatorRun[], renames: Map<string, string> = new Map()): ValidatorReport[] {
    const rename = FindingBaseline.renamer(renames);
    const none = new Map<string, string>();
    const seen = new Map<string, number>();
    return after.map((run) => {
      const nth = seen.get(run.name) ?? 0;
      seen.set(run.name, nth + 1);
      const prev = before.filter((beforeRun) => beforeRun.name === run.name)[nth];
      const reasonOf = (issue: ValidatorIssue) => (prev ? leftOutOf(issue) : undefined);
      const left = (prev?.issues ?? []).filter((issue) => reasonOf(issue) === undefined).map((issue) => ({ issue, id: FindingBaseline.identity(issue, rename, renames) }));
      const blocking = run.blocks !== false;
      const report: ValidatorReport = { name: run.name, ...(run.detail ? { detail: run.detail } : {}), ...(blocking ? {} : { blocks: false as const }), errors: [], warnings: [], preexisting: [], resolved: [], counts: counts(run.issues) };
      const leftOut = new Map<string, number>();
      const marked: ValidatorIssue[] = [];
      for (const issue of run.issues) {
        const reason = reasonOf(issue);
        if (reason !== undefined) {
          leftOut.set(reason, (leftOut.get(reason) ?? 0) + 1);
          marked.push(issue);
          continue;
        }
        const id = FindingBaseline.identity(issue, (text) => text, none);
        const matchIndex = left.findIndex((entry) => entry.id === id && entry.issue.severity === issue.severity);
        if (matchIndex !== -1) {
          left.splice(matchIndex, 1);
          if (issue.severity === 'error' && blocking) report.preexisting.push(issue);
          continue;
        }
        if (issue.severity === 'error' && blocking) report.errors.push(issue);
        else report.warnings.push(issue);
      }
      for (const issue of marked) {
        const id = FindingBaseline.identity(issue, (text) => text, none);
        const matchIndex = left.findIndex((entry) => entry.id === id && entry.issue.severity === issue.severity);
        if (matchIndex !== -1) left.splice(matchIndex, 1);
      }
      report.resolved = left.map((entry) => entry.issue);
      if (leftOut.size) report.leftOut = [...leftOut].map(([reason, count]) => ({ reason, count }));
      return report;
    });
  }

  private separatePreexisting(after: ValidationResult): ValidationResult {
    const left = [...this.before.errors];
    const errors: Warning[] = [];
    const kept: Warning[] = [];
    for (const finding of after.errors) {
      const matchIndex = left.findIndex((earlier) => this.sameFinding(earlier, finding));
      if (matchIndex === -1) {
        errors.push(finding);
        continue;
      }
      left.splice(matchIndex, 1);
      kept.push(preexisting(finding));
    }
    return { errors, warnings: [...kept, ...after.warnings] };
  }

  private renames(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [id, el] of this.index) {
      const now = (el as unknown as { id?: unknown }).id;
      if (typeof now === 'string' && now !== id && this.doc.get(now) === el) out.set(id, now);
    }
    return out;
  }

  private sameFinding(before: Warning, after: Warning): boolean {
    if (before.code !== after.code) return false;
    if (before.element === after.element) return true;
    const was = before.element ? this.index.get(before.element) : undefined;
    return !!was && !!after.element && this.doc.get(after.element) === was;
  }

  private sameElement(before: string, after: string): boolean {
    if (before === after) return true;
    const was = this.index.get(before);
    return !!was && this.doc.get(after) === was;
  }

  /** A group or list warning is the same while it only shrinks; its first element may change. */
  private sameWarning(before: Warning, after: Warning): boolean {
    if (before.code !== after.code) return false;
    if (GROUP_CODES.has(after.code) || LIST_CODES.has(after.code)) {
      if (LIST_CODES.has(after.code) && !this.sameFinding(before, after)) return false;
      const had = FindingBaseline.membersOf(before);
      return FindingBaseline.membersOf(after).every((id) => had.some((hadId) => this.sameElement(hadId, id)));
    }
    if (!this.sameFinding(before, after)) return false;
    const relatedBefore = before.related ?? [];
    const relatedAfter = after.related ?? [];
    return relatedBefore.length === relatedAfter.length && relatedBefore.every((id, index) => this.sameElement(id, relatedAfter[index]!));
  }

  /** A group warning that still shares an element with `before` changed: it is not resolved. */
  private stillAbout(before: Warning, after: Warning): boolean {
    if (before.code !== after.code || !(GROUP_CODES.has(after.code) || LIST_CODES.has(after.code))) return false;
    if (LIST_CODES.has(after.code)) return this.sameFinding(before, after);
    const had = FindingBaseline.membersOf(before);
    return FindingBaseline.membersOf(after).some((id) => had.some((hadId) => this.sameElement(hadId, id)));
  }

  private static membersOf(warning: Warning): string[] {
    return GROUP_CODES.has(warning.code) ? [...(warning.element ? [warning.element] : []), ...(warning.related ?? [])] : (warning.related ?? []);
  }

  private static takeMatch<TItem>(pool: TItem[], match: (item: TItem) => boolean): boolean {
    const matchIndex = pool.findIndex(match);
    if (matchIndex === -1) return false;
    pool.splice(matchIndex, 1);
    return true;
  }

  /** Whole ids (XML NCName boundaries), in one pass: ids swapped in one batch stay apart. */
  private static renamer(renames: Map<string, string>): (text: string) => string {
    if (!renames.size) return (text) => text;
    const ids = [...renames.keys()].sort((first, second) => second.length - first.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(?<![\\w.-])(?:${ids.join('|')})(?![\\w.-])`, 'g');
    return (text) => text.replace(re, (id) => renames.get(id) ?? id);
  }

  private static identity(issue: ValidatorIssue, rename: (text: string) => string, renames: Map<string, string>): string {
    const key = keyOf(issue);
    if (key !== undefined) return `k|${issue.code}|${rename(key)}`;
    if (issue.element) return `e|${issue.code}|${renames.get(issue.element) ?? issue.element}`;
    return `m|${issue.code}|${rename(issue.message)}`;
  }
}
