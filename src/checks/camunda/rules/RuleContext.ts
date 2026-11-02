import { type BpmnDocument, type BpmnElement, type DocumentNamespaces } from '../../../model/index.js';

export class RuleContext {
  readonly outgoing = new Map<BpmnElement, BpmnElement[]>();
  readonly incoming = new Map<BpmnElement, BpmnElement[]>();

  constructor(
    readonly document: BpmnDocument,
    readonly namespaces: DocumentNamespaces,
    readonly prefix: string,
    readonly operaton = false,
  ) {
    for (const flow of document.tree.walk(document.tree.definitions, { bpmnOnly: true })) {
      if (flow.is('bpmn:SequenceFlow')) {
        RuleContext.append(this.outgoing, flow.peek<BpmnElement>('sourceRef'), flow);
        RuleContext.append(this.incoming, flow.peek<BpmnElement>('targetRef'), flow);
      }
    }
  }

  private static append(flows: Map<BpmnElement, BpmnElement[]>, node: BpmnElement | undefined, flow: BpmnElement): void {
    if (node) {
      flows.set(node, [...(flows.get(node) ?? []), flow]);
    }
  }
}
