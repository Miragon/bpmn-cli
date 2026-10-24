/**
 * Pluggable validators: checks a host runs inside the write transaction, on
 * the XML that would be written.
 *
 *   mutateDoc(doc, ops, { validators: [fn, { name: 'host', validate: fn }] })
 *   fn(xml, ctx) => ValidatorFinding[] | Promise<ValidatorFinding[]>
 *
 * A mutation runs every validator twice: on the document before the ops (the
 * baseline) and on the candidate XML after the ops, the layout and the format
 * ops (exactly what would be written). Then, like the structural validation:
 *
 *  - findings of severity error the change introduced block the write
 *    (E_VALIDATION listing them, each with its `validator`), unless force;
 *  - error findings the document already had do not block: they are
 *    reported as W_PREEXISTING_ERROR warnings (message starting with their
 *    code), so an old problem never makes a file uneditable;
 *  - warnings the change introduced are reported; old warnings are not
 *    repeated on every write (only counted).
 *
 * An advisory validator (`blocks: false`, the project's bpmnlint in
 * src/validate/bpmnlint-validator.ts) never blocks: errors the change introduced are reported
 * among the warnings, severity kept; old errors are only counted. `bpmn
 * validate` reports its errors as errors.
 *
 * `validation.validators` has one report per validator (introduced errors and
 * warnings, pre-existing errors, resolved findings, totals); the reported
 * findings are also among `validation.errors` / `validation.warnings` with a
 * `validator` field. A check (checkDoc, checkFile, validateXml) runs each
 * validator once on the document and reports every finding (an error makes
 * `ok` false in the validateXml report; checkDoc and checkFile list it in
 * `validation.errors`).
 *
 * Findings are matched before / after by validator, code and element (an
 * element the ops renamed keeps its findings) or, without an element, by code
 * and message (the old ids in the message replaced by the renamed ones); a
 * finding's `key` replaces that identity. Two validators of one name are
 * compared in order (the second run after with the second run before). A
 * finding of the shape {severity: 'ERROR' | 'WARN', ruleId, message} is
 * accepted as it is.
 *
 * A finding a validator marks `leftOut` (a short reason) is not compared: a
 * write neither adds, resolves nor keeps it, never blocks on it and counts
 * it in `counts` and in the report's `leftOut` (one entry per reason), so
 * its totals equal a check's (the project's bpmnlint: list-rule findings on
 * a file without incoming / outgoing lists, a model it could not lint); a
 * finding the file had that is still in the result, now marked, is not
 * resolved. A check reports it like any other finding, and so does a write with
 * nothing to compare (an advisory validator of a created document).
 */
import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import type { El } from '../model/utils/moddle.js';
import type { Op } from '../ops/types.js';
import type { Platform } from '../platform/detect.js';
import type { ValidationResult } from './structural.js';

export type ValidatorSeverity = 'error' | 'warning';

/** What a validator returns. */
export interface ValidatorFinding {
  /** 'error' blocks a write that introduces it, 'warning' is reported; ERROR / WARN / WARNING in any case are accepted too */
  severity: string;
  /** stable rule id, e.g. UNNAMED_TASK (`ruleId` is read when there is no code) */
  code?: string;
  /** another name for the code (`naming/task`) */
  ruleId?: string;
  message: string;
  /** id of the element the finding is about */
  element?: string;
  related?: string[];
  hint?: string;
  /** identity for the before / after comparison (default: code + element, or code + message without an element) */
  key?: string;
  /** a write does not compare this finding, it counts it as left out for this reason (`incoming / outgoing lists the file does not keep`); a check reports it like any other */
  leftOut?: string;
}

export interface ValidatorContext {
  /** the file being written or checked, when there is one */
  file?: string;
  /** before: the document before the ops (the baseline); after: the candidate that would be written; check: `bpmn validate` */
  phase: 'before' | 'after' | 'check';
  /** the engine platform of the document (detected, or the explicit MutationOptions.platform) */
  platform: Platform;
  /** the ops of the transaction (empty for a check) */
  ops: readonly Op[];
  /** the XML parsed into a document (cached per phase; read it, never change it) */
  doc(): Promise<Doc>;
}

export type ValidatorFn = (xml: string, ctx: ValidatorContext) => ValidatorFinding[] | Promise<ValidatorFinding[]>;

