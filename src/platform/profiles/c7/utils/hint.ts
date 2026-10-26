import type { El } from '../../../../model/utils/moddle.js';
import { peek } from '../../utils/element.js';
import { lowerFirst, sh } from '../../utils/hint.js';

/**
 * `bpmn ext add` arguments that re-create a flat generic element (attributes and body),
 * or undefined when it has children; `fix` replaces attribute values (placeholders).
 */
export function extAddArgs(vendorElement: El, type: string, fix: Record<string, string> = {}): string | undefined {
  const kids = peek<unknown[]>(vendorElement, '$children');
  if (Array.isArray(kids) && kids.length) return undefined;
  const entries = Object.entries(vendorElement as unknown as Record<string, unknown>).filter(([key]) => !key.startsWith('$') && !key.startsWith('xmlns'));
  for (const key of Object.keys(fix)) if (!entries.some(([existingKey]) => existingKey === key)) entries.push([key, fix[key]]);
  const attrs = entries.map(([key, val]) => sh(`${key}=${key in fix ? fix[key] : String(val)}`));
  const body = peek<string>(vendorElement, '$body');
  return [type, ...attrs, ...(body !== undefined ? ['--body', sh(String(body))] : [])].join(' ');
}

/** `userTask, sendTask, ...` for BPMN types (`bpmn:UserTask`), at most four of them. */
export function kindsText(owners: string[]): string {
  const names = owners.map((ownerType) => lowerFirst(ownerType.replace(/^bpmn:/, '')));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
}
