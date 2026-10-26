import type { El } from '../../../model/utils/moddle.js';

export function peek<T>(el: El | undefined, prop: string): T | undefined {
  return el ? ((el as unknown as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

export function list(el: El | undefined, prop: string): El[] {
  const v = peek<unknown>(el, prop);
  return Array.isArray(v) ? (v as El[]) : [];
}

export function idOf(el: El | undefined): string | undefined {
  const id = peek<string>(el, 'id');
  return typeof id === 'string' && id ? id : undefined;
}

export function isGeneric(el: El): boolean {
  return !!(el.$descriptor as { isGeneric?: boolean }).isGeneric;
}

export function localName(type: string): string {
  return type.slice(type.indexOf(':') + 1);
}

/** An attribute of a generic vendor element (plain name, e.g. `event`). */
export function attr(el: El | undefined, name: string): string | undefined {
  const v = peek<unknown>(el, name);
  return v === undefined || v === null ? undefined : String(v);
}

export function nameOf(el: El | undefined): string | undefined {
  const n = peek<string>(el, 'name');
  return typeof n === 'string' && n.trim() !== '' ? n : undefined;
}

/** `message`, `timer`, ... (the trigger name `bpmn set trigger=` takes) of an event definition. */
export function triggerName(def: El): string {
  return localName(def.$type).replace(/EventDefinition$/, '').replace(/^./, (c) => c.toLowerCase());
}

export const TIMER_ELEMENTS = ['timeDate', 'timeCycle', 'timeDuration'];