export interface NamedValidator {
  /** shown with every finding (`[name]` in the CLI, `validator` in JSON) */
  name: string;
  validate?: ValidatorFn;
  /** an in-process validator may read the parsed document instead of the XML: the live document before the ops and in a check, a fresh parse of the candidate after them (one parse more per write; it saves a serialisation only for a document created in memory) */
  validateDoc?: (doc: Doc, ctx: ValidatorContext) => ValidatorFinding[] | Promise<ValidatorFinding[]>;
  /** one line on why it runs (shown in results) */
  detail?: string;
  /** finding code -> the lint warning code it says again about the same element (the lint warning is dropped; a finding without a hint takes its hint) */
  covers?: Record<string, string>;
  /** false: advisory (the project's bpmnlint): errors the change introduced are reported among the warnings (severity kept) and never block, old errors are only counted; validate reports its errors as errors. Default true */
  blocks?: boolean;
}

/** A validator as MutationOptions.validators takes it: a function (named by its function name) or a named one. */
export type Validator = ValidatorFn | NamedValidator;

/** A finding as results report it: a Warning with the validator's name and the severity. */
export interface ValidatorIssue extends Warning {
  validator: string;
  severity: ValidatorSeverity;
}

/** One validator's findings in a result (`validation.validators`). */
export interface ValidatorReport {
  name: string;
  detail?: string;
  /** false: advisory (NamedValidator.blocks): the errors a change introduced are in `warnings`, the old ones only counted */
  blocks?: false;
  /** mutation: error findings the change introduced (written only with force); validate: every error finding */
  errors: ValidatorIssue[];
  /** mutation: warnings the change introduced; validate: every warning */
  warnings: ValidatorIssue[];
  /** mutation: error findings the document already had (they do not block) */
  preexisting: ValidatorIssue[];
  /** mutation: findings the change removed */
  resolved: ValidatorIssue[];
  /** findings after the change (validate: in the file); a mutation counts the left-out ones too */
  counts: { errors: number; warnings: number };
  /** mutation: findings after the change the validator left out of the comparison (ValidatorFinding.leftOut), one entry per reason; absent when there are none */
  leftOut?: Array<{ reason: string; count: number }>;
}

/** The findings of one validator on one document. */
export interface ValidatorRun {
  name: string;
  detail?: string;
  blocks?: false;
  issues: ValidatorIssue[];
  covers?: Record<string, string>;
}

/** Hidden identity of an issue (not serialised). */
const KEY: unique symbol = Symbol('validator-issue-key');
/** Hidden reason why a write leaves an issue out of the comparison (ValidatorFinding.leftOut; not serialised). */
const LEFT_OUT: unique symbol = Symbol('validator-issue-left-out');
type Keyed = ValidatorIssue & { [KEY]?: string; [LEFT_OUT]?: string };

/** Why a write leaves the issue out of the comparison (ValidatorFinding.leftOut), or undefined. */
function leftOutOf(issue: ValidatorIssue): string | undefined {
  return (issue as Keyed)[LEFT_OUT];
}

/** The validators with their names: a function is named by its function name, else `validator<n>` (1-based). */
export function namedValidators(list: readonly Validator[] | undefined): NamedValidator[] {
  return (list ?? []).map((v, i) => {
    if (typeof v === 'function') return { name: v.name || `validator${i + 1}`, validate: v };
    if (!v || typeof v !== 'object' || (typeof v.validate !== 'function' && typeof v.validateDoc !== 'function')) {
      throw modelError('E_VALIDATOR_FAILED', `Validator ${i + 1} is neither a function nor an object with a validate function`, {
        hint: 'Pass `validators: [(xml, ctx) => findings]` or `[{ name, validate: (xml, ctx) => findings }]`.',
      });
    }
    return { ...v, name: v.name || `validator${i + 1}` };
  });
}

function severityOf(raw: unknown): ValidatorSeverity {
  return String(raw ?? '').trim().toLowerCase() === 'error' ? 'error' : 'warning';
}

function toIssue(name: string, f: ValidatorFinding): ValidatorIssue {
  const issue: Keyed = { code: String(f.code ?? f.ruleId ?? 'FINDING'), message: String(f.message ?? ''), validator: name, severity: severityOf(f.severity) };
  if (f.element) issue.element = String(f.element);
  if (f.related?.length) issue.related = f.related.map(String);
  if (f.hint) issue.hint = String(f.hint);
  if (f.key) Object.defineProperty(issue, KEY, { value: String(f.key), enumerable: false });
  if (f.leftOut) Object.defineProperty(issue, LEFT_OUT, { value: String(f.leftOut), enumerable: false });
  return issue;
}

