import type { BpmnElement } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import { Semantics } from '../../plane/Semantics.js';
import type { LayoutRun } from './LayoutRun.js';

interface DrawnEnds {
  plane: Plane;
  source: PlaneShape;
  target: PlaneShape;
}

export class JoinPuller {
  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
  ) {}

  private static sameFrame(shape: PlaneShape | undefined, join: PlaneShape): boolean {
    return !!shape && shape.poolId === join.poolId && shape.parentId === join.parentId;
  }

  pushTargets(): void {
    for (const element of this.freshFlows()) {
      const ends = this.drawnEnds(element);
      if (ends && !this.run.relocated.has(ends.target.id) && !this.run.relocated.has(ends.source.id) && JoinPuller.sameFrame(ends.source, ends.target)) {
        this.run.placer.pushBehind(ends.plane, ends.source, ends.target);
      }
    }
  }

  pullJoins(): void {
    const next = this.nextNodes();
    for (const element of this.freshFlows()) {
      const ends = this.drawnEnds(element);
      if (ends && this.isKeptGatewayAhead(ends.target, ends.source)) {
        this.pullJoin(ends.plane, ends.target, ends.source, next);
      }
    }
  }

  private freshFlows(): BpmnElement[] {
    const { semantics, place } = this.run;
    const before = new Set([...this.before.flowEnds.keys()].map((id) => this.before.currentId(id)));
    return [...semantics.byId.values()].filter((element) => {
      const id = element.peek<string>('id');
      return element.is('bpmn:SequenceFlow') && !!id && (!before.has(id) || place.oldTarget.has(id));
    });
  }

  private drawnEnds(element: BpmnElement): DrawnEnds | undefined {
    const { sourceId, targetId } = PlaneReader.edgeEnds(element);
    const plane = this.run.planes.find((candidate) => !!targetId && candidate.shapes.has(targetId));
    const target = targetId ? plane?.shapes.get(targetId) : undefined;
    const source = sourceId ? plane?.shapes.get(sourceId) : undefined;
    return plane && source && target ? { plane, source, target } : undefined;
  }

  private isKeptGatewayAhead(join: PlaneShape, source: PlaneShape): boolean {
    const kept = !!join.planeElement && this.before.byPlaneElement.has(join.planeElement) && !this.run.relocated.has(join.id) && !this.run.place.joins.has(join.id);
    return kept && join.el.is('bpmn:Gateway') && join.bounds.center.x < source.bounds.x;
  }

  private pullJoin(plane: Plane, join: PlaneShape, source: PlaneShape, next: Map<string, string[]>): void {
    const incoming = Semantics.sequenceFlows(join.el, 'incoming');
    const outgoing = Semantics.sequenceFlows(join.el, 'outgoing');
    const successor = outgoing.length === 1 ? plane.shapes.get(outgoing[0]!.peek<BpmnElement>('targetRef')?.peek<string>('id') ?? '') : undefined;
    if (incoming.length < 2 || !successor || this.reaches(next, join.id, source.id)) {
      return;
    }
    const preds = incoming.map((flow) => plane.shapes.get(flow.peek<BpmnElement>('sourceRef')?.peek<string>('id') ?? ''));
    const rightmost = Math.max(...preds.map((pred) => pred?.bounds.right ?? Number.NEGATIVE_INFINITY));
    if (!preds.every((pred) => JoinPuller.sameFrame(pred, join)) || !JoinPuller.sameFrame(successor, join) || (successor.bounds.x <= rightmost && successor.bounds.x < join.bounds.right)) {
      return;
    }
    plane.shapes.delete(join.id);
    this.run.place.reuse.set(join.id, { shape: join, boundaries: [], from: plane });
    this.run.place.joins.set(join.id, successor.id);
    this.run.relocated.add(join.id);
    for (const edge of plane.edges.values()) {
      if (edge.sourceId === join.id || edge.targetId === join.id) {
        this.run.reroute.add(edge.id);
      }
    }
  }

  private nextNodes(): Map<string, string[]> {
    const next = new Map<string, string[]>();
    for (const element of this.run.semantics.byId.values()) {
      const { sourceId, targetId } = this.stepOf(element);
      if (sourceId && targetId) {
        next.set(sourceId, [...(next.get(sourceId) ?? []), targetId]);
      }
    }
    return next;
  }

  private stepOf(element: BpmnElement): { sourceId?: string | undefined; targetId?: string | undefined } {
    if (element.is('bpmn:SequenceFlow')) {
      return PlaneReader.edgeEnds(element);
    }
    return element.is('bpmn:BoundaryEvent') ? { sourceId: element.peek<BpmnElement>('attachedToRef')?.peek<string>('id'), targetId: element.peek<string>('id') } : {};
  }

  private reaches(next: ReadonlyMap<string, string[]>, from: string, to: string): boolean {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      for (const successor of next.get(stack.pop()!) ?? []) {
        if (successor === to) {
          return true;
        }
        if (!seen.has(successor)) {
          seen.add(successor);
          stack.push(successor);
        }
      }
    }
    return false;
  }
}
