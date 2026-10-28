import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces } from '../DiagramNamespaces.js';

const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';

/** Reads the `camunda:*` attributes of an element, whatever prefix the file spells. */
export class CamundaAttributes {
  constructor(private readonly node: ModdleElement) {}

  /** The value of `camunda:<local>` where the element's type defines it, else undefined. */
  defined(local: string): string | undefined {
    return this.node?.$descriptor?.propertiesByName?.[`camunda:${local}`] ? this.node.get(`camunda:${local}`) : undefined;
  }

  /** The value of `camunda:<local>`, also where the element's type does not define it. */
  any(local: string): string | undefined {
    const defined = this.defined(local);
    if (defined !== undefined) return defined;
    const namespaces = DiagramNamespaces.forElement(this.node);
    const key = Object.keys(this.node?.$attrs ?? {}).find((name) => name.slice(name.indexOf(':') + 1) === local && namespaces.uriOf(name) === CAMUNDA_URI);
    return key === undefined ? undefined : String(this.node.$attrs[key]);
  }
}
