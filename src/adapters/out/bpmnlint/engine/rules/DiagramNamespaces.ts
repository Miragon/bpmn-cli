import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

export const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';
export const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
/** Camunda 7 content, in its own namespace and in Operaton's copy of it. */
export const C7_URIS = [CAMUNDA_URI, 'http://operaton.org/schema/1.0/bpmn'];

/**
 * The prefixes a typed parse writes for the engine packages, whatever the file spells: an unknown
 * attribute of `xmlns:z="...zeebe/1.0"` lands in `$attrs` as `zeebe:foo`.
 */
const PACKAGE_URIS: Record<string, string> = { zeebe: ZEEBE_URI, camunda: CAMUNDA_URI };

/**
 * The namespace prefixes a diagram declares, so a rule can tell which namespace an attribute the
 * moddle left in `$attrs` belongs to: a typed parse keeps unknown attributes there under the
 * prefix the file spells, which says nothing on its own.
 */
export class DiagramNamespaces {
  private static readonly byDefinitions = new WeakMap<object, DiagramNamespaces>();

  private readonly uriByPrefix = new Map<string, string>();

  private constructor(definitions: ModdleElement) {
    for (const [name, uri] of Object.entries(definitions?.$attrs ?? {})) if (name.startsWith('xmlns:') && typeof uri === 'string') this.uriByPrefix.set(name.slice('xmlns:'.length), uri);
  }

  /** The `bpmn:Definitions` of the diagram `node` belongs to. */
  static definitionsOf(node: ModdleElement): ModdleElement | undefined {
    let definitions = node;
    while (definitions && !is(definitions, 'bpmn:Definitions')) definitions = definitions.$parent;
    return definitions;
  }

  /** The namespaces of the diagram `node` belongs to. */
  static forElement(node: ModdleElement): DiagramNamespaces {
    const definitions = DiagramNamespaces.definitionsOf(node);
    const key = definitions ?? DiagramNamespaces;
    let namespaces = DiagramNamespaces.byDefinitions.get(key);
    if (!namespaces) DiagramNamespaces.byDefinitions.set(key, (namespaces = new DiagramNamespaces(definitions)));
    return namespaces;
  }

  /** The URI of a prefixed name (`zeebe:foo`), or of the prefix of a type (`zeebe:TaskDefinition`). */
  uriOf(prefixedName: string): string | undefined {
    const colon = prefixedName.indexOf(':');
    if (colon === -1) return undefined;
    const prefix = prefixedName.slice(0, colon);
    return this.uriByPrefix.get(prefix) ?? PACKAGE_URIS[prefix];
  }

  /** The first prefix the diagram declares for `uri`. */
  prefixOf(uri: string): string | undefined {
    return [...this.uriByPrefix].find(([, declared]) => declared === uri)?.[0];
  }
}
