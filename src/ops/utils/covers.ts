/**
 * An operation warning that repeats what the platform profile reports item by item is
 * dropped: the profile findings carry a severity and a fix each. Without a profile it stays.
 */
import type { Warning } from '../../shared/CliError.js';
import { subjectOf, type ProfileFinding } from '../../platform/utils/finding.js';

/** Not enumerable, so it is never serialised. */
const COVERS: unique symbol = Symbol('covered-profile-subjects');

/** The warning is dropped when the profile reports all `subjects` on its element. */
export function coversProfileSubjects<W extends Warning>(warning: W, subjects: string[]): W {
  Object.defineProperty(warning, COVERS, { value: subjects, enumerable: false });
  return warning;
}

export function withoutProfileDuplicates(warnings: Warning[], validation: readonly Warning[]): Warning[] {
  return warnings.filter((w) => {
    const covers = (w as Warning & { [COVERS]?: string[] })[COVERS];
    if (!covers?.length) return true;
    const reported = new Set(validation.filter((v) => v.element === w.element && 'severity' in v).map((v) => subjectOf(v as ProfileFinding)));
    return !covers.every((s) => reported.has(s));
  });
}
