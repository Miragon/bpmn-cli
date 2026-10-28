import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces } from '../../DiagramNamespaces.js';

const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';

/** Reads the `camunda:*` attributes of an element, whatever prefix the file spells. */
export class CamundaAttributes {
  constructor(private readonly node: ModdleElement) {}

  /** The value of `camunda:<local>` where the element's type defines it, else undefined. */
  defined(local: string): string | undefined {
    if (!this.node?.$descriptor?.propertiesByName?.[`camunda:${local}`]) {
      return undefined;
    }
    return this.node.get(`camunda:${local}`);
  }

  /** The value of `camunda:<local>`, also where the element's type does not define it. */
  any(local: string): string | undefined {
    const defined = this.defined(local);
    if (defined !== undefined) {
      return defined;
    }
    const namespaces = DiagramNamespaces.forElement(this.node);
    for (const [key, value] of Object.entries(this.node?.$attrs ?? {})) {
      if (key.slice(key.indexOf(':') + 1) === local && namespaces.uriOf(key) === CAMUNDA_URI) {
        return String(value);
      }
    }
    return undefined;
  }
}
