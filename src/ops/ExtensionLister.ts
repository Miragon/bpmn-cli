import { many, type El } from '../model/utils/moddle.js';
import { descriptorOf, isEl, nestedEntries } from './set.js';

export interface ExtensionInfo {
  index: number;
  /**
   * set for the extension elements of a nested element (`ext list`): definition / loop / condition,
   * `definition[<n>]` for one of several event definitions of an event
   */
  slot?: string;
  type: string;
  attrs: Record<string, string>;
  body?: string;
  children?: Array<Omit<ExtensionInfo, 'index'>>;
}

/** `ext list` and `show <id>`: [{index, type, attrs, body?, children?: [...]}]. */
export class ExtensionLister {
  /** The extension elements of an element, in order. */
  list(el: El): ExtensionInfo[] {
    const container = el.get<El | undefined>('extensionElements');
    if (!container) return [];
    return many(container, 'values').map((v, index) => ({ index, ...this.describe(v) }));
  }

  /**
   * `ext list`: the element's own extension elements, then those of its nested
   * elements (event definition, loop characteristics, condition expression),
   * each with its slot (`ext remove <file> <id> loop.0`).
   */
  listAll(el: El): ExtensionInfo[] {
    const out = this.list(el);
    for (const { prefix, el: nested } of nestedEntries(el)) out.push(...this.list(nested).map((i) => ({ ...i, slot: prefix })));
    return out;
  }

  private describe(v: El): Omit<ExtensionInfo, 'index'> {
    const info: Omit<ExtensionInfo, 'index'> = { type: v.$type, attrs: {} };
    const d = descriptorOf(v);
    if (d.isGeneric) {
      const raw = v as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(raw)) {
        if (k.startsWith('$') || val === undefined || val === null || typeof val === 'object' || typeof val === 'function') continue;
        info.attrs[k] = String(val);
      }
      if (typeof raw['$body'] === 'string') info.body = raw['$body'];
      const kids = (raw['$children'] as unknown[] | undefined)?.filter(isEl) ?? [];
      if (kids.length) info.children = kids.map((k) => this.describe(k));
      return info;
    }
    for (const p of d.properties ?? []) {
      const val = (v as unknown as Record<string, unknown>)[p.name];
      if (val === undefined || val === null) continue;
      if (p.isBody && typeof val === 'string') info.body = val;
      else if (p.isAttr && typeof val !== 'object') info.attrs[p.name] = String(val);
    }
    return info;
  }
}
