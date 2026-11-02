import type { BpmnElement } from '../document/BpmnElement.js';
import { Kinds } from './Kinds.js';

export class ElementText {
  static readonly UNKNOWN_ID = '?';

  static shownId(element: BpmnElement | undefined): string {
    return element?.peek<string>('id') ?? ElementText.UNKNOWN_ID;
  }

  static labelOf(element: BpmnElement): string {
    const name = element.get<string | undefined>('name');
    return `${Kinds.label(element)} ${element.id}${name ? ` "${name}"` : ''}`;
  }

  static ownEntries(element: BpmnElement): Array<[string, unknown]> {
    return Object.keys(element.raw).map((property) => [property, element.peek(property)]);
  }

  static vendorAttributes(element: BpmnElement): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(element.attrs)) {
      const isVendorName = name.includes(':') && !name.startsWith('xmlns') && !name.startsWith('xsi:') && !name.startsWith('xml:');
      if (isVendorName && value !== undefined && value !== null && typeof value !== 'object') {
        attributes[name] = String(value);
      }
    }
    return attributes;
  }

  static vendorContent(element: BpmnElement): string[] {
    const content = Object.entries(element.attrs)
      .filter(([name, value]) => !name.startsWith('xmlns') && !name.startsWith('xsi:') && typeof value !== 'object')
      .map(([name]) => name);
    for (const extension of element.get<BpmnElement | undefined>('extensionElements')?.get<BpmnElement[] | undefined>('values') ?? []) {
      content.push(extension.type);
    }
    if (element.get<BpmnElement[] | undefined>('documentation')?.length) {
      content.push('documentation');
    }
    return content;
  }
}
