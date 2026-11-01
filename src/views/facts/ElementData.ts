import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import type { ElementRef } from '../lines/index.js';
import { ElementFacts } from './ElementFacts.js';

export interface ViewData extends ElementRef {
  kind: 'dataObject' | 'dataStore';
  from: ElementRef[];
  to: ElementRef[];
}

export interface DataLinks {
  reads?: ElementRef[] | undefined;
  writes?: ElementRef[] | undefined;
  readBy?: ElementRef[] | undefined;
  writtenBy?: ElementRef[] | undefined;
}

export class ElementData {
  constructor(private readonly document: BpmnDocument) {}

  private static isData(element: BpmnElement | undefined): element is BpmnElement {
    return !!element && (element.is('bpmn:DataObjectReference') || element.is('bpmn:DataStoreReference'));
  }

  private static refs(elements: readonly BpmnElement[]): ElementRef[] | undefined {
    return elements.length ? elements.map(ElementFacts.refOf) : undefined;
  }

  static empty(data: BpmnElement): ViewData {
    return { ...ElementFacts.refOf(data), kind: data.is('bpmn:DataStoreReference') ? 'dataStore' : 'dataObject', from: [], to: [] };
  }

  static of(element: BpmnElement): { reads: BpmnElement[]; writes: BpmnElement[] } {
    const reads = element.list('dataInputAssociations').flatMap((association) => association.list('sourceRef')).filter(ElementData.isData);
    const writes = element.list('dataOutputAssociations').map((association) => association.peek<BpmnElement>('targetRef')).filter(ElementData.isData);
    return { reads, writes };
  }

  links(element: BpmnElement): DataLinks | undefined {
    const links = ElementData.isData(element) ? this.usersOf(element) : ElementData.usedBy(element);
    return Object.values(links).some(Boolean) ? links : undefined;
  }

  nodesWithin(process: BpmnElement): BpmnElement[] {
    const scopes = [...this.document.tree.walk(process)].filter((element) => element.is('bpmn:Process') || element.is('bpmn:SubProcess'));
    return scopes.flatMap((scope) => this.document.scopes.flowNodes(scope));
  }

  private static usedBy(element: BpmnElement): DataLinks {
    const { reads, writes } = ElementData.of(element);
    return { reads: ElementData.refs(reads), writes: ElementData.refs(writes) };
  }

  private usersOf(data: BpmnElement): DataLinks {
    const process = this.document.scopes.processOf(data);
    const nodes = process ? this.nodesWithin(process) : [];
    return { readBy: ElementData.refs(nodes.filter((node) => ElementData.of(node).reads.includes(data))), writtenBy: ElementData.refs(nodes.filter((node) => ElementData.of(node).writes.includes(data))) };
  }
}