export interface ValidatorInput {
  /** the XML (computed once, only for a validator that reads XML) */
  xml(): Promise<string>;
  /** the parsed document */
  doc(): Promise<Doc>;
}

/** Runs every validator on one document; a throwing validator fails the whole run (E_VALIDATOR_FAILED, nothing is written). */
export async function runValidators(validators: readonly NamedValidator[], input: ValidatorInput, ctx: Omit<ValidatorContext, 'doc'>): Promise<ValidatorRun[]> {
  const runs: ValidatorRun[] = [];
  const context: ValidatorContext = { ...ctx, doc: input.doc };
  for (const v of validators) {
    let found: ValidatorFinding[];
    try {
      found = v.validateDoc ? await v.validateDoc(await input.doc(), context) : await v.validate!(await input.xml(), context);
    } catch (err) {
      throw modelError('E_VALIDATOR_FAILED', `Validator ${v.name} failed on the ${ctx.phase === 'before' ? 'document before the change' : ctx.phase === 'after' ? 'changed document' : 'file'}: ${String((err as Error)?.message ?? err).split('\n')[0]}; nothing was written`, {
        validator: v.name,
        hint: 'The validator threw instead of returning findings. Fix the validator (or the input it cannot read), or run without it.',
      });
    }
    if (!Array.isArray(found)) {
      throw modelError('E_VALIDATOR_FAILED', `Validator ${v.name} returned ${typeof found} instead of an array of findings; nothing was written`, { validator: v.name });
    }
    runs.push({ name: v.name, ...(v.detail ? { detail: v.detail } : {}), ...(v.blocks === false ? { blocks: false as const } : {}), issues: found.map((f) => toIssue(v.name, f)), ...(v.covers ? { covers: v.covers } : {}) });
  }
  return runs;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces whole ids (XML NCName boundaries) by their new ids, in one pass (ids swapped in one batch stay apart). */
function renamer(renames: Map<string, string>): (text: string) => string {
  if (!renames.size) return (text) => text;
  const ids = [...renames.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp(`(?<![\\w.-])(?:${ids.join('|')})(?![\\w.-])`, 'g');
  return (text) => text.replace(re, (id) => renames.get(id) ?? id);
}

function identity(issue: ValidatorIssue, rename: (text: string) => string, renames: Map<string, string>): string {
  const key = (issue as Keyed)[KEY];
  if (key !== undefined) return `k|${issue.code}|${rename(key)}`;
  if (issue.element) return `e|${issue.code}|${renames.get(issue.element) ?? issue.element}`;
  return `m|${issue.code}|${rename(issue.message)}`;
}

/**
 * The ids the ops renamed: `before` maps every id before the ops to its
 * element; an element that is still in the document under another id was
 * renamed (`set <id> id=<new>`).
 */
export function renamesOf(doc: Doc, before: Map<string, El>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, el] of before) {
    const now = (el as unknown as { id?: unknown }).id;
    if (typeof now === 'string' && now !== id && doc.get(now) === el) out.set(id, now);
  }
  return out;
}

