import { BpmnElement, ElementWalk } from '../../model/index.js';

export interface ElementReference {
  holder: BpmnElement;
  prop: string;
  isMany: boolean;
  target: BpmnElement;
}

export class ElementContainment {
  constructor(private readonly element: BpmnElement) {}

  isDataReference(): boolean {
    return this.element.is('bpmn:DataObjectReference') || this.element.is('bpmn:DataStoreReference');
  }

  artifactContainer(): BpmnElement | undefined {
    for (let ancestor: BpmnElement | undefined = this.element; ancestor; ancestor = ancestor.parent) {
      if (ancestor.is('bpmn:Process') || ancestor.is('bpmn:SubProcess') || ancestor.is('bpmn:Collaboration')) {
        return ancestor;
      }
    }
    return undefined;
  }

  contains(child: BpmnElement): boolean {
    const { descriptor } = this.element;
    if (descriptor.isGeneric) {
      return this.element.list('$children').includes(child);
    }
    return (descriptor.properties ?? []).some((property) => {
      if (property.isReference) {
        return false;
      }
      const value = this.element.peek(property.name);
      return Array.isArray(value) ? value.includes(child) : value === child;
    });
  }

  isAttachedTo(root: BpmnElement): boolean {
    let current = this.element;
    while (current !== root) {
      const parent = current.parent;
      if (!parent || !new ElementContainment(parent).contains(current)) {
        return false;
      }
      current = parent;
    }
    return true;
  }

  detach(replacement?: BpmnElement): BpmnElement | undefined {
    const { parent } = this.element;
    if (!parent) {
      return undefined;
    }
    for (const property of parent.descriptor.properties ?? []) {
      if (!property.isReference && this.replaceIn(parent, property.name, replacement)) {
        if (replacement) {
          replacement.parent = parent;
        }
        return parent;
      }
    }
    return parent;
  }

  referencesToAny(targets: ReadonlySet<BpmnElement>): ElementReference[] {
    const references: ElementReference[] = [];
    for (const element of new ElementWalk(this.element).depthFirst()) {
      if (!element.descriptor.isGeneric) {
        references.push(...ElementContainment.referencesOf(element, targets));
      }
    }
    return references;
  }

  nearestWithId(): BpmnElement | undefined {
    let current: BpmnElement | undefined = this.element;
    while (current && !current.get<string | undefined>('id')) {
      current = current.parent;
    }
    return current;
  }

  private replaceIn(parent: BpmnElement, property: string, replacement: BpmnElement | undefined): boolean {
    const value = parent.peek(property);
    if (Array.isArray(value)) {
      const position = value.indexOf(this.element);
      if (position === -1) {
        return false;
      }
      parent.remove(property, this.element);
      if (replacement) {
        parent.insert(property, position, replacement);
      }
      return true;
    }
    if (value !== this.element) {
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
      const value = element.peek(property.name);
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
