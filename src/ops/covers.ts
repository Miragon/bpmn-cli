/**
 * Operation warnings that repeat what the platform profile reports item by
 * item: a write shows the profile findings (with severity and a fix each)
 * and drops the summary warning of the operation.
 *
 *  - retype's W_PROPERTY_INAPPLICABLE covers the misplaced camunda / zeebe
 *    content it names (the subjects `attr:<name>` / `ext:<local>` of
 *    W_C7_MISPLACED_ATTRIBUTE, W_C7_MISPLACED_EXTENSION and their Camunda 8
 *    twins);
 *  - ext's W_MISPLACED_EXTENSION for zeebe content covers W_C8_MISPLACED_EXTENSION;
 *  - `set calledDecision=` W_DECISION_RESULT_VARIABLE covers the Camunda 8
 *    profile's finding about the missing resultVariable.
 *
 * Without the profile (`--platform none`, a file of another platform) the
 * operation warning stays.
 */
import type { Warning } from '../errors.js';
import { subjectOf, type ProfileFinding } from '../platform/finding.js';

/** Hidden list of profile subjects an operation warning repeats (not serialised). */
const COVERS: unique symbol = Symbol('covered-profile-subjects');

/** Marks an operation warning as repeating the given profile subjects (`ext:<local>`, `attr:<name>`, ...): dropped when the profile reports them all on its element. */
export function coversProfileSubjects<W extends Warning>(warning: W, subjects: string[]): W {
  Object.defineProperty(warning, COVERS, { value: subjects, enumerable: false });
  return warning;
}

/**
 * The warnings of a mutation without the ones its platform-profile findings
 * already report (see the module header). For the pipeline / printMutation:
 * `changes.warnings = withoutProfileDuplicates(changes.warnings, validation.warnings)`.
 */
export function withoutProfileDuplicates(warnings: Warning[], validation: readonly Warning[]): Warning[] {
  return warnings.filter((w) => {
    const covers = (w as Warning & { [COVERS]?: string[] })[COVERS];
    if (!covers?.length) return true;
    const reported = new Set(validation.filter((v) => v.element === w.element && 'severity' in v).map((v) => subjectOf(v as ProfileFinding)));
    return !covers.every((s) => reported.has(s));
  });
}
