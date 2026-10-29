import type { LayoutStatus } from '../../../../domain/diagram/types.js';
import type { Finding } from '../../../../domain/document/Finding.js';
import type { ValidatorReport } from '../../../../domain/validation/validators.js';

/** This many warnings of one code (and validator) or more are printed as one line. */
export const FLOOD_MIN = 3;

const FLOOD_IDS = 30;

export function validatorTag(warning: Finding): string {
  return warning.validator ? `[${warning.validator}] ` : '';
}

/** Only an advisory validator's errors appear among warnings: they read `[bpmnlint error] `. */
export function warningTag(warning: Finding): string {
  return warning.validator && warning.severity === 'error' ? `[${warning.validator} error] ` : validatorTag(warning);
}

export function idsText(ids: string[]): string {
  return ids.length > FLOOD_IDS ? `${ids.slice(0, FLOOD_IDS).join(', ')}, +${ids.length - FLOOD_IDS} more` : ids.join(', ');
}

export function floodKey(warning: Finding): string {
  return `${validatorTag(warning)}${warning.code}`;
}

/** `W_DEAD_END task_a, W_UNREACHABLE x5 [A, B, C, D, E]` */
export function findingList(findings: readonly Finding[]): string {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    groups.set(floodKey(finding), [...(groups.get(floodKey(finding)) ?? []), finding]);
  }
  return [...groups]
    .map(([key, group]) => (group.length === 1 ? `${key}${group[0]!.element ? ` ${group[0]!.element}` : ''}` : `${key} x${group.length} [${idsText(group.map((group) => group.element ?? '?'))}]`))
    .join(', ');
}

export function advisoryOf(reports: readonly ValidatorReport[] | undefined): Set<string> {
  return new Set((reports ?? []).filter((report) => report.blocks === false).map((report) => report.name));
}

export function layoutWarnings(layout: LayoutStatus): Finding[] {
  return layout.warnings.map((warning) => ({ code: `W_LAYOUT_${warning.code}`, message: warning.message, element: warning.elementId }));
}
