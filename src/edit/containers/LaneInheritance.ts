import type { BpmnDocument, BpmnElement, Finding } from '../../model/index.js';
import { NodePlacement, type Placement } from './NodePlacement.js';

interface CrossLane {
  source: BpmnElement;
  target: BpmnElement;
  from?: BpmnElement;
  to?: BpmnElement;
  branching: boolean;
}

export class LaneInheritance {
  static readonly NONE = new LaneInheritance();

  private constructor(
    readonly lane?: BpmnElement,
    private readonly cross?: CrossLane,
  ) {}

  static of(document: BpmnDocument, placement: Placement): LaneInheritance {
    const anchor = LaneInheritance.anchorOf(document, placement);
    const lane = anchor ? document.scopes.laneOf(anchor) : undefined;
    const flow = LaneInheritance.splicedFlow(document, placement);
    if (!flow) {
      return new LaneInheritance(lane);
    }
    const source = flow.get<BpmnElement>('sourceRef');
    const target = flow.get<BpmnElement>('targetRef');
    const from = document.scopes.laneOf(source);
    const to = document.scopes.laneOf(target);
    if (from === to) {
      return new LaneInheritance(lane);
    }
    const branching = document.flows.outgoing(source).length > 1 && !!to;
    return new LaneInheritance(branching ? to : lane, { source, target, ...(from ? { from } : {}), ...(to ? { to } : {}), branching });
  }

  warning(id: string): Finding | undefined {
    const { lane, cross } = this;
    const other = cross && lane ? (lane === cross.from ? cross.to : cross.from) : undefined;
    if (!cross || !lane || !other) {
      return undefined;
    }
    const side = cross.branching
      ? `the lane of ${cross.target.id}, on whose row the layout puts it after the branching ${cross.source.id}`
      : `the lane of ${(lane === cross.to ? cross.target : cross.source).id}`;
    return {
      code: 'W_LANE_INHERITED',
      message: `${id} is in ${lane.id} (${side}); the flow it went into runs from ${cross.source.id} in ${cross.from ? cross.from.id : 'no lane'} to ${cross.target.id} in ${cross.to ? cross.to.id : 'no lane'}`,
      element: id,
      related: [lane.id, other.id],
      hint: `If ${other.id} does it: \`bpmn move <file> ${id} --lane ${other.id}\` (or --lane ${other.id} when adding).`,
    };
  }

  crossNote(id: string, own: BpmnElement): string | undefined {
    const { cross } = this;
    if (!cross || own === cross.from || own === cross.to) {
      return undefined;
    }
    const there = this.lane;
    return `${id} stays in its lane ${own.id}; the flow it went into runs from ${cross.source.id} in ${cross.from ? cross.from.id : 'no lane'} to ${cross.target.id} in ${cross.to ? cross.to.id : 'no lane'}${there ? ` (\`bpmn move <file> ${id} --lane ${there.id}\` puts it on the row the layout gives a node there)` : ''}`;
  }

  private static anchorOf(document: BpmnDocument, placement: Placement): BpmnElement | undefined {
    if (placement.on) {
      return document.tree.byId(placement.on);
    }
    if (placement.after) {
      return document.tree.byId(placement.after);
    }
    if (placement.before) {
      return document.tree.byId(placement.before);
    }
    if (placement.flow) {
      return document.tree.byId(placement.flow)?.get<BpmnElement | undefined>('sourceRef');
    }
    return undefined;
  }

  private static splicedFlow(document: BpmnDocument, placement: Placement): BpmnElement | undefined {
    const get = (id: string | undefined): BpmnElement | undefined => (id ? document.tree.byId(id) : undefined);
    switch (NodePlacement.modeOf(placement)) {
      case 'flow':
        return get(placement.flow);
      case 'between': {
        const afterNode = get(placement.after);
        const beforeNode = get(placement.before);
        return afterNode && beforeNode ? document.flows.outgoing(afterNode).find((flow) => flow.get<BpmnElement | undefined>('targetRef') === beforeNode) : undefined;
      }
      case 'after': {
        const afterNode = get(placement.after);
        const out = afterNode && !afterNode.is('bpmn:Gateway') ? document.flows.outgoing(afterNode) : [];
        return out.length === 1 ? out[0] : undefined;
      }
      case 'before': {
        const beforeNode = get(placement.before);
        const inc = beforeNode ? document.flows.incoming(beforeNode) : [];
        return inc.length === 1 ? inc[0] : undefined;
      }
      default:
        return undefined;
    }
  }
}
