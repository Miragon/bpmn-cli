import { KNOWN_NAMESPACES, type Doc } from '../model/Doc.js';
import { isBpmnElement, walk, type El } from '../model/utils/moddle.js';

const MODELER_URI = 'http://camunda.org/schema/modeler/1.0';

export class DocumentNamespaces {
  private readonly definitions: El;
  /** First declaration wins, starting with bpmn:definitions. */
  private readonly map = new Map<string, string>();

  constructor(source: Doc | El) {
    this.definitions = (source as Doc).definitions ?? (source as El);
    const take = (attrs: Record<string, unknown> | undefined): void => {
      for (const [k, v] of Object.entries(attrs ?? {})) {
        if (k.startsWith('xmlns:') && typeof v === 'string' && !this.map.has(k.slice(6))) this.map.set(k.slice(6), v);
      }
    };
    take(this.definitions.$attrs as Record<string, unknown>);
    for (const el of walk(this.definitions)) {
      if (isBpmnElement(el)) take(el.$attrs as Record<string, unknown>);
      else take(el as unknown as Record<string, unknown>);
    }
  }

  prefixOf(uri: string): string | undefined {
    return [...this.map.entries()].find(([, u]) => u === uri)?.[0];
  }

  declares(uri: string): boolean {
    return [...this.map.values()].includes(uri);
  }

  /** Falls back to the well-known prefixes when the document declares none. */
  uriOfName(name: string): string | undefined {
    const i = name.indexOf(':');
    if (i <= 0) return undefined;
    const prefix = name.slice(0, i);
    if (prefix === 'xmlns') return undefined;
    return this.map.get(prefix) ?? KNOWN_NAMESPACES[prefix];
  }

  uriOfElement(el: El): string | undefined {
    const d = el.$descriptor as { isGeneric?: boolean; ns?: { uri?: string } };
    return d.ns?.uri ?? this.uriOfName(el.$type);
  }

  usage(): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (uri: string | undefined): void => {
      if (uri) counts.set(uri, (counts.get(uri) ?? 0) + 1);
    };
    for (const el of walk(this.definitions)) {
      if (isBpmnElement(el)) {
        for (const k of Object.keys(el.$attrs ?? {})) bump(this.uriOfName(k));
      } else {
        bump(this.uriOfElement(el));
      }
    }
    return counts;
  }

  /** Any prefix bound to the modeler namespace counts. */
  executionPlatform(): string | undefined {
    for (const [k, v] of Object.entries(this.definitions.$attrs ?? {})) {
      if (!k.endsWith(':executionPlatform') && k !== 'executionPlatform') continue;
      const uri = this.uriOfName(k);
      if (uri && uri !== MODELER_URI) continue;
      if (typeof v === 'string') return v;
    }
    return undefined;
  }
}
