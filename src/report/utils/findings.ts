import type { LayoutStatus } from '../../pipeline/index.js';
import type { Warning } from '../../shared/CliError.js';
import type { ValidatorReport } from '../../validate/validators.js';

/** This many warnings of one code (and validator) or more are printed as one line. */
export const FLOOD_MIN = 3;

export const FLOOD_IDS = 30;

export function validatorOf(warning: Warning): string | undefined {
  return (warning as Warning & { validator?: string }).validator;
}

export function validatorTag(warning: Warning): string {
  const name = validatorOf(warning);
  return name ? `[${name}] ` : '';
}

/** Only an advisory validator's errors appear among warnings: they read `[bpmnlint error] `. */
export function warningTag(warning: Warning): string {
  const name = validatorOf(warning);
  return name && (warning as Warning & { severity?: string }).severity === 'error' ? `[${name} error] ` : validatorTag(warning);
}

export function idsText(ids: string[]): string {
  return ids.length > FLOOD_IDS ? `${ids.slice(0, FLOOD_IDS).join(', ')}, +${ids.length - FLOOD_IDS} more` : ids.join(', ');
}

export function floodKey(warning: Warning): string {
  return `${validatorTag(warning)}${warning.code}`;
}

/** `W_DEAD_END Activity_A, W_UNREACHABLE x5 [A, B, C, D, E]` */
export function findingList(findings: readonly Warning[]): string {
  const groups = new Map<string, Warning[]>();
  for (const finding of findings) groups.set(floodKey(finding), [...(groups.get(floodKey(finding)) ?? []), finding]);
  return [...groups]
    .map(([key, group]) => (group.length === 1 ? `${key}${group[0]!.element ? ` ${group[0]!.element}` : ''}` : `${key} x${group.length} [${idsText(group.map((group) => group.element ?? '?'))}]`))
    .join(', ');
}

export function advisoryOf(reports: readonly ValidatorReport[] | undefined): Set<string> {
  return new Set((reports ?? []).filter((report) => report.blocks === false).map((report) => report.name));
}

export function layoutWarnings(layout: LayoutStatus): Warning[] {
  return layout.warnings.map((warning) => ({ code: `W_LAYOUT_${warning.code}`, message: warning.message, element: warning.elementId }));
}
