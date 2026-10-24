import type { Warning } from '../../shared/CliError.js';

/**
 * The lint warnings that platform `findings` say again with the engine's
 * verdict: a W_EVENT_GATEWAY_TARGET about the same branch as a platform
 * event-gateway finding, a W_NO_START / W_EMPTY_SUBPROCESS about the same
 * (sub-)process as a missing-start finding ("(sub-)process X has no start
 * event; the engines refuse the file"). StructuralValidator.withProfile drops
 * them from the warnings, FindingBaseline.delta from the resolved ones.
 */
export function lintCoveredBy(findings: readonly Warning[]): (w: Warning) => boolean {
  const gateway = new Set(findings.filter((f) => (f.code.startsWith('W_C7_') || f.code.startsWith('W_C8_')) && f.code.includes('EVENT_GATEWAY')).map((f) => `${f.element}|${f.related?.[0] ?? ''}`));
  const noStart = new Set(findings.filter((f) => (f.code === 'W_C7_DEPLOY_START_EVENT' || f.code === 'W_C7_TRANSACTION_NO_START' || f.code === 'W_C8_DEPLOY_START_EVENT') && !f.related?.length).map((f) => f.element));
  return (w) => (w.code === 'W_EVENT_GATEWAY_TARGET' && gateway.has(`${w.element}|${w.related?.[0] ?? ''}`)) || ((w.code === 'W_NO_START' || w.code === 'W_EMPTY_SUBPROCESS') && noStart.has(w.element));
}
