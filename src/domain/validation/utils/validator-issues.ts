import { modelError } from '../../document/utils/errors.js';
import type { Finding } from '../../document/Finding.js';
import type { ValidationResult } from '../StructuralValidator.js';
import type { ValidatorIssue, ValidatorReport, ValidatorRun } from '../validators.js';
import { coveredLint, lintKey } from './finding-coverage.js';

export function counts(issues: ValidatorIssue[]): { errors: number; warnings: number } {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

/** An error the document already had does not block the write. */
export function preexisting<TFinding extends Finding>(finding: TFinding): TFinding {
  return { ...finding, code: 'W_PREEXISTING_ERROR', message: `${finding.code}: ${finding.message} (already in the model before this change)` };
}

export function validatorRefusal(errors: ValidatorIssue[]) {
  const names = [...new Set(errors.map((error) => error.validator))];
  return modelError('E_VALIDATION', `The change would introduce ${errors.length} error(s) reported by ${names.map((name) => `validator ${name}`).join(', ')}; nothing was written`, {
    errors,
    hint: `Fix the listed problems (each names its validator in brackets), make the edit in one transaction (\`bpmn apply <file> ops.json\`) so that it ends in a valid model, or pass --force to write anyway.${names.includes('bpmnlint') ? " The project's bpmnlint blocks here because the host asked for it (lintBlocks)." : ''}`,
  });
}

/**
 * A lint warning a finding repeats is dropped; a finding without a hint takes its hint.
 * A finding a write left out is not reported, so it covers no lint warning.
 */
export function withValidatorReports(result: ValidationResult, reports: ValidatorReport[], runs: ValidatorRun[]): ValidationResult {
  if (!reports.length) return result;
  const covering = new Map<string, ValidatorIssue[]>();
  runs.forEach((run, index) => {
    const write = reports[index]?.leftOut !== undefined;
    for (const issue of run.issues) {
      const key = coveredLint(run, issue);
      if (!key || (write && issue.leftOut !== undefined)) continue;
      covering.set(key, [...(covering.get(key) ?? []), issue]);
    }
  });
  const warnings = result.warnings.filter((warning) => {
    const by = covering.get(lintKey(warning));
    if (!by) return true;
    for (const issue of by) {
      if (!issue.hint && warning.hint) issue.hint = warning.hint;
    }
    return false;
  });
  return {
    ...result,
    errors: [...result.errors, ...reports.flatMap((report) => report.errors)],
    warnings: [...warnings, ...reports.flatMap((report) => [...report.preexisting.map((issue) => ({ ...preexisting(issue), severity: 'warning' as const })), ...report.warnings])],
    validators: reports,
  };
}
