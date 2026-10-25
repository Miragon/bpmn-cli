import { Doc } from '../model/Doc.js';
import type { Warning } from '../shared/CliError.js';
import { modelError } from '../shared/utils/errors.js';
import type { El } from '../model/utils/moddle.js';
import type { Op } from '../ops/types.js';
import { PlatformDetection, type PlatformChoice } from '../platform/PlatformDetection.js';
import type { ProfileFinding } from '../platform/utils/finding.js';
import { PLATFORM_PROFILES, type ProfileBaseline, type ProfileReport } from '../platform/profiles/PlatformProfiles.js';
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
  ops: readonly Op[];
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
    const reports = FindingBaseline.compareRuns(this.doc.source ? this.validatorsBefore : this.validatorsBefore.filter((r) => r.blocks !== false), after, this.renames());
    const introduced = reports.flatMap((r) => r.errors);
    if (introduced.length && !this.opts.force) throw validatorRefusal(introduced);
    reports.forEach((report, i) => {
      for (const issue of report.resolved) {
        const key = coveredLint(after[i]!, issue);
        if (key) this.validatorCovered.add(key);
      }
    });
    return (this.validation = withValidatorReports(validation, reports, after));
  }

  /**
   * Each finding is matched once. Undefined for a document created in memory: no warning
   * was already there. A lint warning a platform or validator finding repeats counts once.
   */
  delta(): ValidationDelta | undefined {
    if (!this.doc.source) return undefined;
    const raw = this.raw!;
    const final = this.validation!;
    const before = this.before.warnings;
    const remaining = [...raw.warnings];
    const platformResolved = final.platform?.resolved ?? [];
    const coveredByPlatform = lintCoveredBy(platformResolved);
    const covered = (w: Warning): boolean => coveredByPlatform(w) || this.validatorCovered.has(lintKey(w));
    const resolved = before.filter((b) => !FindingBaseline.takeMatch(remaining, (a) => this.sameWarning(b, a)) && !raw.warnings.some((a) => this.stillAbout(b, a)) && !covered(b));
    const errors = [...raw.errors];
    resolved.push(...this.before.errors.filter((b) => !FindingBaseline.takeMatch(errors, (a) => this.sameFinding(b, a))));
    resolved.push(...platformResolved, ...(final.validators ?? []).flatMap((r) => r.resolved));
    // counted only: the result lists the added platform findings
    const addedFindings = new Set<ProfileFinding>(final.platform?.added ?? []);
    const kept = (this.profileAfter?.findings ?? []).filter((f) => !addedFindings.has(f));
    const keptCount = final.platform ? Math.max(0, Object.values(final.platform.counts).reduce((a, b) => a + b, 0) - addedFindings.size) : 0;
    const coveredByKept = lintCoveredBy(kept);
    const pool = [...before];
    const added: Warning[] = [];
    let preexistingCount = keptCount;
    for (const w of final.warnings) {
      if (w.code === 'W_PREEXISTING_ERROR') preexistingCount++;
      else if (FindingBaseline.takeMatch(pool, (b) => this.sameWarning(b, w))) preexistingCount += coveredByKept(w) ? 0 : 1;
      else added.push(w);
    }
    return { added, resolved, preexisting: preexistingCount };
  }

  /**
   * Findings match by code and element (renamed ids followed) or by `key`, else by message;
   * the n-th run of a name compares with the n-th run before. An advisory run reports its
   * introduced errors among the warnings. Left-out findings are counted, not compared.
   */
  static compareRuns(before: ValidatorRun[], after: ValidatorRun[], renames: Map<string, string> = new Map()): ValidatorReport[] {
    const rename = FindingBaseline.renamer(renames);
    const none = new Map<string, string>();
    const seen = new Map<string, number>();
    return after.map((run) => {
      const nth = seen.get(run.name) ?? 0;
      seen.set(run.name, nth + 1);
      const prev = before.filter((b) => b.name === run.name)[nth];
      // without a run before (a created document) nothing is compared: every finding is reported
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
        const i = left.findIndex((b) => b.id === id && b.issue.severity === issue.severity);
        if (i !== -1) {
          left.splice(i, 1);
          if (issue.severity === 'error' && blocking) report.preexisting.push(issue);
          continue;
        }
        if (issue.severity === 'error' && blocking) report.errors.push(issue);
        else report.warnings.push(issue);
      }
      // a finding the file had that is now left out is still in the result: not resolved
      for (const issue of marked) {
        const id = FindingBaseline.identity(issue, (text) => text, none);
        const i = left.findIndex((b) => b.id === id && b.issue.severity === issue.severity);
        if (i !== -1) left.splice(i, 1);
      }
      report.resolved = left.map((b) => b.issue);
      if (leftOut.size) report.leftOut = [...leftOut].map(([reason, count]) => ({ reason, count }));
      return report;
    });
  }

  private separatePreexisting(after: ValidationResult): ValidationResult {
    const left = [...this.before.errors];
    const errors: Warning[] = [];
    const kept: Warning[] = [];
    for (const f of after.errors) {
      const i = left.findIndex((b) => this.sameFinding(b, f));
      if (i === -1) {
        errors.push(f);
        continue;
      }
      left.splice(i, 1);
      kept.push(preexisting(f));
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
      return FindingBaseline.membersOf(after).every((id) => had.some((b) => this.sameElement(b, id)));
    }
    if (!this.sameFinding(before, after)) return false;
    const a = before.related ?? [];
    const b = after.related ?? [];
    return a.length === b.length && a.every((id, i) => this.sameElement(id, b[i]!));
  }

  /** A group warning that still shares an element with `before` changed: it is not resolved. */
  private stillAbout(before: Warning, after: Warning): boolean {
    if (before.code !== after.code || !(GROUP_CODES.has(after.code) || LIST_CODES.has(after.code))) return false;
    if (LIST_CODES.has(after.code)) return this.sameFinding(before, after);
    const had = FindingBaseline.membersOf(before);
    return FindingBaseline.membersOf(after).some((id) => had.some((b) => this.sameElement(b, id)));
  }

  private static membersOf(w: Warning): string[] {
    return GROUP_CODES.has(w.code) ? [...(w.element ? [w.element] : []), ...(w.related ?? [])] : (w.related ?? []);
  }

  private static takeMatch<T>(pool: T[], match: (item: T) => boolean): boolean {
    const i = pool.findIndex(match);
    if (i === -1) return false;
    pool.splice(i, 1);
    return true;
  }

  /** Whole ids (XML NCName boundaries), in one pass: ids swapped in one batch stay apart. */
  private static renamer(renames: Map<string, string>): (text: string) => string {
    if (!renames.size) return (text) => text;
    const ids = [...renames.keys()].sort((a, b) => b.length - a.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
