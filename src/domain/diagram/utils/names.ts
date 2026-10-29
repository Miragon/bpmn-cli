import type { GNode } from '../di/types.js';

/** safe to cache: a layout object lives for one run, which renames nothing */
const names = new WeakMap<object, string | null>();

export function nameOf(element: { el: GNode['el'] }): string | undefined {
  let name = names.get(element);
  if (name === undefined) {
    names.set(element, (name = element.el.get<string | undefined>('name') ?? null));
  }
  return name ?? undefined;
}
