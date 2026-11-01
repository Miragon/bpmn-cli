import { BpmnError, type BpmnDocument, type BpmnElement } from '../../model/index.js';

type Reached = Map<BpmnElement, { from: BpmnElement; flow?: BpmnElement | undefined }>;

export class FlowPath {
  constructor(private readonly document: BpmnDocument) {}

  between(fromId: string, toId: string): BpmnElement[] {
    const { tree } = this.document;
    const from = tree.require(fromId, 'bpmn:FlowNode', 'flow node');
    const to = tree.require(toId, 'bpmn:FlowNode', 'flow node');
    const reached = this.reachedFrom(from);
    if (from !== to && !reached.has(to)) {
      throw BpmnError.model('E_NO_MATCH', `No sequence-flow path leads from ${fromId} to ${toId}`, { element: toId, hint: 'Check the direction (--path <fromId> <toId>); `bpmn show <file>` lists the flows of every node.' });
    }
    const path = [to];
    for (let step = reached.get(to); path[0] !== from && step; step = reached.get(step.from)) {
      path.unshift(step.from, ...(step.flow ? [step.flow] : []));
    }
    return path;
  }

  private stepsFrom(node: BpmnElement): Array<{ flow?: BpmnElement; to: BpmnElement | undefined }> {
    const outgoing = this.document.flows.outgoing(node);
    const preferred = outgoing.find((flow) => flow === node.peek<BpmnElement>('default'));
    const ordered = preferred ? [preferred, ...outgoing.filter((flow) => flow !== preferred)] : outgoing;
    const boundaries = node.is('bpmn:Activity') ? this.document.scopes.boundaryEventsOf(node) : [];
    return [...ordered.map((flow) => ({ flow, to: flow.peek<BpmnElement>('targetRef') })), ...boundaries.map((to) => ({ to }))];
  }

  private reachedFrom(start: BpmnElement): Reached {
    const reached: Reached = new Map();
    const queue = [start];
    for (const current of queue) {
      for (const { flow, to } of this.stepsFrom(current)) {
        if (to && to !== start && !reached.has(to)) {
          reached.set(to, { from: current, flow });
          queue.push(to);
        }
      }
    }
    return reached;
  }
}
