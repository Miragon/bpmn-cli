import type { Warning } from '../../shared/CliError.js';

/** The lint warnings that platform `findings` say again with the engine's verdict. */
export function lintCoveredBy(findings: readonly Warning[]): (warning: Warning) => boolean {
  const gateway = new Set(findings.filter((finding) => (finding.code.startsWith('W_C7_') || finding.code.startsWith('W_C8_')) && finding.code.includes('EVENT_GATEWAY')).map((finding) => `${finding.element}|${finding.related?.[0] ?? ''}`));
  const noStart = new Set(findings.filter((finding) => (finding.code === 'W_C7_DEPLOY_START_EVENT' || finding.code === 'W_C7_TRANSACTION_NO_START' || finding.code === 'W_C8_DEPLOY_START_EVENT') && !finding.related?.length).map((finding) => finding.element));
  return (warning) => (warning.code === 'W_EVENT_GATEWAY_TARGET' && gateway.has(`${warning.element}|${warning.related?.[0] ?? ''}`)) || ((warning.code === 'W_NO_START' || warning.code === 'W_EMPTY_SUBPROCESS') && noStart.has(warning.element));
}
