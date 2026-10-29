import type { Doc } from '../Doc.js';
import { isBpmnElement, walk, type El } from '../utils/moddle.js';

/** `operaton` is Operaton's copy of the camunda namespace (only Operaton reads it). */
export const KNOWN_NAMESPACES: Record<string, string> = {
  camunda: 'http://camunda.org/schema/1.0/bpmn',
  operaton: 'http://operaton.org/schema/1.0/bpmn',
  zeebe: 'http://camunda.org/schema/zeebe/1.0',
  modeler: 'http://camunda.org/schema/modeler/1.0',
  bioc: 'http://bpmn.io/schema/bpmn/biocolor/1.0',
  color: 'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
};

const MODELER_URI = 'http://camunda.org/schema/modeler/1.0';

export class DocumentNamespaces {
  private readonly definitions: El;
  /** First declaration wins, starting with bpmn:definitions. */
  private readonly map = new Map<string, string>();

  constructor(source: Doc | El) {
    this.definitions = (source as Doc).definitions ?? (source as El);
    const take = (attrs: Record<string, unknown> | undefined): void => {
      for (const [attrName, attrValue] of Object.entries(attrs ?? {})) {
        if (attrName.startsWith('xmlns:') && typeof attrValue === 'string' && !this.map.has(attrName.slice(6))) {
          this.map.set(attrName.slice(6), attrValue);
        }
      }
    };
    take(this.definitions.$attrs as Record<string, unknown>);
    for (const el of walk(this.definitions)) {
      if (isBpmnElement(el)) {
        take(el.$attrs as Record<string, unknown>);
      } else {
        take(el as unknown as Record<string, unknown>);
      }
    }
  }

  prefixOf(uri: string): string | undefined {
    return [...this.map.entries()].find(([, mappedUri]) => mappedUri === uri)?.[0];
  }

  declares(uri: string): boolean {
    return [...this.map.values()].includes(uri);
  }

  /** Falls back to the well-known prefixes when the document declares none. */
  uriOfName(name: string): string | undefined {
    const colon = name.indexOf(':');
    if (colon <= 0) return undefined;
    const prefix = name.slice(0, colon);
    if (prefix === 'xmlns') return undefined;
    return this.map.get(prefix) ?? KNOWN_NAMESPACES[prefix];
  }

  uriOfElement(el: El): string | undefined {
    const descriptor = el.$descriptor as { isGeneric?: boolean; ns?: { uri?: string } };
    return descriptor.ns?.uri ?? this.uriOfName(el.$type);
  }

  usage(): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (uri: string | undefined): void => {
      if (uri) counts.set(uri, (counts.get(uri) ?? 0) + 1);
    };
    for (const el of walk(this.definitions)) {
      if (isBpmnElement(el)) {
        for (const attrName of Object.keys(el.$attrs ?? {})) {
          bump(this.uriOfName(attrName));
        }
      } else {
        bump(this.uriOfElement(el));
      }
    }
    return counts;
  }

  /** Any prefix bound to the modeler namespace counts. */
  executionPlatform(): string | undefined {
    for (const [attrName, attrValue] of Object.entries(this.definitions.$attrs ?? {})) {
      if (!attrName.endsWith(':executionPlatform') && attrName !== 'executionPlatform') {
        continue;
      }
      const uri = this.uriOfName(attrName);
      if (uri && uri !== MODELER_URI) continue;
      if (typeof attrValue === 'string') return attrValue;
    }
    return undefined;
  }
}
