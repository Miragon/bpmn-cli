import { Doc } from '../document/Doc.js';
import type { Finding } from '../document/Finding.js';
import { modelError } from '../document/utils/errors.js';
import type { EditCommand } from '../commands/types.js';
import { PlatformDetection, type PlatformChoice } from '../document/vendor/PlatformDetection.js';
import type { ProfileFinding } from '../document/Finding.js';
import { PLATFORM_PROFILES, type ProfileReport } from './profiles/PlatformProfiles.js';
import { StructuralValidator, type ValidationResult } from './StructuralValidator.js';
import { coveredLint, lintCoveredBy, lintKey } from './utils/finding-coverage.js';
import { counts, preexisting, validatorRefusal, withValidatorReports } from './utils/validator-issues.js';
import { FindingMatcher } from './FindingMatcher.js';
import type { Validator, ValidatorContext, ValidatorIssue, ValidatorReport, ValidatorRun } from './validators.js';
import { ValidatorSet } from './ValidatorSet.js';
import { once } from './utils/once.js';

/** A mutation's validation findings compared with the document before the ops. */
export interface ValidationDelta {
  added: Finding[];
  resolved: Finding[];
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
    private readonly matcher: FindingMatcher,
    private readonly profileMatcher: FindingMatcher,
    private readonly profileBefore: ProfileReport,
    private readonly validators: ValidatorSet,
    private readonly context: Omit<ValidatorContext, 'doc' | 'phase'>,
    private readonly validatorsBefore: ValidatorRun[],
  ) {}

  static async capture(doc: Doc, opts: BaselineOptions): Promise<FindingBaseline> {
    const { errors, warnings } = new StructuralValidator(doc).validate();
    const profile = PLATFORM_PROFILES.run(doc, opts.platform);
    const index = new Map(doc.byId());
    const validators = new ValidatorSet(opts.validators);
    const context: Omit<ValidatorContext, 'doc' | 'phase'> = { ...(opts.file ? { file: opts.file } : {}), platform: validators.size ? PlatformDetection.of(doc).resolve(opts.platform ?? 'auto').platform : 'none', ops: opts.ops };
    const validatorsBefore = validators.size ? await validators.run({ xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...context, phase: 'before' }) : [];
    return new FindingBaseline(doc, opts, { errors, warnings }, new FindingMatcher(index, doc), new FindingMatcher(index, doc, { bySubject: true, reusedIdIsNew: true }), doc.source ? profile : { ...profile, findings: [] }, validators, context, validatorsBefore);
  }

  /** The ops can change the platform (camunda: / zeebe: content), so its rules may load now. */
  async afterCommands(): Promise<ValidationResult> {
    const validator = new StructuralValidator(this.doc);
    const raw = (this.raw = validator.validate());
    const structural = this.separatePreexisting(raw);
    await PLATFORM_PROFILES.ensure(this.doc, this.opts.platform);
    const after = (this.profileAfter = PLATFORM_PROFILES.run(this.doc, this.opts.platform));
    const delta = this.profileMatcher.delta(this.profileBefore.findings, after.findings);
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
    const reports = FindingBaseline.compareRuns(this.doc.source ? this.validatorsBefore : this.validatorsBefore.filter((run) => run.blocks !== false), after, this.matcher.renames());
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
    const covered = (warning: Finding): boolean => coveredByPlatform(warning) || this.validatorCovered.has(lintKey(warning));
    const resolved = before.filter((earlier) => !FindingMatcher.take(remaining, (candidate) => this.matcher.sameWarning(earlier, candidate)) && !raw.warnings.some((current) => this.matcher.stillAbout(earlier, current)) && !covered(earlier));
    const errors = [...raw.errors];
    resolved.push(...this.before.errors.filter((earlier) => !FindingMatcher.take(errors, (candidate) => this.matcher.same(earlier, candidate))));
    resolved.push(...platformResolved, ...(final.validators ?? []).flatMap((report) => report.resolved));
    const addedFindings = new Set<ProfileFinding>(final.platform?.added ?? []);
    const kept = (this.profileAfter?.findings ?? []).filter((finding) => !addedFindings.has(finding));
    const keptCount = final.platform ? Math.max(0, Object.values(final.platform.counts).reduce((sum, count) => sum + count, 0) - addedFindings.size) : 0;
    const coveredByKept = lintCoveredBy(kept);
    const pool = [...before];
    const added: Finding[] = [];
    let preexistingCount = keptCount;
    for (const warning of final.warnings) {
      if (warning.code === 'W_PREEXISTING_ERROR') preexistingCount++;
      else if (FindingMatcher.take(pool, (earlier) => this.matcher.sameWarning(earlier, warning))) preexistingCount += coveredByKept(warning) ? 0 : 1;
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
    const identityBefore = FindingMatcher.identityAcross(renames);
    const identityAfter = FindingMatcher.identityAcross(new Map());
    const seen = new Map<string, number>();
    return after.map((run) => {
      const nth = seen.get(run.name) ?? 0;
      seen.set(run.name, nth + 1);
      const prev = before.filter((beforeRun) => beforeRun.name === run.name)[nth];
      const reasonOf = (issue: ValidatorIssue) => (prev ? issue.leftOut : undefined);
      const left = (prev?.issues ?? []).filter((issue) => reasonOf(issue) === undefined).map((issue) => ({ issue, id: identityBefore(issue) }));
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
        const id = identityAfter(issue);
        if (FindingMatcher.take(left, (entry) => entry.id === id && entry.issue.severity === issue.severity)) {
          if (issue.severity === 'error' && blocking) report.preexisting.push(issue);
          continue;
        }
        if (issue.severity === 'error' && blocking) report.errors.push(issue);
        else report.warnings.push(issue);
      }
      for (const issue of marked) {
        const id = identityAfter(issue);
        FindingMatcher.take(left, (entry) => entry.id === id && entry.issue.severity === issue.severity);
      }
      report.resolved = left.map((entry) => entry.issue);
      if (leftOut.size) report.leftOut = [...leftOut].map(([reason, count]) => ({ reason, count }));
      return report;
    });
  }

  private separatePreexisting(after: ValidationResult): ValidationResult {
    const left = [...this.before.errors];
    const errors: Finding[] = [];
    const kept: Finding[] = [];
    for (const finding of after.errors) {
      if (FindingMatcher.take(left, (earlier) => this.matcher.same(earlier, finding))) kept.push(preexisting(finding));
      else errors.push(finding);
    }
    return { errors, warnings: [...kept, ...after.warnings] };
  }
}
