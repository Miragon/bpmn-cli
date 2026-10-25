import type { El } from '../../../../model/utils/moddle.js';
import { peek } from '../../utils/element.js';
import { lowerFirst, sh } from '../../utils/hint.js';

/**
 * `bpmn ext add` arguments that re-create a flat generic element (attributes and body),
 * or undefined when it has children; `fix` replaces attribute values (placeholders).
 */
export function extAddArgs(v: El, type: string, fix: Record<string, string> = {}): string | undefined {
  const kids = peek<unknown[]>(v, '$children');
  if (Array.isArray(kids) && kids.length) return undefined;
  const entries = Object.entries(v as unknown as Record<string, unknown>).filter(([k]) => !k.startsWith('$') && !k.startsWith('xmlns'));
  for (const k of Object.keys(fix)) if (!entries.some(([e]) => e === k)) entries.push([k, fix[k]]);
  const attrs = entries.map(([k, val]) => sh(`${k}=${k in fix ? fix[k] : String(val)}`));
  const body = peek<string>(v, '$body');
  return [type, ...attrs, ...(body !== undefined ? ['--body', sh(String(body))] : [])].join(' ');
}

/** `userTask, sendTask, ...` for BPMN types (`bpmn:UserTask`), at most four of them. */
export function kindsText(owners: string[]): string {
  const names = owners.map((o) => lowerFirst(o.replace(/^bpmn:/, '')));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
}
