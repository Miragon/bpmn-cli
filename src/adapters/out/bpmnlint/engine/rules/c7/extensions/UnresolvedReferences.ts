import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/** An import warning of the typed parse (`unresolved reference <Error_Gone>`). */
interface ImportWarning {
  message?: string;
  element?: unknown;
  property?: string;
  value?: unknown;
}

/**
 * The id references the typed parse could not resolve: it drops them from the element and only
 * warns, so the engine run hands its warnings over before it lints, and a rule reads the id the
 * file wrote (`errorRef="Error_Gone"`).
 */
export class UnresolvedReferences {
  private static readonly byElement = new WeakMap<object, Map<string, string>>();

  static record(warnings: readonly ImportWarning[]): void {
    for (const { message, element, property, value } of warnings) {
      if (!message?.startsWith('unresolved reference') || !element || typeof element !== 'object' || !property) {
        continue;
      }
      const references = UnresolvedReferences.byElement.get(element) ?? new Map<string, string>();
      references.set(property.slice(property.indexOf(':') + 1), String(value));
      UnresolvedReferences.byElement.set(element, references);
    }
  }

  /** The id the file wrote for the reference `name` (`errorRef`) that the parse dropped. */
  static of(element: ModdleElement, name: string): string | undefined {
    return UnresolvedReferences.byElement.get(element)?.get(name);
  }

  /** The dropped references of an element, by name. */
  static all(element: ModdleElement): ReadonlyMap<string, string> {
    return UnresolvedReferences.byElement.get(element) ?? new Map();
  }
}
