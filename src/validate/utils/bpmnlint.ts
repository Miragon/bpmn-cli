import type { BpmnlintConfig, BpmnlintUnavailable } from '../bpmnlint-validator.js';
import type { ValidatorFinding } from '../validators.js';

export const MODDLE_NOT_A_MAP = 'it is not an object of prefix -> descriptor or module path (bpmnlint fails on the whole file with it)';

/** An object only (an array too, like bpmnlint's for-in); a string or a number has none. */
export function moddleEntries(config: BpmnlintConfig): Array<[string, unknown]> {
  const map: unknown = config.moddleExtensions;
  return map && typeof map === 'object' ? Object.entries(map) : [];
}

/** One per package and reason, the same in every phase: a write only counts them. */
export function bpmnlintUnavailableFindings(list: readonly BpmnlintUnavailable[]): ValidatorFinding[] {
  const groups = new Map<string, BpmnlintUnavailable[]>();
  for (const u of list) {
    const key = `${u.kind === 'config' || u.kind === 'rule' ? 'package' : u.kind}|${u.pkg}|${u.reason}`;
    const group = groups.get(key);
    if (group) group.push(u);
    else groups.set(key, [u]);
  }
  return [...groups].map(([key, group]) => {
    const first = group[0]!;
    const names = group.map((u) => u.name).join(', ');
    const message =
      first.kind === 'file' || first.kind === 'engine'
        ? `${first.reason}; bpmnlint did not run`
        : first.kind === 'moddle' && first.reason === MODDLE_NOT_A_MAP
          ? `moddleExtensions ${first.pkg} left out: ${first.reason}; rules reading the properties of a moddle extension may report findings that are not there`
          : first.kind === 'moddle'
            ? `moddle extension ${names} (${first.pkg}) left out: ${first.reason}; rules reading ${group.map((u) => `${u.name}:`).join(', ')} properties may report findings that are not there`
            : `${names} left out: ${first.reason}`;
    return { severity: 'warning', code: 'W_LINT_UNAVAILABLE', message, key: `unavailable|${key}|${names}`, ...(first.hint ? { hint: first.hint } : {}) };
  });
}
