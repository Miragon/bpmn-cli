import { many, type El } from './utils/moddle.js';
import { descriptorOf, isEl } from './utils/elements.js';
import { nestedEntries } from './utils/nested-slots.js';

export interface ExtensionInfo {
  index: number;
  /** The nested element it belongs to: `definition`, `loop`, `condition` or `definition[<n>]`. */
  slot?: string;
  type: string;
  attrs: Record<string, string>;
  body?: string;
  children?: Array<Omit<ExtensionInfo, 'index'>>;
}

/** Lists extension elements for `ext list` and `show <id>`. */
export class ExtensionLister {
  list(el: El): ExtensionInfo[] {
    const container = el.get<El | undefined>('extensionElements');
    if (!container) return [];
    return many(container, 'values').map((extension, index) => ({ index, ...this.describe(extension) }));
  }

  /** Own extension elements first, then those of nested elements, each with its slot. */
  listAll(el: El): ExtensionInfo[] {
    const out = this.list(el);
    for (const { prefix, el: nested } of nestedEntries(el)) out.push(...this.list(nested).map((info) => ({ ...info, slot: prefix })));
    return out;
  }

  private describe(extension: El): Omit<ExtensionInfo, 'index'> {
    const info: Omit<ExtensionInfo, 'index'> = { type: extension.$type, attrs: {} };
    const descriptor = descriptorOf(extension);
    if (descriptor.isGeneric) {
      const raw = extension as unknown as Record<string, unknown>;
      for (const [attrName, val] of Object.entries(raw)) {
        if (attrName.startsWith('$') || val === undefined || val === null || typeof val === 'object' || typeof val === 'function') continue;
        info.attrs[attrName] = String(val);
      }
      if (typeof raw['$body'] === 'string') info.body = raw['$body'];
      const kids = (raw['$children'] as unknown[] | undefined)?.filter(isEl) ?? [];
      if (kids.length) info.children = kids.map((kid) => this.describe(kid));
      return info;
    }
    for (const property of descriptor.properties ?? []) {
      const val = (extension as unknown as Record<string, unknown>)[property.name];
      if (val === undefined || val === null) continue;
      if (property.isBody && typeof val === 'string') info.body = val;
      else if (property.isAttr && typeof val !== 'object') info.attrs[property.name] = String(val);
    }
    return info;
  }
}
