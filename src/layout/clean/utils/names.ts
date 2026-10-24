import type { GNode } from '../../../diagram/types.js';

/** the names of the layout's nodes, flows and artifacts, read once each (a layout object lives for one run, which renames nothing) */
const names = new WeakMap<object, string | null>();

/** The name of the element of a node, flow or artifact of the layout. */
export function nameOf(o: { el: GNode['el'] }): string | undefined {
  let name = names.get(o);
  if (name === undefined) names.set(o, (name = o.el.get<string | undefined>('name') ?? null));
  return name ?? undefined;
}
