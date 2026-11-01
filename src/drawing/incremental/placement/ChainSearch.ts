import { Semantics } from '../../plane/Semantics.js';
import type { BpmnElement } from '../../../model/index.js';
import type { Plane } from '../../plane/Plane.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { PlacementState } from './PlacementState.js';

export class ChainSearch {
  private static readonly MAX_CHAIN_STEPS = 4;
  private static readonly MAX_REACH = 50;

  constructor(private readonly state: PlacementState) {}

  private static idOf(element: BpmnElement | undefined): string | undefined {
    return element?.peek<string>('id');
  }

  extent(id: string, pending: ReadonlySet<string>, gap: number): number {
    const { semantics } = this.state;
    if (!semantics.successors(id).length && !semantics.byId.get(id)?.is('bpmn:EndEvent')) {
      return ShapeSizes.EVENT.width + gap;
    }
    let extent = 0;
    let current = id;
    for (let step = 0; step < ChainSearch.MAX_CHAIN_STEPS; step++) {
      const next = semantics.successors(current).filter((successor) => pending.has(successor) && successor !== id);
      if (next.length !== 1) {
        break;
      }
      current = next[0]!;
      extent += this.state.sizeFor(current).width + gap;
    }
    return extent;
  }

  spliceTarget(plane: Plane, id: string, pred: string): string | undefined {
    const join = this.state.joins.get(id);
    if (join) {
      return join;
    }
    const before = this.state.placed.has(pred) ? this.state.spliced.get(pred) : undefined;
    if (before && before !== id && this.reaches(plane, id, before)) {
      return before;
    }
    return this.oldTargetOfIncoming(plane, id, pred) ?? this.targetWithOldSource(id, pred);
  }

  private oldTargetOfIncoming(plane: Plane, id: string, pred: string): string | undefined {
    const successors = new Set(this.state.semantics.successors(id));
    for (const flow of Semantics.sequenceFlows(this.state.semantics.byId.get(id), 'incoming')) {
      const flowId = ChainSearch.idOf(flow);
      const old = flowId && ChainSearch.idOf(flow.peek<BpmnElement>('sourceRef')) === pred ? this.state.oldTarget.get(flowId) : undefined;
      if (old && old !== id && (successors.has(old) || this.reaches(plane, id, old))) {
        return old;
      }
    }
    return undefined;
  }

  private targetWithOldSource(id: string, pred: string): string | undefined {
    for (const flow of Semantics.sequenceFlows(this.state.semantics.byId.get(id), 'outgoing')) {
      const flowId = ChainSearch.idOf(flow);
      const target = ChainSearch.idOf(flow.peek<BpmnElement>('targetRef'));
      if (flowId && target && this.state.oldSource.get(flowId) === pred) {
        return target;
      }
    }
    return undefined;
  }

  private reaches(plane: Plane, id: string, target: string): boolean {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length && seen.size <= ChainSearch.MAX_REACH) {
      for (const successor of this.state.semantics.successors(queue.shift()!)) {
        if (successor === target) {
          return true;
        }
        if (!seen.has(successor) && (!plane.shapes.has(successor) || this.state.placed.has(successor))) {
          seen.add(successor);
          queue.push(successor);
        }
      }
    }
    return false;
  }
}
