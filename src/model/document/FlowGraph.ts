import type { BpmnElement } from './BpmnElement.js';
import type { BpmnTree } from './BpmnTree.js';

export class FlowGraph {
  constructor(private readonly tree: BpmnTree) {}

  incoming(node: BpmnElement): BpmnElement[] {
    return node.list('incoming').filter((flow) => flow.is('bpmn:SequenceFlow'));
  }

  outgoing(node: BpmnElement): BpmnElement[] {
    return node.list('outgoing').filter((flow) => flow.is('bpmn:SequenceFlow'));
  }

  sequenceFlows(scope: BpmnElement): BpmnElement[] {
    return scope.list('flowElements').filter((element) => element.is('bpmn:SequenceFlow'));
  }

  allSequenceFlows(): BpmnElement[] {
    return [...this.tree.all().values()].filter((element) => element.is('bpmn:SequenceFlow'));
  }

  messageFlows(): readonly BpmnElement[] {
    return this.tree.collaboration()?.list('messageFlows') ?? [];
  }

  participants(): readonly BpmnElement[] {
    return this.tree.collaboration()?.list('participants') ?? [];
  }

  participantOf(process: BpmnElement): BpmnElement | undefined {
    return this.participants().find((participant) => participant.get<BpmnElement | undefined>('processRef') === process);
  }
}
