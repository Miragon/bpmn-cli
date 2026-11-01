import { type BpmnDocument, type BpmnElement, type DocumentNamespaces, IdWords } from '../../../model/index.js';
import { ElementAddress } from './ElementAddress.js';
import type { RuleContext } from './RuleContext.js';
import type { RuleReporter } from './RuleReporter.js';

export interface ExtValue {
  el: BpmnElement;
  uri: string | undefined;
  local: string;
  index: number;
}

export interface UnprefixedAttributes {
  el: BpmnElement;
  owner: BpmnElement | undefined;
  id: string | undefined;
  di: boolean;
  addr: ElementAddress | undefined;
  keys: string[];
}

export abstract class CamundaRules {
  protected static readonly TIMER_ELEMENTS = ['timeDate', 'timeCycle', 'timeDuration'];

  protected readonly document: BpmnDocument;
  protected readonly ns: DocumentNamespaces;
  protected readonly prefix: string;
  protected readonly operaton: boolean;
  protected readonly outgoing: Map<BpmnElement, BpmnElement[]>;
  protected readonly incoming: Map<BpmnElement, BpmnElement[]>;

  constructor(context: RuleContext) {
    this.document = context.document;
    this.ns = context.namespaces;
    this.prefix = context.prefix;
    this.operaton = context.operaton;
    this.outgoing = context.outgoing;
    this.incoming = context.incoming;
  }

  abstract check(element: BpmnElement, reporter: RuleReporter): void;

  protected addressOf(el: BpmnElement, owner: BpmnElement | undefined): ElementAddress | undefined {
    return ElementAddress.of(el, owner);
  }

  protected attr(el: BpmnElement | undefined, name: string): string | undefined {
    const value = el?.peek<unknown>(name);
    return value === undefined || value === null ? undefined : String(value);
  }

  protected nameOf(el: BpmnElement | undefined): string | undefined {
    const name = el?.peek<string>('name');
    return typeof name === 'string' && name.trim() !== '' ? name : undefined;
  }

  protected nameAttr(el: BpmnElement | undefined): string | undefined {
    const name = el?.peek<string>('name');
    return typeof name === 'string' && name !== '' ? name : undefined;
  }

  protected nonEmpty(text: string | undefined): text is string {
    return typeof text === 'string' && text.trim() !== '';
  }

  protected triggerName(definition: BpmnElement): string {
    return IdWords.lcfirst(IdWords.localName(definition.type).replace(/EventDefinition$/, ''));
  }

  protected extensionValues(el: BpmnElement | undefined): ExtValue[] {
    const values = el?.peek<BpmnElement>('extensionElements')?.list('values') ?? [];
    return values.map((extension, index) => ({ el: extension, uri: extension.isGeneric ? this.ns.uriOfElement(extension) : undefined, local: IdWords.localName(extension.type), index }));
  }

  protected unprefixedAttributes(): UnprefixedAttributes[] {
    const found: UnprefixedAttributes[] = [];
    for (const el of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      const keys = Object.keys(el.attrs).filter((key) => !key.includes(':') && key !== 'xmlns');
      if (keys.length) {
        found.push(this.unprefixedOf(el, keys));
      }
    }
    return found;
  }

  private unprefixedOf(el: BpmnElement, keys: string[]): UnprefixedAttributes {
    const { parent } = el;
    const nested = parent?.id && this.addressOf(el, parent)?.prefix ? parent : undefined;
    let owner: BpmnElement | undefined = nested ?? el;
    while (owner && !owner.id) {
      owner = owner.parent;
    }
    const id = owner?.id;
    const di = el.isDi || !!owner?.isDi;
    return { el, owner, id, di, addr: di ? undefined : this.unprefixedAddress(el, owner), keys };
  }

  private unprefixedAddress(el: BpmnElement, owner: BpmnElement | undefined): ElementAddress | undefined {
    if (el === owner) {
      return el.id ? new ElementAddress(el.id, '') : undefined;
    }
    return owner ? this.addressOf(el, owner) : undefined;
  }
}
