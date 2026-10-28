import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { CAMUNDA_URI } from '../DiagramNamespaces.js';

const OPERATON = 'operaton';

/** What the engine run knows of a file that its parse for the rules no longer shows. */
export interface C7DiagramFacts {
  /** the file uses Operaton's namespace, which the run reads as the camunda one */
  operaton: boolean;
  /** the prefix the file writes camunda content with (`camunda`, `operaton`, ...) */
  prefix: string;
}

/** An import warning of the typed parse (`unresolved reference <Error_Gone>`). */
interface ImportWarning {
  message?: string;
  element?: unknown;
  property?: string;
  value?: unknown;
}

/**
 * The Camunda 7 vendor of a diagram, the prefix its messages and hints write, and the id references
 * the typed parse dropped (it only warns, so a rule reads the id the file wrote from here). The
 * engine run records them before it lints; without that record (a rule spec), vendor and prefix
 * are read from the namespaces: an `operaton` prefix bound to the camunda URI is Operaton's.
 */
export class C7Diagram {
  private static readonly recorded = new WeakMap<object, C7DiagramFacts>();
  private static readonly unresolvedByElement = new WeakMap<object, Map<string, string>>();

  static record(definitions: ModdleElement, facts: C7DiagramFacts, warnings: readonly ImportWarning[]): void {
    C7Diagram.recorded.set(definitions, facts);
    for (const { message, element, property, value } of warnings) {
      if (!message?.startsWith('unresolved reference') || !element || typeof element !== 'object' || !property) continue;
      const references = C7Diagram.unresolvedByElement.get(element) ?? new Map<string, string>();
      references.set(property.slice(property.indexOf(':') + 1), String(value));
      C7Diagram.unresolvedByElement.set(element, references);
    }
  }

  static of(node: ModdleElement): C7DiagramFacts {
    let definitions = node;
    while (definitions && !is(definitions, 'bpmn:Definitions')) definitions = definitions.$parent;
    return (definitions && C7Diagram.recorded.get(definitions)) ?? C7Diagram.declared(definitions);
  }

  /** The references of `element` the parse dropped, by name (`errorRef`), with the id the file wrote. */
  static unresolved(element: ModdleElement): ReadonlyMap<string, string> {
    return C7Diagram.unresolvedByElement.get(element) ?? new Map();
  }

  private static declared(definitions: ModdleElement | undefined): C7DiagramFacts {
    const prefixes = Object.entries(definitions?.$attrs ?? {}).filter(([name, uri]) => name.startsWith('xmlns:') && uri === CAMUNDA_URI).map(([name]) => name.slice('xmlns:'.length));
    const operaton = prefixes.includes(OPERATON);
    return { operaton, prefix: operaton ? OPERATON : (prefixes[0] ?? 'camunda') };
  }
}
