import { type BpmnElement, CAMUNDA, ElementText, type Finding, type KindDefinition, ZEEBE } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class InapplicableContent {
  private readonly coercer: PropertyCoercer;

  constructor(edit: EditSession) {
    this.coercer = new PropertyCoercer(edit);
  }

  warningFor(el: BpmnElement, to: KindDefinition): Finding | undefined {
    const attrs = Object.keys(ElementText.vendorAttributes(el)).filter((key) => this.isInapplicableAttribute(key, el));
    const exts: string[] = [];
    for (const ext of el.get<BpmnElement | undefined>('extensionElements')?.get<BpmnElement[] | undefined>('values') ?? []) {
      if (this.isMisplaced(ext, el) && !exts.includes(ext.type)) {
        exts.push(ext.type);
      }
    }
    const names = [...attrs, ...exts];
    if (!names.length) {
      return undefined;
    }
    const id = el.id;
    const fixes = [
      ...(attrs.length ? [`\`bpmn set <file> ${id} ${attrs.map((attr) => `${attr}=`).join(' ')}\``] : []),
      ...exts.map((extType) => `\`bpmn ext remove <file> ${id} ${extType}\``),
    ];
    return {
      code: 'W_PROPERTY_INAPPLICABLE',
      message: `${names.join(', ')} of ${id} ${names.length > 1 ? 'have' : 'has'} no effect on a ${to.kind} (kept as ${names.length > 1 ? 'they are' : 'it is'})`,
      element: id,
      hint: `The ${this.descriptorText(names)} descriptor does not allow ${names.length > 1 ? 'them' : 'it'} on a ${to.kind}; remove with ${fixes.join(' and ')}, or retype back.`,
    };
  }

  private isInapplicableAttribute(key: string, el: BpmnElement): boolean {
    const name = this.camundaName(key);
    if (name) {
      return CAMUNDA.attrAppliesTo(name, el) === false;
    }
    const zeebeName = this.coercer.zeebeLocal(key);
    const def = zeebeName ? ZEEBE.attr(zeebeName) : undefined;
    return !!def && !def.owners.some((owner) => el.is(owner));
  }

  private isMisplaced(ext: BpmnElement, el: BpmnElement): boolean {
    const name = this.camundaName(ext.type);
    if (name) {
      return CAMUNDA.allowedOn(name, el) === false;
    }
    const zeebeName = this.coercer.zeebeLocal(ext.type);
    return zeebeName ? ZEEBE.allowedOn(zeebeName, el) === false && !ZEEBE.nestedOnly(zeebeName) : false;
  }

  private descriptorText(names: string[]): string {
    if (names.every((extName) => this.coercer.zeebeLocal(extName))) {
      return 'Zeebe (Camunda 8)';
    }
    return names.some((extName) => this.coercer.zeebeLocal(extName)) ? 'Camunda 7 and Zeebe' : 'Camunda';
  }

  private camundaName(name: string): string | undefined {
    const local = this.coercer.camundaLocal(name);
    return local ? `camunda:${local}` : undefined;
  }
}
