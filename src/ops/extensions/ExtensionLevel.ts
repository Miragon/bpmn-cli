import type { Doc } from '../../model/Doc.js';
import { addTo, many, removeFrom, type El } from '../../model/utils/moddle.js';
import { EXTENSION_STRUCTURE } from './ExtensionStructure.js';
import type { Step } from '../parsing/SelectorParser.js';
import type { VendorElements } from '../VendorElements.js';
import { ruleName } from '../utils/vendor-family.js';

type Raw = Record<string, unknown>;

/** One level of extension content: the top of extensionElements or a vendor element's children. */
export class ExtensionLevel {
  constructor(
    private readonly doc: Doc,
    private readonly names: VendorElements,
    readonly host: El,
    readonly parent?: El,
  ) {}

  static present(levels: ExtensionLevel[]): string[] {
    return [...new Set(levels.flatMap((lv) => lv.items().map((item) => lv.names.itemLabel(item))))];
  }

  get type(): string | undefined {
    return this.parent ? this.names.typeOf(this.parent) : undefined;
  }

  get label(): string {
    return this.parent ? this.names.itemLabel(this.parent) : 'extensionElements';
  }

  inside(parent: El): ExtensionLevel {
    return new ExtensionLevel(this.doc, this.names, this.host, parent);
  }

  items(): El[] {
    if (this.parent) return this.names.kidsOf(this.parent);
    const container = this.host.get<El | undefined>('extensionElements');
    return container ? [...many(container, 'values')] : [];
  }

  /** Keeps the child order of containers whose schema is a sequence. */
  append(el: El): void {
    if (this.parent) {
      const raw = this.parent as unknown as Raw;
      const kids = Array.isArray(raw['$children']) ? (raw['$children'] as El[]) : [];
      const order = EXTENSION_STRUCTURE.childOrder(this.type!);
      const rank = (item: El): number => (order ? order.indexOf(ruleName(this.names.typeOf(item))) : -1);
      const mine = rank(el);
      const at = mine === -1 ? -1 : kids.findIndex((kid) => rank(kid) > mine);
      if (at === -1) kids.push(el);
      else kids.splice(at, 0, el);
      raw['$children'] = kids;
      el.$parent = this.parent;
      return;
    }
    addTo(this.ensureContainer(), 'values', el);
  }

  replace(old: El, el: El): void {
    const list = this.parent ? ((this.parent as unknown as Raw)['$children'] as El[]) : many(this.host.get<El>('extensionElements'), 'values');
    const index = list.indexOf(old);
    list[index] = el;
    el.$parent = this.parent ?? this.host.get<El>('extensionElements');
  }

  remove(el: El): void {
    if (this.parent) {
      const raw = this.parent as unknown as Raw;
      const kids = raw['$children'] as El[] | undefined;
      if (!kids) return;
      const index = kids.indexOf(el);
      if (index !== -1) kids.splice(index, 1);
      if (!kids.length) delete raw['$children'];
      return;
    }
    const container = this.host.get<El | undefined>('extensionElements');
    if (container) removeFrom(container, 'values', el);
  }

  /** A child type absent at this level is looked up in its container. */
  select(step: Step): Array<{ el: El; level: ExtensionLevel }> {
    const wanted = this.names.canonicalName(step.name);
    const pick = (lv: ExtensionLevel): Array<{ el: El; level: ExtensionLevel }> => {
      const hits = lv.items().filter((item) => this.matches(item, step, wanted));
      if (step.index !== undefined) {
        const hit = hits[step.index];
        return hit ? [{ el: hit, level: lv }] : [];
      }
      return hits.map((item) => ({ el: item, level: lv }));
    };
    const direct = pick(this);
    if (direct.length) return direct;
    const home = EXTENSION_STRUCTURE.homeAt(wanted, this.type);
    if (!home) return [];
    return this.items()
      .filter((item) => this.names.typeOf(item) === home)
      .flatMap((container) => pick(this.inside(container)));
  }

  selectDeep(step: Step): Array<{ el: El; level: ExtensionLevel }> {
    const out: Array<{ el: El; level: ExtensionLevel }> = [];
    const wanted = this.names.canonicalName(step.name);
    const visit = (lv: ExtensionLevel): void => {
      for (const item of lv.items()) {
        if (this.matches(item, step, wanted)) out.push({ el: item, level: lv });
        if (this.names.isGeneric(item)) visit(lv.inside(item));
      }
    };
    visit(this);
    return out;
  }

  private matches(el: El, step: Step, wanted: string): boolean {
    if (this.names.typeOf(el) !== wanted && el.$type !== step.name) return false;
    if (step.attr !== undefined) return this.names.attrsOf(el)[step.attr] === step.value;
    return true;
  }

  private ensureContainer(): El {
    const el = this.host;
    let container = el.get<El | undefined>('extensionElements');
    if (!container) {
      container = this.doc.moddle.create('bpmn:ExtensionElements');
      container.$parent = el;
      el.set('extensionElements', container);
    }
    return container;
  }
}
