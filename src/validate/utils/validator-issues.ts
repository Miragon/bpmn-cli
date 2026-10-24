import { modelError } from '../../shared/utils/errors.js';
import type { Warning } from '../../shared/CliError.js';
import type { ValidationResult } from '../StructuralValidator.js';
import type { ValidatorIssue, ValidatorReport, ValidatorRun } from '../validators.js';

/** Hidden identity of an issue (ValidatorFinding.key; not serialised). */
export const ISSUE_KEY: unique symbol = Symbol('validator-issue-key');
/** Hidden reason why a write leaves an issue out of the comparison (ValidatorFinding.leftOut; not serialised). */
export const LEFT_OUT: unique symbol = Symbol('validator-issue-left-out');
export type KeyedIssue = ValidatorIssue & { [ISSUE_KEY]?: string; [LEFT_OUT]?: string };

/** The identity a validator gave the issue (ValidatorFinding.key), or undefined. */
export function keyOf(issue: ValidatorIssue): string | undefined {
  return (issue as KeyedIssue)[ISSUE_KEY];
}

/** Why a write leaves the issue out of the comparison (ValidatorFinding.leftOut), or undefined. */
export function leftOutOf(issue: ValidatorIssue): string | undefined {
  return (issue as KeyedIssue)[LEFT_OUT];
}

export function counts(issues: ValidatorIssue[]): { errors: number; warnings: number } {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

/** An error the document already had, as a W_PREEXISTING_ERROR warning whose message starts with the original code (element and hint kept): it does not block the write. */
export function preexisting<T extends Warning>(finding: T): T {
  return { ...finding, code: 'W_PREEXISTING_ERROR', message: `${finding.code}: ${finding.message} (already in the model before this change)` };
}

/** `<lint code>|<element>` of the lint warning a validator's issue says again about the same element (NamedValidator.covers), or undefined. */
export function coveredLint(run: Pick<ValidatorRun, 'covers'>, issue: ValidatorIssue): string | undefined {
  const lint = run.covers?.[issue.code];
  return lint && issue.element ? `${lint}|${issue.element}` : undefined;
}

/** `<code>|<element>` of a lint warning, the key coveredLint gives the issues that say it again. */
export function lintKey(w: Warning): string {
  return `${w.code}|${w.element ?? ''}`;
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
      const key = coveredLint(run, issue);
      if (!key || (write && leftOutOf(issue) !== undefined)) continue;
      covering.set(key, [...(covering.get(key) ?? []), issue]);
    }
  });
  const warnings = result.warnings.filter((w) => {
    const by = covering.get(lintKey(w));
    if (!by) return true;
    for (const issue of by) if (!issue.hint && w.hint) issue.hint = w.hint;
    return false;
  });
  return {
    ...result,
    errors: [...result.errors, ...reports.flatMap((r) => r.errors)],
    warnings: [...warnings, ...reports.flatMap((r) => [...r.preexisting.map((issue) => ({ ...preexisting(issue), severity: 'warning' as const })), ...r.warnings])],
    validators: reports,
  };
}
