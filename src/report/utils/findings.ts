import type { LayoutStatus } from '../../pipeline/index.js';
import type { Warning } from '../../shared/CliError.js';
import type { ValidatorReport } from '../../validate/validators.js';

/** This many warnings of one code (and validator) or more are printed as one line. */
export const FLOOD_MIN = 3;

export const FLOOD_IDS = 30;

export function validatorOf(w: Warning): string | undefined {
  return (w as Warning & { validator?: string }).validator;
}

export function validatorTag(w: Warning): string {
  const name = validatorOf(w);
  return name ? `[${name}] ` : '';
}

/** Only an advisory validator's errors appear among warnings: they read `[bpmnlint error] `. */
export function warningTag(w: Warning): string {
  const name = validatorOf(w);
  return name && (w as Warning & { severity?: string }).severity === 'error' ? `[${name} error] ` : validatorTag(w);
}

export function idsText(ids: string[]): string {
  return ids.length > FLOOD_IDS ? `${ids.slice(0, FLOOD_IDS).join(', ')}, +${ids.length - FLOOD_IDS} more` : ids.join(', ');
}

export function floodKey(w: Warning): string {
  return `${validatorTag(w)}${w.code}`;
}

/** `W_DEAD_END Activity_A, W_UNREACHABLE x5 [A, B, C, D, E]` */
export function findingList(findings: readonly Warning[]): string {
  const groups = new Map<string, Warning[]>();
  for (const f of findings) groups.set(floodKey(f), [...(groups.get(floodKey(f)) ?? []), f]);
  return [...groups]
    .map(([key, group]) => (group.length === 1 ? `${key}${group[0]!.element ? ` ${group[0]!.element}` : ''}` : `${key} x${group.length} [${idsText(group.map((g) => g.element ?? '?'))}]`))
    .join(', ');
}

export function advisoryOf(reports: readonly ValidatorReport[] | undefined): Set<string> {
  return new Set((reports ?? []).filter((r) => r.blocks === false).map((r) => r.name));
}

export function layoutWarnings(layout: LayoutStatus): Warning[] {
  return layout.warnings.map((w) => ({ code: `W_LAYOUT_${w.code}`, message: w.message, element: w.elementId }));
}
