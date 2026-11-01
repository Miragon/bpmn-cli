import { type BpmnElement, CAMUNDA, ElementText, type Finding, type KindDefinition, ZEEBE, ZeebeDescriptor } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class InapplicableContent {
  constructor(private readonly edit: EditSession) {}

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
    const zeebeName = this.zeebeLocal(key);
    const def = zeebeName ? ZEEBE.attr(zeebeName) : undefined;
    return !!def && !def.owners.some((owner) => el.is(owner));
  }

  private isMisplaced(ext: BpmnElement, el: BpmnElement): boolean {
    const name = this.camundaName(ext.type);
    if (name) {
      return CAMUNDA.allowedOn(name, el) === false;
    }
    const zeebeName = this.zeebeLocal(ext.type);
    return zeebeName ? ZEEBE.allowedOn(zeebeName, el) === false && !ZEEBE.nestedOnly(zeebeName) : false;
  }

  private descriptorText(names: string[]): string {
    if (names.every((extName) => this.zeebeLocal(extName))) {
      return 'Zeebe (Camunda 8)';
    }
    return names.some((extName) => this.zeebeLocal(extName)) ? 'Camunda 7 and Zeebe' : 'Camunda';
  }

  private camundaName(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || !CAMUNDA.reads(this.edit.document.namespaces.uriOf(name.slice(0, idx)))) {
      return undefined;
    }
    return `camunda:${name.slice(idx + 1)}`;
  }

  private zeebeLocal(name: string): string | undefined {
    const idx = name.indexOf(':');
    if (idx <= 0 || this.edit.document.namespaces.uriOf(name.slice(0, idx)) !== ZeebeDescriptor.URI) {
      return undefined;
    }
    return name.slice(idx + 1);
  }
}
