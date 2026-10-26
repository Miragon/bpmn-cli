/**
 * An operation warning that repeats what the platform profile reports item by item is
 * dropped: the profile findings carry a severity and a fix each. Without a profile it stays.
 */
import type { Warning } from '../../shared/CliError.js';
import { subjectOf, type ProfileFinding } from '../../platform/utils/finding.js';

/** Not enumerable, so it is never serialised. */
const COVERS: unique symbol = Symbol('covered-profile-subjects');

/** The warning is dropped when the profile reports all `subjects` on its element. */
export function coversProfileSubjects<TWarning extends Warning>(warning: TWarning, subjects: string[]): TWarning {
  Object.defineProperty(warning, COVERS, { value: subjects, enumerable: false });
  return warning;
}

export function withoutProfileDuplicates(warnings: Warning[], validation: readonly Warning[]): Warning[] {
  return warnings.filter((warning) => {
    const covers = (warning as Warning & { [COVERS]?: string[] })[COVERS];
    if (!covers?.length) return true;
    const reported = new Set(validation.filter((finding) => finding.element === warning.element && 'severity' in finding).map((finding) => subjectOf(finding as ProfileFinding)));
    return !covers.every((subject) => reported.has(subject));
  });
}
