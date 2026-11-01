import type { BpmnElement } from '../document/BpmnElement.js';
import { BpmnError } from '../errors/BpmnError.js';

export class FlowEnds {
  constructor(private readonly flow: BpmnElement) {}

  get source(): BpmnElement {
    return this.required('sourceRef', 'source');
  }

  get target(): BpmnElement {
    return this.required('targetRef', 'target');
  }

  private required(property: string, end: string): BpmnElement {
    const node = this.flow.get<BpmnElement | undefined>(property);
    if (!node) {
      const { id } = this.flow;
      throw BpmnError.model('E_DANGLING_REF', `${id} has no ${end} (unresolved reference)`, { element: id, hint: `Remove it with \`bpmn remove <file> ${id}\` and re-connect with \`bpmn connect <file> <sourceId> <targetId>\`.` });
    }
    return node;
  }
}
