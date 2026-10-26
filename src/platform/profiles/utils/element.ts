import type { El } from '../../../model/utils/moddle.js';

export function peek<TValue>(el: El | undefined, prop: string): TValue | undefined {
  return el ? ((el as unknown as Record<string, unknown>)[prop] as TValue | undefined) : undefined;
}

export function list(el: El | undefined, prop: string): El[] {
  const propValue = peek<unknown>(el, prop);
  return Array.isArray(propValue) ? (propValue as El[]) : [];
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
  const propValue = peek<unknown>(el, name);
  return propValue === undefined || propValue === null ? undefined : String(propValue);
}

export function nameOf(el: El | undefined): string | undefined {
  const name = peek<string>(el, 'name');
  return typeof name === 'string' && name.trim() !== '' ? name : undefined;
}

/** `message`, `timer`, ... (the trigger name `bpmn set trigger=` takes) of an event definition. */
export function triggerName(def: El): string {
  return localName(def.$type).replace(/EventDefinition$/, '').replace(/^./, (firstChar) => firstChar.toLowerCase());
}

export const TIMER_ELEMENTS = ['timeDate', 'timeCycle', 'timeDuration'];