function counts(issues: ValidatorIssue[]): { errors: number; warnings: number } {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

/**
 * Compares each validator's findings before and after a change: what the
 * change introduced (errors, warnings), what the document already had
 * (pre-existing errors) and what it removed (resolved). Each finding before
 * matches at most one after; the n-th run of a name after compares with the
 * n-th run of that name before. An advisory run (`blocks: false`) reports
 * the errors it introduced among the warnings and only counts its old ones.
 * A left-out finding (ValidatorFinding.leftOut) is not compared, before or
 * after: it is in `counts` and in `leftOut`; one after takes its finding
 * before out of `resolved` (it is still in the result). A run with no run
 * before (an advisory validator of a created document) reports every
 * finding, left-out ones too.
 */
export function compareRuns(before: ValidatorRun[], after: ValidatorRun[], renames: Map<string, string> = new Map()): ValidatorReport[] {
  const rename = renamer(renames);
  const none = new Map<string, string>();
  const seen = new Map<string, number>();
  return after.map((run) => {
    const nth = seen.get(run.name) ?? 0;
    seen.set(run.name, nth + 1);
    const prev = before.filter((b) => b.name === run.name)[nth];
    // a run without one before (an advisory validator of a created document) has nothing to compare: it reports every finding
    const reasonOf = (issue: ValidatorIssue) => (prev ? leftOutOf(issue) : undefined);
    const left = (prev?.issues ?? []).filter((issue) => reasonOf(issue) === undefined).map((issue) => ({ issue, id: identity(issue, rename, renames) }));
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
      const id = identity(issue, (text) => text, none);
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
      const id = identity(issue, (text) => text, none);
      const i = left.findIndex((b) => b.id === id && b.issue.severity === issue.severity);
      if (i !== -1) left.splice(i, 1);
    }
    report.resolved = left.map((b) => b.issue);
    if (leftOut.size) report.leftOut = [...leftOut].map(([reason, count]) => ({ reason, count }));
    return report;
  });
}

/** validate / checkFile: every finding of a run is reported. */
export function checkReports(runs: ValidatorRun[]): ValidatorReport[] {
  return runs.map((run) => ({
    name: run.name,
    ...(run.detail ? { detail: run.detail } : {}),
    ...(run.blocks === false ? { blocks: false as const } : {}),
    errors: run.issues.filter((i) => i.severity === 'error'),
    warnings: run.issues.filter((i) => i.severity === 'warning'),
    preexisting: [],
    resolved: [],
    counts: counts(run.issues),
  }));
}

/** A pre-existing error as a warning (like the structural W_PREEXISTING_ERROR): it does not block the write. */
export function preexistingWarning(issue: ValidatorIssue): ValidatorIssue {
  return { ...issue, code: 'W_PREEXISTING_ERROR', message: `${issue.code}: ${issue.message} (already in the model before this change)`, severity: 'warning' };
}

/** The E_VALIDATION error for errors validators found in a change. */
export function validatorRefusal(errors: ValidatorIssue[]) {
  const names = [...new Set(errors.map((e) => e.validator))];
  return modelError('E_VALIDATION', `The change would introduce ${errors.length} error(s) reported by ${names.map((n) => `validator ${n}`).join(', ')}; nothing was written`, {
    errors,
    hint: `Fix the listed problems (each names its validator in brackets), make the edit in one transaction (\`bpmn apply <file> ops.json\`) so that it ends in a valid model, or pass --force to write anyway.${names.includes('bpmnlint') ? " The project's bpmnlint blocks here because the host asked for it (lintBlocks)." : ''}`,
  });
}

/**
 * Adds validator reports to a validation result: `validators`, the errors
 * (a mutation: only those it introduced, present when forced; validate:
 * all) among `errors`, the introduced warnings and the pre-existing errors
 * (as W_PREEXISTING_ERROR) among `warnings`. A lint warning a validator's
 * finding repeats about the same element (`covers`) is dropped; a finding
 * without a hint of its own takes the dropped warning's hint.
 */
export function withValidatorReports(result: ValidationResult, reports: ValidatorReport[], runs: ValidatorRun[]): ValidationResult {
  if (!reports.length) return result;
  const covering = new Map<string, ValidatorIssue[]>();
  runs.forEach((run, i) => {
    // a finding a write left out is not reported, so it covers nothing (a check's report never has leftOut: it reports every finding)
    const write = reports[i]?.leftOut !== undefined;
    for (const issue of run.issues) {
      const lint = run.covers?.[issue.code];
      if (!lint || !issue.element || (write && leftOutOf(issue) !== undefined)) continue;
      const key = `${lint}|${issue.element}`;
      covering.set(key, [...(covering.get(key) ?? []), issue]);
    }
  });
  const warnings = result.warnings.filter((w) => {
    const by = covering.get(`${w.code}|${w.element ?? ''}`);
    if (!by) return true;
    for (const issue of by) if (!issue.hint && w.hint) issue.hint = w.hint;
    return false;
  });
  return {
    ...result,
    errors: [...result.errors, ...reports.flatMap((r) => r.errors)],
    warnings: [...warnings, ...reports.flatMap((r) => [...r.preexisting.map(preexistingWarning), ...r.warnings])],
    validators: reports,
  };
}

/** A promise-returning function that runs `fn` once. */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}
