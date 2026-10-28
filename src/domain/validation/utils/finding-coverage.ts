import type { Finding } from '../../document/Finding.js';
import type { ValidatorRun } from '../validators.js';

/** The lint warnings that platform `findings` say again with the engine's verdict. */
export function lintCoveredBy(findings: readonly Finding[]): (warning: Finding) => boolean {
  const gateway = new Set(findings.filter((finding) => (finding.code.startsWith('W_C7_') || finding.code.startsWith('W_C8_')) && finding.code.includes('EVENT_GATEWAY')).map((finding) => `${finding.element}|${finding.related?.[0] ?? ''}`));
  const noStart = new Set(findings.filter((finding) => (finding.code === 'W_C7_DEPLOY_START_EVENT' || finding.code === 'W_C7_TRANSACTION_NO_START' || finding.code === 'W_C8_DEPLOY_START_EVENT') && !finding.related?.length).map((finding) => finding.element));
  return (warning) => (warning.code === 'W_EVENT_GATEWAY_TARGET' && gateway.has(`${warning.element}|${warning.related?.[0] ?? ''}`)) || ((warning.code === 'W_NO_START' || warning.code === 'W_EMPTY_SUBPROCESS') && noStart.has(warning.element));
}

/** The lintKey of the lint warning the issue says again about the same element. */
export function coveredLint(run: Pick<ValidatorRun, 'covers'>, issue: Finding): string | undefined {
  const lint = run.covers?.[issue.code];
  return lint && issue.element ? `${lint}|${issue.element}` : undefined;
}

export function lintKey(warning: Finding): string {
  return `${warning.code}|${warning.element ?? ''}`;
}

/**
 * An operation warning that repeats what the platform profile reports item by item is
 * dropped: the profile findings carry a severity and a fix each. Without a profile it stays.
 */
export function withoutProfileDuplicates(warnings: Finding[], validation: readonly Finding[]): Finding[] {
  return warnings.filter((warning) => {
    if (!warning.covers?.length) return true;
    const reported = new Set(validation.filter((finding) => finding.element === warning.element && 'severity' in finding).map((finding) => finding.subject ?? ''));
    return !warning.covers.every((subject) => reported.has(subject));
  });
}
