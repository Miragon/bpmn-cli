import { ElementText, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import type { ElementRef } from '../lines/index.js';
import { ElementFacts } from './ElementFacts.js';

export interface ViewAnnotation {
  id: string;
  text?: string | undefined;
  attachedTo: ElementRef[];
}

export class ElementAnnotations {
  private owned?: BpmnElement[];

  constructor(private readonly document: BpmnDocument) {}

  private static otherEnd(association: BpmnElement, element: BpmnElement): BpmnElement | undefined {
    const source = association.peek<BpmnElement>('sourceRef');
    const target = association.peek<BpmnElement>('targetRef');
    if (source === element) {
      return target;
    }
    return target === element ? source : undefined;
  }

  static textOf(annotation: BpmnElement): Pick<ViewAnnotation, 'id' | 'text'> {
    const text = annotation.peek<string>('text');
    return { id: ElementText.shownId(annotation), text: text ? String(text) : undefined };
  }

  in(owners: readonly BpmnElement[]): ViewAnnotation[] {
    const annotations = owners.flatMap((owner) => owner.list('artifacts')).filter((element) => element.is('bpmn:TextAnnotation'));
    return annotations.map((annotation) => ({ ...ElementAnnotations.textOf(annotation), attachedTo: this.attachedTo(annotation).map(ElementFacts.refOf) }));
  }

  at(element: BpmnElement): BpmnElement[] {
    return [...new Set(this.attachedTo(element))].filter((other) => other.is('bpmn:TextAnnotation'));
  }

  attachedTo(element: BpmnElement): BpmnElement[] {
    return this.associations().flatMap((association) => ElementAnnotations.otherEnd(association, element) ?? []);
  }

  private associations(): BpmnElement[] {
    if (!this.owned) {
      const { tree } = this.document;
      const owners = [...tree.walk()].filter((element) => element.is('bpmn:Process') || element.is('bpmn:SubProcess') || element.is('bpmn:Collaboration'));
      this.owned = owners.flatMap((owner) => owner.list('artifacts')).filter((artifact) => artifact.is('bpmn:Association'));
    }
    return this.owned;
  }
}
