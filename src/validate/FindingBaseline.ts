/**
 * The findings a document had before an edit, and what the edit did to
 * them: the structural validation, the platform profile and the validators
 * (src/validate/validators.ts) run on the document before the ops (capture)
 * and on the result (afterOps, onCandidate); only what the change
 * introduced blocks the write (E_VALIDATION, unless force) and is reported.
 *
 *  - structural errors the document already had (same code and element,
 *    followed through a rename or a retype by element identity) do not
 *    block unrelated edits: they are W_PREEXISTING_ERROR warnings whose
 *    message starts with the original code; so are a blocking validator's
 *    (its findings are matched by code and element, the old ids renamed, or
 *    by message with the renamed ids rewritten: compareRuns).
 *  - platform profile: only the findings the ops introduce are reported, as
 *    warnings; `validation.platform` has them as `added`, the ones the ops
 *    removed as `resolved`, and the totals. A document created in memory
 *    (`new`) had nothing before: its platform baseline is empty, so every
 *    platform finding is reported like every lint warning (and the lint
 *    warnings a platform finding says again give way to it).
 *  - a lint warning a platform finding or a validator's finding says again
 *    about the same element (lintCoveredBy, NamedValidator.covers) is
 *    reported once, as that finding, in the result and in the delta.
 */
import { Doc } from '../model/Doc.js';
import type { Warning } from '../shared/CliError.js';
import { modelError } from '../shared/utils/errors.js';
import type { El } from '../model/utils/moddle.js';
import type { Op } from '../ops/types.js';
import { resolvePlatform } from '../platform/detect.js';
import { ensureProfile, profileBaseline, profileDelta, runProfile, type PlatformChoice, type ProfileBaseline, type ProfileFinding, type ProfileReport } from '../platform/profiles/profile.js';
import { lintCoveredBy, validateDoc, withProfile, type ValidationResult } from './structural.js';
import { coveredLint, counts, keyOf, leftOutOf, lintKey, preexisting, validatorRefusal, withValidatorReports } from './utils/validator-issues.js';
import type { Validator, ValidatorContext, ValidatorIssue, ValidatorReport, ValidatorRun } from './validators.js';
import { ValidatorSet } from './ValidatorSet.js';
import { once } from './utils/once.js';

/** A mutation's validation findings compared with the document before the ops (MutationResult.delta). */
export interface ValidationDelta {
  /** warnings the change introduced (lint, platform profile, validators) */
  added: Warning[];
  /** findings the change resolved: warnings and errors the document had before (lint, platform profile, validators) */
  resolved: Warning[];
  /** warnings the document already had and still has, W_PREEXISTING_ERROR and the platform profile's findings included (`bpmn validate` lists them) */
  preexisting: number;
}

/** What a FindingBaseline compares with: the edit's options. */
export interface BaselineOptions {
  /** platform profile: 'auto' (default) detects it, 'none' switches it off */
  platform?: PlatformChoice;
  /** write despite errors the change introduced */
  force?: boolean;
  validators?: Validator[];
  /** the file being written, for the validators (`ctx.file`) */
  file?: string;
  /** the ops of the edit, for the validators (`ctx.ops`) */
  ops: readonly Op[];
}

/**
 * Lint warnings about a group of elements, listed as `element` + `related`
 * (W_DUPLICATE_NAME: every element of one name, the first as `element`), or
 * about one element and a list of others (the unnamed branches of a
 * gateway, the flows of an implicit split / join): the same finding while
 * the group only shrinks (one of three equally named tasks removed).
 */
const GROUP_CODES = new Set(['W_DUPLICATE_NAME']);
const LIST_CODES = new Set(['W_BRANCH_NAME', 'W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN']);

export class FindingBaseline {
  /** the structural validation after the ops (before pre-existing errors became W_PREEXISTING_ERROR) */
  private raw: ValidationResult | undefined;
  /** the platform profile after the ops */
  private profileAfter: ProfileReport | undefined;
  /** the validation the result reports so far */
  private validation: ValidationResult | undefined;
  /** the lint warnings the validators' resolved findings say again (NamedValidator.covers): listed once, as those findings */
  private readonly validatorCovered = new Set<string>();

