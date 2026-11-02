import { BpmnElement, ElementSlots, ElementText } from '../../model/index.js';
import type { ExtensionFacts } from '../lines/index.js';

export interface ExtensionInfo extends ExtensionFacts {
  index: number;
  slot?: string | undefined;
}

export class ExtensionLister {
  private static genericAttrs(extension: BpmnElement): Record<string, string> {
    const kept = ElementText.ownEntries(extension).filter(([name, value]) => !name.startsWith('$') && value !== undefined && value !== null && typeof value !== 'object' && typeof value !== 'function');
    return Object.fromEntries(kept.map(([name, value]) => [name, String(value)]));
  }

  private static generic(extension: BpmnElement): ExtensionFacts {
    const body = extension.peek('$body');
    const children = extension.list<unknown>('$children').filter((child): child is BpmnElement => child instanceof BpmnElement);
    return {
      type: extension.type,
      attrs: ExtensionLister.genericAttrs(extension),
      ...(typeof body === 'string' ? { body } : {}),
      ...(children.length ? { children: children.map(ExtensionLister.generic) } : {}),
    };
  }

  list(element: BpmnElement): ExtensionInfo[] {
    const values = element.get<BpmnElement | undefined>('extensionElements')?.list('values') ?? [];
    return values.map((extension, index) => ({ index, ...ExtensionLister.generic(extension) }));
  }

  listAll(element: BpmnElement): ExtensionInfo[] {
    const nested = ElementSlots.entriesOf(element).flatMap(({ prefix, el }) => this.list(el).map((info) => ({ ...info, slot: prefix })));
    return [...this.list(element), ...nested];
  }
}
