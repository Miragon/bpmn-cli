/**
 * Pluggable validators a host runs inside the write transaction, before the ops and on the
 * XML that would be written. Only error findings the change introduced block the write.
 */
import type { Doc } from '../document/Doc.js';
import type { Warning } from '../document/CliError.js';
import type { EditCommand } from '../commands/types.js';
import type { Platform } from '../document/vendor/PlatformDetection.js';

export type { ValidatorFinding, ValidatorSeverity } from '../document/validator-finding.js';
import type { ValidatorFinding, ValidatorSeverity } from '../document/validator-finding.js';

export interface ValidatorContext {
  file?: string;
  /** after: the candidate that would be written; check: `bpmn validate` */
  phase: 'before' | 'after' | 'check';
  platform: Platform;
  /** empty for a check */
  ops: readonly EditCommand[];
  /** cached per phase; read it, never change it */
  doc(): Promise<Doc>;
}

export type ValidatorFn = (xml: string, ctx: ValidatorContext) => ValidatorFinding[] | Promise<ValidatorFinding[]>;

export interface NamedValidator {
  /** shown with every finding (`[name]` in the CLI, `validator` in JSON) */
  name: string;
  validate?: ValidatorFn;
  /** reads the parsed document instead of the XML (after the ops a fresh parse of the candidate) */
  validateDoc?: (doc: Doc, ctx: ValidatorContext) => ValidatorFinding[] | Promise<ValidatorFinding[]>;
  /** one line on why it runs */
  detail?: string;
  /** finding code -> the lint warning code it says again about the same element */
  covers?: Record<string, string>;
  /** false: advisory, introduced errors are reported among the warnings. Default true */
  blocks?: boolean;
}

/** A function (named by its function name) or a named validator. */
export type Validator = ValidatorFn | NamedValidator;

export interface ValidatorIssue extends Warning {
  validator: string;
  severity: ValidatorSeverity;
}

/** One validator's findings in a result; a mutation lists only what the change introduced. */
export interface ValidatorReport {
  name: string;
  detail?: string;
  blocks?: false;
  errors: ValidatorIssue[];
  warnings: ValidatorIssue[];
  /** mutation: error findings the document already had (they do not block) */
  preexisting: ValidatorIssue[];
  resolved: ValidatorIssue[];
  /** a mutation counts the left-out findings too */
  counts: { errors: number; warnings: number };
  /** one entry per reason */
  leftOut?: Array<{ reason: string; count: number }>;
}

export interface ValidatorRun {
  name: string;
  detail?: string;
  blocks?: false;
  issues: ValidatorIssue[];
  covers?: Record<string, string>;
}

export interface ValidatorInput {
  /** computed once, only for a validator that reads XML */
  xml(): Promise<string>;
  doc(): Promise<Doc>;
}
