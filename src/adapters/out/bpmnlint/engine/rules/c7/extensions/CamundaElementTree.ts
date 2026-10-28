import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { C7Host, type ForeignAttribute, type HostExtension } from './C7Host.js';
import { C7Diagram } from '../C7Diagram.js';

/** One camunda element inside an extension element, the extension element included. */
interface CamundaTreeElement {
  element: ModdleElement;
  /** `camunda:inputParameter (in camunda:connector > camunda:inputOutput) of serviceTask Activity_1` */
  where: string;
  /** The path from the host's reported element to this one. */
  path: ReportPath;
}

/** The camunda elements of one camunda extension element, depth first, as messages name them. */
export class CamundaElementTree {
  constructor(
    private readonly host: C7Host,
    private readonly extension: HostExtension,
  ) {}

  /** The prefixed attributes the moddle left on the elements of the tree, each with its element. */
  foreignAttributes(): Array<CamundaTreeElement & ForeignAttribute> {
    return this.elements().flatMap((treeElement) =>
      C7Host.foreignAttributesOf(treeElement.element).map((attribute) => ({ ...treeElement, ...attribute })),
    );
  }

  elements(): CamundaTreeElement[] {
    const found: CamundaTreeElement[] = [];
    this.collect(this.extension.value, '', this.host.extensionPath(this.extension.index), found);
    return found;
  }

  private collect(
    element: ModdleElement,
    trail: string,
    path: ReportPath,
    found: CamundaTreeElement[],
  ): void {
    const name = `${C7Diagram.of(this.host.node).prefix}:${this.localName(element)}`;
    found.push({
      element,
      where: `${name}${trail ? ` (in ${trail})` : ''} of ${this.host.describe()}`,
      path,
    });
    const childTrail = trail ? `${trail} > ${name}` : name;
    for (const property of element.$descriptor?.properties ?? []) {
      if (
        property.isAttr ||
        property.isReference ||
        !String(property.type).startsWith('camunda:')
      ) {
        continue;
      }
      const propertyName = property.ns?.localName ?? property.name;
      const value = element.get(property.name);
      const children: ModdleElement[] = Array.isArray(value) ? value : value ? [value] : [];
      children.forEach((child, index) => {
        const childPath = Array.isArray(value)
          ? [...path, propertyName, index]
          : [...path, propertyName];
        this.collect(child, childTrail, childPath, found);
      });
    }
  }

  private localName(element: ModdleElement): string {
    const typeName = String(element.$type).replace(/^camunda:/, '');
    return typeName.charAt(0).toLowerCase() + typeName.slice(1);
  }
}
