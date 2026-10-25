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
    return [...new Set(levels.flatMap((lv) => lv.items().map((e) => lv.names.itemLabel(e))))];
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
    const c = this.host.get<El | undefined>('extensionElements');
    return c ? [...many(c, 'values')] : [];
  }

  /** Keeps the child order of containers whose schema is a sequence. */
  append(el: El): void {
    if (this.parent) {
      const raw = this.parent as unknown as Raw;
      const kids = Array.isArray(raw['$children']) ? (raw['$children'] as El[]) : [];
      const order = EXTENSION_STRUCTURE.childOrder(this.type!);
      const rank = (e: El): number => (order ? order.indexOf(ruleName(this.names.typeOf(e))) : -1);
      const mine = rank(el);
      const at = mine === -1 ? -1 : kids.findIndex((k) => rank(k) > mine);
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
    const i = list.indexOf(old);
    list[i] = el;
    el.$parent = this.parent ?? this.host.get<El>('extensionElements');
  }

  remove(el: El): void {
    if (this.parent) {
      const raw = this.parent as unknown as Raw;
      const kids = raw['$children'] as El[] | undefined;
      if (!kids) return;
      const i = kids.indexOf(el);
      if (i !== -1) kids.splice(i, 1);
      if (!kids.length) delete raw['$children'];
      return;
    }
    const c = this.host.get<El | undefined>('extensionElements');
    if (c) removeFrom(c, 'values', el);
  }

  /** A child type absent at this level is looked up in its container. */
  select(step: Step): Array<{ el: El; level: ExtensionLevel }> {
    const wanted = this.names.canonicalName(step.name);
    const pick = (lv: ExtensionLevel): Array<{ el: El; level: ExtensionLevel }> => {
      const hits = lv.items().filter((e) => this.matches(e, step, wanted));
      if (step.index !== undefined) {
        const hit = hits[step.index];
        return hit ? [{ el: hit, level: lv }] : [];
      }
      return hits.map((e) => ({ el: e, level: lv }));
    };
    const direct = pick(this);
    if (direct.length) return direct;
    const home = EXTENSION_STRUCTURE.homeAt(wanted, this.type);
    if (!home) return [];
    return this.items()
      .filter((e) => this.names.typeOf(e) === home)
      .flatMap((c) => pick(this.inside(c)));
  }

  selectDeep(step: Step): Array<{ el: El; level: ExtensionLevel }> {
    const out: Array<{ el: El; level: ExtensionLevel }> = [];
    const wanted = this.names.canonicalName(step.name);
    const visit = (lv: ExtensionLevel): void => {
      for (const e of lv.items()) {
        if (this.matches(e, step, wanted)) out.push({ el: e, level: lv });
        if (this.names.isGeneric(e)) visit(lv.inside(e));
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