  private constructor(
    private readonly doc: Doc,
    private readonly opts: BaselineOptions,
    /** the structural errors and lint warnings before the ops */
    private readonly before: ValidationResult,
    /** id -> element before the ops (an element renamed or retyped by the ops is still recognised) */
    private readonly index: Map<string, El>,
    /** the platform profile before the ops (its findings are not repeated by the mutation) */
    private readonly profile: ProfileBaseline,
    private readonly validators: ValidatorSet,
    private readonly context: Omit<ValidatorContext, 'doc' | 'phase'>,
    private readonly validatorsBefore: ValidatorRun[],
  ) {}

  /**
   * Validates the document before the ops run (this also repairs missing
   * incoming/outgoing entries, see repairFlowLinks), runs its platform
   * profile and the validators on it (its text as read; the in-memory model
   * serialised only for a created document).
   */
  static async capture(doc: Doc, opts: BaselineOptions): Promise<FindingBaseline> {
    const { errors, warnings } = validateDoc(doc);
    const profile = profileBaseline(doc, opts.platform);
    const index = new Map(doc.byId());
    const validators = new ValidatorSet(opts.validators);
    const context: Omit<ValidatorContext, 'doc' | 'phase'> = { ...(opts.file ? { file: opts.file } : {}), platform: validators.size ? resolvePlatform(doc, opts.platform ?? 'auto').platform : 'none', ops: opts.ops };
    const validatorsBefore = validators.size ? await validators.run({ xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...context, phase: 'before' }) : [];
    return new FindingBaseline(doc, opts, { errors, warnings }, index, doc.source ? profile : { report: { ...profile.report, findings: [] }, elements: [] }, validators, context, validatorsBefore);
  }

  /**
   * The validation after the ops: the structural errors they introduced
   * (refused with E_VALIDATION unless force), the ones the document had as
   * W_PREEXISTING_ERROR, and the platform findings they added. The ops can
   * change the platform (the first camunda: / zeebe: content of a plain
   * file), so its rules may load now.
   */
  async afterOps(): Promise<ValidationResult> {
    const raw = (this.raw = validateDoc(this.doc));
    const structural = this.separatePreexisting(raw);
    await ensureProfile(this.doc, this.opts.platform);
    const after = (this.profileAfter = runProfile(this.doc, this.opts.platform));
    const delta = profileDelta(this.doc, this.profile, after);
    const validation = (this.validation = withProfile(structural, after, delta.added, delta));
    if (validation.errors.length && !this.opts.force) {
      throw modelError('E_VALIDATION', `The change would introduce ${validation.errors.length} structural error(s); nothing was written`, {
        errors: validation.errors,
        hint: 'Fix the listed problems, make the edit in one transaction (`bpmn apply <file> ops.json`) so that it ends in a valid model, or pass --force to write anyway.',
      });
    }
    return validation;
  }

