import { groupName, is, peek, shownId, walk, type El } from '../../document/utils/moddle.js';

export function nameOf(el: El): string | undefined {
  if (is(el, 'bpmn:Group')) return groupName(el);
  const rawName = peek<unknown>(el, 'name');
  return typeof rawName === 'string' && rawName ? rawName : undefined;
}

export function ownNameOf(el: El | undefined): string | undefined {
  const rawName = el ? peek<unknown>(el, 'name') : undefined;
  return typeof rawName === 'string' && rawName ? rawName : undefined;
}

/** Drops undefined-valued keys so JSON output stays compact. */
export function compact<TObject extends object>(obj: TObject): TObject {
  for (const key of Object.keys(obj) as Array<keyof TObject>) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

export function nonEmpty<TItem>(items: TItem[]): TItem[] | undefined {
  return items.length ? items : undefined;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

export function refLabel(ref: El | undefined): string {
  if (!ref) return '?';
  return nameOf(ref) ?? shownId(ref);
}

export function bodyOf(expr: El | undefined): string | undefined {
  if (!expr) return undefined;
  const body = peek<unknown>(expr, 'body');
  return typeof body === 'string' && body ? body : undefined;
}

/** camunda:resource under any prefix. */
export function resourceOf(expr: El | undefined): { key: string; value: string } | undefined {
  if (!expr) return undefined;
  const key = Object.keys(expr.$attrs ?? {}).find((attributeName) => /:resource$/.test(attributeName) && !attributeName.startsWith('xmlns'));
  const value = key ? expr.$attrs[key] : undefined;
  return key && typeof value === 'string' && value ? { key, value } : undefined;
}

export function scopesWithin(process: El): El[] {
  return [...walk(process)].filter((element) => is(element, 'bpmn:Process') || is(element, 'bpmn:SubProcess'));
}

