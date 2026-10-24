/**
 * Pluggable validators: checks a host runs inside the write transaction, on
 * the XML that would be written (ValidatorSet runs them, FindingBaseline
 * compares their findings before and after a change).
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
import type { Warning } from '../shared/CliError.js';
import type { Op } from '../ops/types.js';
import type { Platform } from '../platform/PlatformDetection.js';

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

export interface ValidatorInput {
  /** the XML (computed once, only for a validator that reads XML) */
  xml(): Promise<string>;
  /** the parsed document */
  doc(): Promise<Doc>;
}