  /**
   * Runs the validators on `candidate`, exactly what would be written, and
   * compares their findings with the run before the ops: the errors the
   * change introduced are refused (E_VALIDATION unless force), the result
   * reports them (validators). A created document (`new`) has no file
   * before: an advisory validator (bpmnlint) reports everything it finds in it.
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
   * The findings of the mutation against the document before the ops (each
   * finding matched once); undefined for a document created in memory
   * (`new`): it has no file whose warnings were already there. A lint
   * warning the document had (same code, element and related elements,
   * followed through a rename; a group warning that only shrank) is
   * pre-existing, so is every W_PREEXISTING_ERROR and every platform
   * finding the change did not add (a pre-existing lint warning such a
   * finding says again is counted once, as the platform finding, like
   * `bpmn validate` lists it); the rest of the reported warnings was added.
   * Resolved: the lint warnings and errors the document had that the
   * structural validation after the ops no longer has (a group warning
   * that still has one of its elements is not), and the platform's and
   * validators' resolved findings; a lint warning a resolved platform or
   * validator finding covers is listed once, as that finding.
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
    // the platform findings the file had and still has: counted (the result lists the added ones only)
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
   * Compares each validator's findings before and after a change: what the
   * change introduced (errors, warnings), what the document already had
   * (pre-existing errors) and what it removed (resolved). Findings are
   * matched by validator, code and element (`renames`: old id -> new id) or,
   * without an element, by code and message (the old ids in the message
   * replaced by the renamed ones); a finding's `key` replaces that
   * identity. Each finding before matches at most one after; the n-th run
   * of a name after compares with the n-th run of that name before. An
   * advisory run (`blocks: false`) reports the errors it introduced among
   * the warnings and only counts its old ones. A left-out finding
   * (ValidatorFinding.leftOut) is not compared, before or after: it is in
   * `counts` and in `leftOut`; one after takes its finding before out of
   * `resolved` (it is still in the result). A run with no run before (an
   * advisory validator of a created document) reports every finding,
   * left-out ones too.
   */
  static compareRuns(before: ValidatorRun[], after: ValidatorRun[], renames: Map<string, string> = new Map()): ValidatorReport[] {
    const rename = FindingBaseline.renamer(renames);
    const none = new Map<string, string>();
    const seen = new Map<string, number>();
    return after.map((run) => {
      const nth = seen.get(run.name) ?? 0;
      seen.set(run.name, nth + 1);
      const prev = before.filter((b) => b.name === run.name)[nth];
      // a run without one before (an advisory validator of a created document) has nothing to compare: it reports every finding
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
      // a finding the file had that is still in the result, now left out (a node the change gave a flow, in a file without the lists): not resolved
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

  /**
   * Splits the errors after the ops into the ones the ops introduced and the
   * ones the document already had (matched once each, see sameFinding); the
   * latter become W_PREEXISTING_ERROR warnings that keep element and hint.
   */
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

  /**
   * The ids the ops renamed: every id before the ops maps to its element;
   * an element that is still in the document under another id was renamed
   * (`set <id> id=<new>`).
   */
  private renames(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [id, el] of this.index) {
      const now = (el as unknown as { id?: unknown }).id;
      if (typeof now === 'string' && now !== id && this.doc.get(now) === el) out.set(id, now);
    }
    return out;
  }

  /** Whether `after` is the finding `before` again: same code, about the same element (by id, or by identity after a rename). */
  private sameFinding(before: Warning, after: Warning): boolean {
    if (before.code !== after.code) return false;
    if (before.element === after.element) return true;
    const was = before.element ? this.index.get(before.element) : undefined;
    return !!was && !!after.element && this.doc.get(after.element) === was;
  }

  /** The element before the ops that `id` (an id after them) is: by id, or the same element under a new id (a rename). */
  private sameElement(before: string, after: string): boolean {
    if (before === after) return true;
    const was = this.index.get(before);
    return !!was && this.doc.get(after) === was;
  }

  /**
   * Whether `after` is the warning `before` again: sameFinding, and the related
   * elements are the same ones (by id or identity). A group or list warning
   * is the same while its elements are among the ones it had (the group may
   * shrink, not take in another element; a group's first element may change).
   */
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

  /** Whether a group or list warning after the ops is still about warning `before` (they share an element): `before` is not resolved, it changed. */
  private stillAbout(before: Warning, after: Warning): boolean {
    if (before.code !== after.code || !(GROUP_CODES.has(after.code) || LIST_CODES.has(after.code))) return false;
    if (LIST_CODES.has(after.code)) return this.sameFinding(before, after);
    const had = FindingBaseline.membersOf(before);
    return FindingBaseline.membersOf(after).some((id) => had.some((b) => this.sameElement(b, id)));
  }

  /** The elements of a group / list warning that count (see GROUP_CODES, LIST_CODES). */
  private static membersOf(w: Warning): string[] {
    return GROUP_CODES.has(w.code) ? [...(w.element ? [w.element] : []), ...(w.related ?? [])] : (w.related ?? []);
  }

  /** Takes the first item of `pool` that `match` accepts out of it; whether there was one. */
  private static takeMatch<T>(pool: T[], match: (item: T) => boolean): boolean {
    const i = pool.findIndex(match);
    if (i === -1) return false;
    pool.splice(i, 1);
    return true;
  }

  /** Replaces whole ids (XML NCName boundaries) by their new ids, in one pass (ids swapped in one batch stay apart). */
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
