/**
 * Containment in the moddle tree: which property of its parent holds an
 * element, taking it out, and the references to removed elements.
 */
import { walk, type El } from '../../model/utils/moddle.js';
import { descriptorOf, isEl, ownValue } from './elements.js';

/** True when `parent` contains `child` in one of its containment properties. */
export function contains(parent: El, child: El): boolean {
  const d = descriptorOf(parent);
  if (d.isGeneric) {
    const kids = (parent as unknown as { $children?: unknown[] }).$children;
    return Array.isArray(kids) && kids.includes(child);
  }
  for (const p of d.properties ?? []) {
    if (p.isReference) continue;
    const v = ownValue(parent, p.name);
    if (Array.isArray(v) ? v.includes(child) : v === child) return true;
  }
  return false;
}

/** Detaches an element from whichever containment property of its parent holds it. */
export function detachFromParent(el: El): El | undefined {
  const parent = el.$parent as El | undefined;
  if (!parent) return undefined;
  for (const p of descriptorOf(parent).properties ?? []) {
    if (p.isReference) continue;
    const v = ownValue(parent, p.name);
    if (Array.isArray(v)) {
      const i = v.indexOf(el);
      if (i !== -1) {
        v.splice(i, 1);
        return parent;
      }
    } else if (v === el) {
      parent.set(p.name, undefined);
      return parent;
    }
  }
  return parent;
}

/** All references from the (remaining) tree to any element of `targets`. */
export function referencesToAny(root: El, targets: Set<El>): Array<{ holder: El; prop: string; isMany: boolean; target: El }> {
  const refs: Array<{ holder: El; prop: string; isMany: boolean; target: El }> = [];
  for (const el of walk(root)) {
    const d = descriptorOf(el);
    if (d.isGeneric) continue;
    for (const p of d.properties ?? []) {
      if (!p.isReference) continue;
      const v = ownValue(el, p.name);
      if (p.isMany) {
        if (Array.isArray(v)) for (const t of v) if (isEl(t) && targets.has(t)) refs.push({ holder: el, prop: p.name, isMany: true, target: t });
      } else if (isEl(v) && targets.has(v)) {
        refs.push({ holder: el, prop: p.name, isMany: false, target: v });
      }
    }
  }
  return refs;
}

/** The element itself, or its nearest ancestor that has an id. */
export function nearestWithId(el: El): El | undefined {
  let cur: El | undefined = el;
  while (cur && !cur.get<string | undefined>('id')) cur = cur.$parent as El | undefined;
  return cur;
}
