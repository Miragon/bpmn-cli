import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { UnresolvedReferences } from './extensions/UnresolvedReferences.js';

const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
const OPERATON = 'operaton';

/** What the engine run knows of a file that its parse for the rules no longer shows. */
export interface C7DiagramFacts {
  /** the file uses Operaton's namespace, which the run reads as the camunda one */
  operaton: boolean;
  /** the prefix the file writes camunda content with (`camunda`, `operaton`, ...) */
  prefix: string;
}

/**
 * The Camunda 7 vendor of a diagram and the prefix its messages and hints write. The engine run
 * records both before it lints, with the references the parse dropped; without that record (a rule
 * spec), they are read from the namespaces: an `operaton` prefix bound to the camunda URI is
 * Operaton's.
 */
export class C7Diagram {
  private static readonly recorded = new WeakMap<object, C7DiagramFacts>();

  static record(definitions: ModdleElement, facts: C7DiagramFacts, warnings: readonly object[]): void {
    C7Diagram.recorded.set(definitions, facts);
    UnresolvedReferences.record(warnings);
  }

  static of(node: ModdleElement): C7DiagramFacts {
    let definitions = node;
    while (definitions && !is(definitions, 'bpmn:Definitions')) {
      definitions = definitions.$parent;
    }
    return (definitions && C7Diagram.recorded.get(definitions)) ?? C7Diagram.declared(definitions);
  }

  private static declared(definitions: ModdleElement | undefined): C7DiagramFacts {
    const prefixes = Object.entries(definitions?.$attrs ?? {})
      .filter(([name, uri]) => name.startsWith('xmlns:') && uri === CAMUNDA_URI)
      .map(([name]) => name.slice('xmlns:'.length));
    const operaton = prefixes.includes(OPERATON);
    return { operaton, prefix: operaton ? OPERATON : (prefixes[0] ?? 'camunda') };
  }
}
