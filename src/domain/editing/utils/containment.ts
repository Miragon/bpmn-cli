import { walk, type El } from '../../document/utils/moddle.js';
import { descriptorOf, isEl, ownValue } from '../../document/utils/elements.js';

export function contains(parent: El, child: El): boolean {
  const descriptor = descriptorOf(parent);
  if (descriptor.isGeneric) {
    const kids = (parent as unknown as { $children?: unknown[] }).$children;
    return Array.isArray(kids) && kids.includes(child);
  }
  for (const property of descriptor.properties ?? []) {
    if (property.isReference) continue;
    const propValue = ownValue(parent, property.name);
    if (Array.isArray(propValue) ? propValue.includes(child) : propValue === child) {
      return true;
    }
  }
  return false;
}

export function detachFromParent(el: El, replacement?: El): El | undefined {
  const parent = el.$parent as El | undefined;
  if (!parent) return undefined;
  for (const property of descriptorOf(parent).properties ?? []) {
    if (property.isReference) continue;
    const propValue = ownValue(parent, property.name);
    if (Array.isArray(propValue)) {
      const index = propValue.indexOf(el);
      if (index === -1) continue;
      if (replacement) {
        propValue[index] = replacement;
      } else {
        propValue.splice(index, 1);
      }
    } else {
      if (propValue !== el) continue;
      parent.set(property.name, replacement);
    }
    if (replacement) replacement.$parent = parent;
    return parent;
  }
  return parent;
}

export function referencesToAny(root: El, targets: Set<El>): Array<{ holder: El; prop: string; isMany: boolean; target: El }> {
  const refs: Array<{ holder: El; prop: string; isMany: boolean; target: El }> = [];
  for (const el of walk(root)) {
    const descriptor = descriptorOf(el);
    if (descriptor.isGeneric) continue;
    for (const property of descriptor.properties ?? []) {
      if (!property.isReference) continue;
      const propValue = ownValue(el, property.name);
      if (property.isMany) {
        if (Array.isArray(propValue)) {
          for (const entry of propValue) {
            if (isEl(entry) && targets.has(entry)) {
              refs.push({ holder: el, prop: property.name, isMany: true, target: entry });
            }
          }
        }
      } else if (isEl(propValue) && targets.has(propValue)) {
        refs.push({ holder: el, prop: property.name, isMany: false, target: propValue });
      }
    }
  }
  return refs;
}

export function nearestWithId(el: El): El | undefined {
  let cur: El | undefined = el;
  while (cur && !cur.get<string | undefined>('id')) {
    cur = cur.$parent as El | undefined;
  }
  return cur;
}
