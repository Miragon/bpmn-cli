import { BpmnElement, type PropertyDescriptor } from './BpmnElement.js';

export interface WalkOptions {
  bpmnOnly?: boolean;
}

export class ElementWalk {
  constructor(private readonly root: BpmnElement) {}

  private static elementsIn(value: unknown): BpmnElement[] {
    const values: unknown[] = Array.isArray(value) ? value : [value];
    return values.filter((candidate) => candidate instanceof BpmnElement);
  }

  private static contained(element: BpmnElement): readonly PropertyDescriptor[] {
    return (element.descriptor.properties ?? []).filter((property) => !property.isReference);
  }

  private static childrenInStackOrder(element: BpmnElement): readonly BpmnElement[] {
    if (element.isGeneric) {
      return ElementWalk.elementsIn(element.peek('$children') ?? []);
    }
    return ElementWalk.contained(element).flatMap((property) => ElementWalk.elementsIn(element.peek(property.name)).reverse());
  }

  depthFirst(options: WalkOptions = {}): Generator<BpmnElement> {
    return this.traverse(
      (element) => !options.bpmnOnly || element.isBpmn,
      (element) => (options.bpmnOnly && element.is('bpmn:ExtensionElements') ? [] : ElementWalk.childrenInStackOrder(element)),
    );
  }

  stored(skip: (element: BpmnElement) => boolean = () => false): Generator<BpmnElement> {
    return this.traverse(
      (element) => !skip(element),
      (element) => (element.isGeneric ? [] : ElementWalk.contained(element).flatMap((property) => ElementWalk.elementsIn(element.peek(property.name)))),
    );
  }

  private *traverse(admits: (element: BpmnElement) => boolean, childrenOf: (element: BpmnElement) => readonly BpmnElement[]): Generator<BpmnElement> {
    const seen = new Set<BpmnElement>();
    const stack = [this.root];
    while (stack.length) {
      const element = stack.pop()!;
      if (!seen.has(element) && admits(element)) {
        seen.add(element);
        yield element;
        stack.push(...childrenOf(element));
      } else {
        seen.add(element);
      }
    }
  }
}
