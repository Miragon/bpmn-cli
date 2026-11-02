import { type BpmnElement, BpmnError, ElementWalk, FlowEnds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { NodePlacement, type PlacementOptions } from './NodePlacement.js';

interface HeldAnchor {
  anchor: BpmnElement;
  holder: BpmnElement;
}

export class MoveAnchors {
  constructor(private readonly edit: EditSession) {}

  static describePlacement(placement: PlacementOptions): string {
    if (placement.after && placement.before) {
      return `between ${placement.after} and ${placement.before}`;
    }
    if (placement.after) {
      return `after ${placement.after}`;
    }
    if (placement.before) {
      return `before ${placement.before}`;
    }
    if (placement.flow) {
      return `into flow ${placement.flow}`;
    }
    if (placement.on) {
      return `onto ${placement.on}`;
    }
    return `into ${placement.in ?? 'the process'}`;
  }

  static assertNotInside(node: BpmnElement, anchor: BpmnElement): void {
    if (MoveAnchors.isInside(node, anchor)) {
      const what = MoveAnchors.isBoundaryOf(node, anchor) ? 'that is one of its boundary events, which move with it' : 'that is the node itself or one of its children';
      throw BpmnError.model('E_INVALID_PLACEMENT', `${node.id} cannot be moved relative to ${anchor.id}: ${what}`, {
        element: node.id,
        related: [anchor.id],
        hint: 'Pick an anchor outside the moved node.',
      });
    }
  }

  static assertNotBoundary(node: BpmnElement): void {
    if (node.is('bpmn:BoundaryEvent')) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `Boundary event ${node.id} is moved with --on <activityId>`, { element: node.id });
    }
  }

  assertFirstPlacement(node: BpmnElement, placement: PlacementOptions): void {
    MoveAnchors.assertNotBoundary(node);
    for (const anchor of this.anchorsOf(placement)) {
      MoveAnchors.assertNotInside(node, anchor);
    }
  }

  assertChainAnchor(nodes: BpmnElement[], options: PlacementOptions): void {
    const mode = NodePlacement.modeOf(options);
    const flow = mode === 'flow' ? this.edit.require(options.flow!, 'bpmn:SequenceFlow', 'sequence flow') : undefined;
    const after = mode === 'after' || mode === 'between' ? this.edit.require(options.after!, 'bpmn:FlowNode') : flow && new FlowEnds(flow).source;
    const before = mode === 'before' || mode === 'between' ? this.edit.require(options.before!, 'bpmn:FlowNode') : undefined;
    const held = MoveAnchors.heldAnchor(nodes.slice(1), after, before);
    if (!held) {
      return;
    }
    const { anchor } = held;
    const ids = nodes.map((element) => element.id);
    const what = MoveAnchors.holderText(held);
    const hint = this.chainHint(nodes, options, anchor, anchor === before, flow);
    throw BpmnError.model('E_INVALID_PLACEMENT', `${flow ? `${flow.id} cannot anchor the move of ${ids.join(', ')}: its source ${anchor.id}` : `${anchor.id} cannot anchor the move of ${ids.join(', ')}: it`} ${what}`, {
      element: flow ? flow.id : anchor.id,
      related: ids,
      hint,
    });
  }

  inPlace(nodes: BpmnElement[], placement: PlacementOptions): boolean {
    if (nodes.some((node) => node.is('bpmn:BoundaryEvent')) || new Set(nodes).size !== nodes.length) {
      return false;
    }
    const onlyIn = (node: BpmnElement): BpmnElement | undefined => {
      const flows = this.edit.document.flows.incoming(node);
      return flows.length === 1 ? new FlowEnds(flows[0]!).source : undefined;
    };
    const onlyOut = (node: BpmnElement): BpmnElement | undefined => {
      const flows = this.edit.document.flows.outgoing(node);
      return flows.length === 1 ? new FlowEnds(flows[0]!).target : undefined;
    };
    for (let index = 1; index < nodes.length; index++) {
      if ((nodes[index - 1]!).is('bpmn:Gateway') || onlyIn(nodes[index]!) !== nodes[index - 1]) {
        return false;
      }
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const mode = NodePlacement.modeOf(placement);
    if (mode === 'after') {
      const afterNode = this.edit.require(placement.after!, 'bpmn:FlowNode');
      return !afterNode.is('bpmn:Gateway') && onlyIn(first) === afterNode;
    }
    if (mode === 'before') {
      const beforeNode = this.edit.require(placement.before!, 'bpmn:FlowNode');
      return !(beforeNode.is('bpmn:Gateway') && this.edit.document.flows.incoming(beforeNode).length >= 2) && onlyOut(last) === beforeNode;
    }
    if (mode === 'between') {
      return onlyIn(first) === this.edit.require(placement.after!, 'bpmn:FlowNode') && onlyOut(last) === this.edit.require(placement.before!, 'bpmn:FlowNode');
    }
    return false;
  }

  private anchorsOf(placement: PlacementOptions): BpmnElement[] {
    const out: BpmnElement[] = [];
    if (placement.after) {
      out.push(this.edit.require(placement.after, 'bpmn:FlowNode'));
    }
    if (placement.before) {
      out.push(this.edit.require(placement.before, 'bpmn:FlowNode'));
    }
    if (placement.flow) {
      const flow = this.edit.require(placement.flow, 'bpmn:SequenceFlow', 'sequence flow');
      out.push(new FlowEnds(flow).source, new FlowEnds(flow).target);
    }
    if (placement.on) {
      out.push(this.edit.require(placement.on, 'bpmn:Activity', 'activity'));
    }
    if (placement.in) {
      out.push(this.edit.requireScope(placement.in));
    }
    return out;
  }

  private static isBoundaryOf(node: BpmnElement, anchor: BpmnElement): boolean {
    return anchor.is('bpmn:BoundaryEvent') && anchor.get<BpmnElement | undefined>('attachedToRef') === node;
  }

  private static isInside(node: BpmnElement, anchor: BpmnElement): boolean {
    return anchor === node || MoveAnchors.isBoundaryOf(node, anchor) || [...new ElementWalk(node).depthFirst()].includes(anchor);
  }

  private static heldAnchor(later: BpmnElement[], after: BpmnElement | undefined, before: BpmnElement | undefined): HeldAnchor | undefined {
    const afterHolder = after && later.find((laterNode) => MoveAnchors.isInside(laterNode, after));
    if (after && afterHolder) {
      return { anchor: after, holder: afterHolder };
    }
    const beforeHolder = before && later.find((laterNode) => laterNode !== before && MoveAnchors.isInside(laterNode, before));
    return before && beforeHolder ? { anchor: before, holder: beforeHolder } : undefined;
  }

  private static holderText({ anchor, holder }: HeldAnchor): string {
    if (anchor === holder) {
      return 'is one of the moved nodes';
    }
    return `is ${MoveAnchors.isBoundaryOf(holder, anchor) ? 'a boundary event of' : 'inside'} ${holder.id}, one of the moved nodes`;
  }

  private chainHint(nodes: BpmnElement[], options: PlacementOptions, anchor: BpmnElement, anchoredBefore: boolean, flow: BpmnElement | undefined): string {
    const first = nodes[0]!.id;
    const itself = `The chain would be placed ${anchoredBefore ? 'inside' : 'after'} itself.`;
    if (!this.inPlace(nodes.slice(0, 1), options)) {
      const placement = flow ? `--flow ${flow.id}` : MoveAnchors.anchorFlags(options);
      return `${itself} Pick an anchor outside the moved nodes, or move ${first} alone: \`bpmn move <file> ${first} ${placement}\`.`;
    }
    const reorder = NodePlacement.modeOf(options) === 'after' && this.edit.document.flows.incoming(anchor).length === 1;
    return `${itself} ${first} is already ${MoveAnchors.describePlacement(options)}. Pick an anchor outside the moved nodes${reorder ? `, or put ${first} before ${anchor.id}: \`bpmn move <file> ${first} --before ${anchor.id}\`` : ''}.`;
  }

  private static anchorFlags(options: PlacementOptions): string {
    return [...(options.after ? [`--after ${options.after}`] : []), ...(options.before ? [`--before ${options.before}`] : [])].join(' ');
  }
}
