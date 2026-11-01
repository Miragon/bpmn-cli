import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import { ExtensionStructure } from './ExtensionStructure.js';
import type { Step } from './SelectorParser.js';
import type { VendorElements } from './VendorElements.js';
import { VendorFamily } from './VendorFamily.js';

export class ExtensionLevel {
  constructor(
    private readonly document: BpmnDocument,
    private readonly names: VendorElements,
    readonly host: BpmnElement,
    readonly parent?: BpmnElement,
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

  inside(parent: BpmnElement): ExtensionLevel {
    return new ExtensionLevel(this.document, this.names, this.host, parent);
  }

  items(): BpmnElement[] {
    if (this.parent) {
      return this.names.kidsOf(this.parent);
    }
    const container = this.host.get<BpmnElement | undefined>('extensionElements');
    return container ? [...container.list('values')] : [];
  }

  append(el: BpmnElement): void {
    if (this.parent) {
      const kids = [...this.parent.list('$children')];
      const order = ExtensionStructure.INSTANCE.childOrder(this.type!);
      const rank = (item: BpmnElement): number => (order ? order.indexOf(VendorFamily.ruleName(this.names.typeOf(item))) : -1);
      const mine = rank(el);
      const at = mine === -1 ? -1 : kids.findIndex((kid) => rank(kid) > mine);
      if (at === -1) {
        kids.push(el);
      } else {
        kids.splice(at, 0, el);
      }
      this.parent.set('$children', kids);
      el.parent = this.parent;
      return;
    }
    this.ensureContainer().add('values', el);
  }

  replace(old: BpmnElement, el: BpmnElement): void {
    const owner = this.parent ?? this.host.get<BpmnElement>('extensionElements');
    const property = this.parent ? '$children' : 'values';
    owner.set(property, owner.list(property).map((item) => (item === old ? el : item)));
    el.parent = this.parent ?? this.host.get<BpmnElement>('extensionElements');
  }

  remove(el: BpmnElement): void {
    if (this.parent) {
      const kids = this.parent.list('$children').filter((kid) => kid !== el);
      this.parent.set('$children', kids.length ? kids : undefined);
      return;
    }
    const container = this.host.get<BpmnElement | undefined>('extensionElements');
    if (container) {
      container.remove('values', el);
    }
  }

  select(step: Step): Array<{ el: BpmnElement; level: ExtensionLevel }> {
    const wanted = this.names.canonicalName(step.name);
    const pick = (lv: ExtensionLevel): Array<{ el: BpmnElement; level: ExtensionLevel }> => {
      const hits = lv.items().filter((item) => this.matches(item, step, wanted));
      if (step.index !== undefined) {
        const hit = hits[step.index];
        return hit ? [{ el: hit, level: lv }] : [];
      }
      return hits.map((item) => ({ el: item, level: lv }));
    };
    const direct = pick(this);
    if (direct.length) {
      return direct;
    }
    const home = ExtensionStructure.INSTANCE.homeAt(wanted, this.type);
    if (!home) {
      return [];
    }
    return this.items()
      .filter((item) => this.names.typeOf(item) === home)
      .flatMap((container) => pick(this.inside(container)));
  }

  selectDeep(step: Step): Array<{ el: BpmnElement; level: ExtensionLevel }> {
    const out: Array<{ el: BpmnElement; level: ExtensionLevel }> = [];
    const wanted = this.names.canonicalName(step.name);
    const visit = (lv: ExtensionLevel): void => {
      for (const item of lv.items()) {
        if (this.matches(item, step, wanted)) {
          out.push({ el: item, level: lv });
        }
        if (this.names.isGeneric(item)) {
          visit(lv.inside(item));
        }
      }
    };
    visit(this);
    return out;
  }

  private matches(el: BpmnElement, step: Step, wanted: string): boolean {
    if (this.names.typeOf(el) !== wanted && el.type !== step.name) {
      return false;
    }
    if (step.attr !== undefined) {
      return this.names.attrsOf(el)[step.attr] === step.value;
    }
    return true;
  }

  private ensureContainer(): BpmnElement {
    const el = this.host;
    let container = el.get<BpmnElement | undefined>('extensionElements');
    if (!container) {
      container = this.document.tree.build('bpmn:ExtensionElements');
      container.parent = el;
      el.set('extensionElements', container);
    }
    return container;
  }
}
