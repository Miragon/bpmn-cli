import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces } from './DiagramNamespaces.js';
import { ElementKinds } from './ElementKinds.js';
import { ModdlePath } from './ModdlePath.js';
import { SetCommand } from './SetCommand.js';

/** A prefixed attribute the moddle left in `$attrs`, with the namespace its prefix stands for. */
export interface ForeignAttribute {
  key: string;
  local: string;
  uri: string | undefined;
}

/** One vendor element inside an extension element (the extension element included), as messages name it. */
export interface TreeElement {
  element: ModdleElement;
  /** `camunda:inputParameter (in camunda:connector > camunda:inputOutput) of serviceTask Activity_1` */
  where: string;
  /** The path from the host's reported element to this one. */
  path: ReportPath;
}

/**
 * A BPMN element as the vendor-content checks of both engines see it: the element its findings
 * land on (an event definition, loop or condition on its flow node or flow, anything without an id
 * on the nearest element with one), the path from there, how messages name it and how `bpmn set`
 * and `bpmn ext` address it.
 */
export class VendorHost {
  /** The nearest enclosing element with an id, below `bpmn:Definitions`. */
  readonly owner: ModdleElement | undefined;
  /** The element a finding about this host is reported on. */
  readonly target: ModdleElement;
  /** How `bpmn set` and `bpmn ext` address this host, undefined without an id to address it by. */
  readonly address: SetCommand | undefined;
  private readonly pathPrefix: ReportPath;

  constructor(readonly node: ModdleElement) {
    this.owner = ModdlePath.nearestWithId(node.$parent);
    this.address = SetCommand.at(node);
    this.target = this.address?.slot || !node.id ? (this.owner ?? node) : node;
    this.pathPrefix = ModdlePath.between(this.target, node);
  }

  /** `serviceTask Activity_1`, `the multiInstanceLoopCharacteristics of userTask Activity_1` */
  describe(): string {
    return ElementKinds.describe(this.node, this.owner);
  }

  /** The path from the reported element to a property of this host. */
  path(...steps: ReportPath): ReportPath {
    return [...this.pathPrefix, ...steps];
  }

  /** The path from the reported element to a property of the extension element at `index`. */
  extensionPath(index: number, ...steps: ReportPath): ReportPath {
    return this.path('extensionElements', 'values', index, ...steps);
  }

  /** The prefixed attributes the moddle did not type, in file order. */
  foreignAttributes(): ForeignAttribute[] {
    return VendorHost.foreignAttributesOf(this.node).filter(({ key }) => key.includes(':'));
  }

  /** The attributes of any element the moddle did not type, with their namespace when prefixed. */
  static foreignAttributesOf(el: ModdleElement): ForeignAttribute[] {
    const namespaces = DiagramNamespaces.forElement(el);
    return Object.keys(el.$attrs ?? {}).filter((key) => !key.startsWith('xmlns')).map((key) => ({ key, local: key.slice(key.indexOf(':') + 1), uri: namespaces.uriOf(key) }));
  }

  /** The typed vendor element `root` at `path` and the ones of its package inside it, depth first, named with the file's `prefix`. */
  tree(root: ModdleElement, prefix: string, path: ReportPath): TreeElement[] {
    const found: TreeElement[] = [];
    this.collect(root, prefix, '', path, found);
    return found;
  }

  private collect(element: ModdleElement, prefix: string, trail: string, path: ReportPath, found: TreeElement[]): void {
    const type = String(element.$type);
    const local = type.slice(type.indexOf(':') + 1);
    const name = `${prefix}:${ElementKinds.xmlName(local)}`;
    found.push({ element, where: `${name}${trail ? ` (in ${trail})` : ''} of ${this.describe()}`, path });
    for (const property of element.$descriptor?.properties ?? []) {
      if (property.isAttr || property.isReference || !String(property.type).startsWith(type.slice(0, type.indexOf(':') + 1))) {
        continue;
      }
      const propertyName = property.ns?.localName ?? property.name;
      const value = element.get(property.name);
      const children: ModdleElement[] = (Array.isArray(value) ? value : [value]).filter(Boolean);
      children.forEach((child, index) => this.collect(child, prefix, trail ? `${trail} > ${name}` : name, Array.isArray(value) ? [...path, propertyName, index] : [...path, propertyName], found));
    }
  }
}
