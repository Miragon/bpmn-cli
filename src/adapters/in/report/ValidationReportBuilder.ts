import type { CheckResult } from '../../../application/port/in/ValidateDocumentUseCase.js';
import type { ValidationReport } from './command-report.js';
import { layoutWarnings } from './utils/findings.js';

/** `bpmn validate` as data: a failed layout dry run counts as an error. */
export class ValidationReportBuilder {
  constructor(private readonly check: CheckResult) {}

  report(): ValidationReport {
    const check = this.check;
    const warnings = [...check.validation.warnings, ...(check.layout.status === 'ok' ? layoutWarnings(check.layout) : [])];
    const errors = [...check.validation.errors, ...(check.layout.status === 'failed' ? [check.layout.error] : [])];
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      platform: check.validation.platform,
      ...(check.validation.validators ? { validators: check.validation.validators } : {}),
      layout: check.layout,
      importWarnings: check.importWarnings,
    };
  }
}
