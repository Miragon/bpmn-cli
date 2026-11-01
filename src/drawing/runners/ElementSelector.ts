import { BpmnError, type BpmnDocument, type BpmnElement } from '../../model/index.js';

export interface Selection {
  ids?: string[] | undefined;
  path?: string[] | undefined;
  branch?: string | undefined;
}

export interface SelectionView {
  shapesOnly: boolean;
  drawn(id: string): boolean;
  centreX(id: string): number | undefined;
}

interface Step {
  flow?: BpmnElement;
  to: BpmnElement;
}

interface Arrival {
  from: BpmnElement;
  flow?: BpmnElement | undefined;
}

type Forward = (from: BpmnElement, to: BpmnElement) => boolean;

export class ElementSelector {
  private static readonly LEFTWARD_TOLERANCE = 1;
  private static readonly CONNECTIONS = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation'];

  constructor(private readonly document: BpmnDocument) {}

  private static idOf(element: BpmnElement): string {
    return element.peek<string>('id') ?? '';
  }

  private static noMatch(message: string, hint: string, element?: string): BpmnError {
    return BpmnError.model('E_NO_MATCH', message, { ...(element ? { element } : {}), hint });
  }

  private static isShape(element: BpmnElement): boolean {
    return !ElementSelector.CONNECTIONS.some((type) => element.is(type)) && !element.is('bpmn:BoundaryEvent');
  }

  private static walkedBack(start: BpmnElement, goal: BpmnElement, arrivals: Map<BpmnElement, Arrival>): BpmnElement[] {
    const walked: BpmnElement[] = [];
    for (let node = goal; node !== start; ) {
      const { from, flow } = arrivals.get(node)!;
      walked.unshift(node);
      if (flow) {
        walked.unshift(flow);
      }
      node = from;
    }
    return walked;
  }

  path(fromId: string, toId: string): BpmnElement[] {
    const { tree } = this.document;
    const from = tree.require(fromId, 'bpmn:FlowNode', 'flow node');
    const to = tree.require(toId, 'bpmn:FlowNode', 'flow node');
    const leg = this.shortest(from, to);
    if (!leg) {
      throw ElementSelector.noMatch(`No sequence-flow path leads from ${fromId} to ${toId}`, 'Check the direction (--path <fromId> <toId>); `bpmn show <file>` lists the flows of every node.', toId);
    }
    return [...new Set([from, ...leg])];
  }

  branch(flowId: string, centreX: SelectionView['centreX']): BpmnElement[] {
    const { flows, tree } = this.document;
    const flow = tree.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
    const source = flow.peek<BpmnElement>('sourceRef')!;
    const target = flow.peek<BpmnElement>('targetRef')!;
    const forward: Forward = (from, to) => {
      const start = centreX(ElementSelector.idOf(from));
      const end = centreX(ElementSelector.idOf(to));
      return start === undefined || end === undefined || end >= start - ElementSelector.LEFTWARD_TOLERANCE;
    };
    const siblings = flows.outgoing(source).filter((sibling) => sibling !== flow);
    const others = new Set(siblings.flatMap((sibling) => this.reach(sibling.peek<BpmnElement>('targetRef')!, source, forward)));
    const nodes = this.reach(target, source, forward).filter((node) => !others.has(node));
    if (!nodes.length) {
      const message = `Nothing lies on the branch of ${flowId}: it leads to ${ElementSelector.idOf(target)}, which the other branches of ${ElementSelector.idOf(source)} reach too`;
      throw ElementSelector.noMatch(message, 'Name a flow that starts a branch with its own nodes (`bpmn show <file>` lists the outgoing flows of the gateway).', flowId);
    }
    return [flow, ...nodes, ...new Set(nodes.flatMap((node) => flows.outgoing(node)))];
  }

  select({ ids, path, branch }: Selection, view: SelectionView): string[] {
    const found = [...(branch ? this.branch(branch, (id) => view.centreX(id)) : []), ...(path ? this.path(path[0]!, path[1]!) : [])];
    const picked = found
      .filter((element) => !view.shapesOnly || ElementSelector.isShape(element))
      .map((element) => ElementSelector.idOf(element))
      .filter((id) => id && view.drawn(id));
    const selected = [...new Set([...(ids ?? []), ...picked])];
    if (!selected.length) {
      throw ElementSelector.noMatch('The selection names no drawn element', 'Name ids, or a --path / --branch that reaches drawn elements (`bpmn diagram <file>` lists what is drawn).');
    }
    return selected;
  }

  private steps(node: BpmnElement): Step[] {
    const { flows, scopes } = this.document;
    const outgoing = flows.outgoing(node);
    const preferred = node.peek<BpmnElement>('default');
    const ordered = preferred && outgoing.includes(preferred) ? [preferred, ...outgoing.filter((flow) => flow !== preferred)] : outgoing;
    const steps: Step[] = ordered.flatMap((flow) => {
      const to = flow.peek<BpmnElement>('targetRef');
      return to ? [{ flow, to }] : [];
    });
    const boundaries = node.is('bpmn:Activity') ? scopes.boundaryEventsOf(node).map((to) => ({ to })) : [];
    return [...steps, ...boundaries];
  }

  private shortest(start: BpmnElement, goal: BpmnElement): BpmnElement[] | undefined {
    if (start === goal) {
      return [];
    }
    const arrivals = new Map<BpmnElement, Arrival>();
    const seen = new Set([start]);
    const queue = [start];
    for (let current = queue.shift(); current; current = queue.shift()) {
      for (const { to, flow } of this.steps(current)) {
        if (seen.has(to)) {
          continue;
        }
        seen.add(to);
        arrivals.set(to, { from: current, flow });
        if (to === goal) {
          return ElementSelector.walkedBack(start, goal, arrivals);
        }
        queue.push(to);
      }
    }
    return undefined;
  }

  private reach(start: BpmnElement, stop: BpmnElement, forward: Forward): BpmnElement[] {
    const seen = new Set([start]);
    for (const node of seen) {
      for (const { to } of this.steps(node)) {
        if (to !== stop && forward(node, to)) {
          seen.add(to);
        }
      }
    }
    return [...seen];
  }
}
