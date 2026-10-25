import type { GNode } from '../../../diagram/types.js';

/** safe to cache: a layout object lives for one run, which renames nothing */
const names = new WeakMap<object, string | null>();

export function nameOf(o: { el: GNode['el'] }): string | undefined {
  let name = names.get(o);
  if (name === undefined) names.set(o, (name = o.el.get<string | undefined>('name') ?? null));
  return name ?? undefined;
}
