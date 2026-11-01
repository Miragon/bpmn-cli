import { type BpmnElement, BpmnError } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export interface Branch {
  nodes: BpmnElement[];
  stops: BpmnElement[];
}

export class BranchReach {
  constructor(private readonly edit: EditSession) {}

  branchOf(root: BpmnElement): Branch {
    this.assertOnePath(root);
    const inBranch = new Set<BpmnElement>([root]);
    const stops = new Set<BpmnElement>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const member of [...inBranch]) {
        for (const successor of this.successorsOf(member)) {
          if (inBranch.has(successor)) {
            continue;
          }
          if (this.predecessorsOf(successor).every((predecessor) => inBranch.has(predecessor))) {
            inBranch.add(successor);
            stops.delete(successor);
            grew = true;
          } else {
            stops.add(successor);
          }
        }
      }
    }
    const order = new Map([...this.edit.document.tree.all().values()].map((el, position) => [el, position]));
    const byOrder = (left: BpmnElement, right: BpmnElement): number => (order.get(left) ?? 0) - (order.get(right) ?? 0);
    const others = [...inBranch].filter((member) => member !== root);
    return { nodes: [root, ...others.sort(byOrder)], stops: [...stops].sort(byOrder) };
  }

  private assertOnePath(root: BpmnElement): void {
    const incoming = this.edit.document.flows.incoming(root);
    if (incoming.length > 1) {
      throw BpmnError.model('E_AMBIGUOUS_BRANCH', `${root.id} is reached by ${incoming.length} paths (${incoming.map((flow) => flow.get<BpmnElement>('sourceRef').id).join(', ')}); its downstream is not the branch of one path`, {
        element: root.id,
        candidates: incoming.map((flow) => flow.id),
        hint: `Remove the branch from a node only one path reaches (the first node after the split), or remove ${root.id} alone (\`bpmn remove <file> ${root.id} --bridge-all\` reconnects the paths to its successor).`,
      });
    }
  }

  private successorsOf(node: BpmnElement): BpmnElement[] {
    return [
      ...this.edit.document.flows.outgoing(node).map((flow) => flow.get<BpmnElement>('targetRef')),
      ...(node.is('bpmn:Activity') ? this.edit.document.scopes.boundaryEventsOf(node) : []),
      ...this.compensationHandlers(node),
    ];
  }

  private predecessorsOf(node: BpmnElement): BpmnElement[] {
    if (node.is('bpmn:BoundaryEvent')) {
      return [node.get<BpmnElement>('attachedToRef')];
    }
    const preds = this.edit.document.flows.incoming(node).map((flow) => flow.get<BpmnElement>('sourceRef'));
    if (node.get<boolean | undefined>('isForCompensation')) {
      preds.push(...this.compensationSources(node));
    }
    return preds;
  }

  private compensationHandlers(node: BpmnElement): BpmnElement[] {
    if (!node.is('bpmn:BoundaryEvent')) {
      return [];
    }
    return [...this.edit.document.tree.all().values()].filter((association) => association.is('bpmn:Association') && association.get<BpmnElement | undefined>('sourceRef') === node).map((association) => association.get<BpmnElement>('targetRef')).filter((target) => !!target && !!target.get<boolean | undefined>('isForCompensation'));
  }

  private compensationSources(handler: BpmnElement): BpmnElement[] {
    return [...this.edit.document.tree.all().values()].filter((association) => association.is('bpmn:Association') && association.get<BpmnElement | undefined>('targetRef') === handler).map((association) => association.get<BpmnElement>('sourceRef')).filter((source): source is BpmnElement => !!source && source.is('bpmn:BoundaryEvent'));
  }
}
