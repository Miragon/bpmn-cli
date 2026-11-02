import type { BpmnElement } from '../document/BpmnElement.js';
import { ElementWalk } from '../document/ElementWalk.js';
import { DeclaredNamespaces } from './DeclaredNamespaces.js';

export class DocumentNamespaces {
  private readonly map = new Map<string, string>();

  constructor(private readonly definitions: BpmnElement) {
    const take = (attrs: Record<string, unknown> | undefined): void => {
      for (const [attrName, attrValue] of Object.entries(attrs ?? {})) {
        if (attrName.startsWith('xmlns:') && typeof attrValue === 'string' && !this.map.has(attrName.slice(6))) {
          this.map.set(attrName.slice(6), attrValue);
        }
      }
    };
    take(this.definitions.attrs);
    for (const element of new ElementWalk(this.definitions).depthFirst()) {
      take(element.isBpmn ? element.attrs : (element.raw as unknown as Record<string, unknown>));
    }
  }

  prefixOf(uri: string): string | undefined {
    return [...this.map.entries()].find(([, mappedUri]) => mappedUri === uri)?.[0];
  }

  declares(uri: string): boolean {
    return [...this.map.values()].includes(uri);
  }

  uriOfName(name: string): string | undefined {
    const colon = name.indexOf(':');
    if (colon <= 0) {
      return undefined;
    }
    const prefix = name.slice(0, colon);
    if (prefix === 'xmlns') {
      return undefined;
    }
    return this.map.get(prefix) ?? DeclaredNamespaces.KNOWN[prefix];
  }

  uriOfElement(el: BpmnElement): string | undefined {
    return el.descriptor.ns?.uri ?? this.uriOfName(el.type);
  }

  usage(): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (uri: string | undefined): void => {
      if (uri) {
        counts.set(uri, (counts.get(uri) ?? 0) + 1);
      }
    };
    for (const element of new ElementWalk(this.definitions).depthFirst()) {
      if (element.isBpmn) {
        for (const attrName of Object.keys(element.attrs)) {
          bump(this.uriOfName(attrName));
        }
      } else {
        bump(this.uriOfElement(element));
      }
    }
    return counts;
  }

  executionPlatform(): string | undefined {
    for (const [attrName, attrValue] of Object.entries(this.definitions.attrs)) {
      if (!attrName.endsWith(':executionPlatform') && attrName !== 'executionPlatform') {
        continue;
      }
      const uri = this.uriOfName(attrName);
      if (uri && uri !== DeclaredNamespaces.KNOWN['modeler']) {
        continue;
      }
      if (typeof attrValue === 'string') {
        return attrValue;
      }
    }
    return undefined;
  }
}
