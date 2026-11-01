import { BpmnElement, ElementWalk } from '../../model/index.js';

export interface ElementReference {
  holder: BpmnElement;
  prop: string;
  isMany: boolean;
  target: BpmnElement;
}

export class ElementContainment {
  static isDataReference(element: BpmnElement): boolean {
    return element.is('bpmn:DataObjectReference') || element.is('bpmn:DataStoreReference');
  }

  static artifactContainerOf(element: BpmnElement): BpmnElement | undefined {
    for (let ancestor: BpmnElement | undefined = element; ancestor; ancestor = ancestor.parent) {
      if (ancestor.is('bpmn:Process') || ancestor.is('bpmn:SubProcess') || ancestor.is('bpmn:Collaboration')) {
        return ancestor;
      }
    }
    return undefined;
  }

  static contains(parent: BpmnElement, child: BpmnElement): boolean {
    const { descriptor } = parent;
    if (descriptor.isGeneric) {
      return parent.list('$children').includes(child);
    }
    return (descriptor.properties ?? []).some((property) => {
      if (property.isReference) {
        return false;
      }
      const value = ElementContainment.own(parent, property.name);
      return Array.isArray(value) ? value.includes(child) : value === child;
    });
  }

  static detach(element: BpmnElement, replacement?: BpmnElement): BpmnElement | undefined {
    const { parent } = element;
    if (!parent) {
      return undefined;
    }
    for (const property of parent.descriptor.properties ?? []) {
      if (!property.isReference && ElementContainment.replaceIn(parent, property.name, element, replacement)) {
        if (replacement) {
          replacement.parent = parent;
        }
        return parent;
      }
    }
    return parent;
  }

  static referencesToAny(root: BpmnElement, targets: ReadonlySet<BpmnElement>): ElementReference[] {
    const references: ElementReference[] = [];
    for (const element of new ElementWalk(root).depthFirst()) {
      if (!element.descriptor.isGeneric) {
        references.push(...ElementContainment.referencesOf(element, targets));
      }
    }
    return references;
  }

  static nearestWithId(element: BpmnElement): BpmnElement | undefined {
    let current: BpmnElement | undefined = element;
    while (current && !current.get<string | undefined>('id')) {
      current = current.parent;
    }
    return current;
  }

  private static own(parent: BpmnElement, property: string): unknown {
    return parent.peek(property);
  }

  private static replaceIn(parent: BpmnElement, property: string, element: BpmnElement, replacement: BpmnElement | undefined): boolean {
    const value = ElementContainment.own(parent, property);
    if (Array.isArray(value)) {
      const position = value.indexOf(element);
      if (position === -1) {
        return false;
      }
      parent.remove(property, element);
      if (replacement) {
        parent.insert(property, position, replacement);
      }
      return true;
    }
    if (value !== element) {
      return false;
    }
    parent.set(property, replacement);
    return true;
  }

  private static referencesOf(element: BpmnElement, targets: ReadonlySet<BpmnElement>): ElementReference[] {
    const references: ElementReference[] = [];
    for (const property of element.descriptor.properties ?? []) {
      if (!property.isReference) {
        continue;
      }
      const value = ElementContainment.own(element, property.name);
      const entries = property.isMany && Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        if (entry instanceof BpmnElement && targets.has(entry)) {
          references.push({ holder: element, prop: property.name, isMany: !!property.isMany, target: entry });
        }
      }
    }
    return references;
  }
}
