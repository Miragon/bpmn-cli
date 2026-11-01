import { Box, type BpmnElement } from '../../../model/index.js';
import type { GEdge } from './GEdge.js';
import type { ScopeLayout } from './ScopeLayout.js';

export type GNodeKind = 'start' | 'end' | 'event' | 'gateway' | 'task' | 'subProcess' | 'eventSubProcess';

export class GNode {
  private static readonly DATA_OFFSET = 30;
  private static readonly BOTTOM_SLOT_OFFSET = 25;
  private static readonly WIDE_ENOUGH_FOR_SLOTS = 100;

  width: number;
  height: number;
  readonly boundary: GNode[] = [];
  host?: GNode | undefined;
  onTop?: boolean | undefined;
  labelLeft?: boolean | undefined;
  child?: ScopeLayout | undefined;
  childPad?: { left: number; top: number; inner: number } | undefined;
  compensationHandler?: GNode | undefined;
  compensatedBy?: GNode | undefined;
  layer = 0;
  row = 0;
  band = 0;
  topUsed?: boolean | undefined;
  box = new Box(0, 0, 0, 0);
  readonly out: GEdge[] = [];
  readonly in: GEdge[] = [];

  constructor(
    readonly el: BpmnElement,
    readonly id: string,
    size: { width: number; height: number },
    readonly kind: GNodeKind,
  ) {
    this.width = size.width;
    this.height = size.height;
  }

  get name(): string | undefined {
    return this.el.name;
  }

  get isEvent(): boolean {
    return this.kind === 'start' || this.kind === 'end' || this.kind === 'event';
  }

  get keepsBoundaryLeft(): boolean {
    return this.kind === 'subProcess' && !this.child;
  }

  get outgoing(): GEdge[] {
    return [...this.out, ...this.boundary.flatMap((boundaryEvent) => boundaryEvent.out)];
  }

  get exitX(): number {
    return this.bottomCandidates()[0]!;
  }

  get topX(): number {
    return this.child ? this.box.x + Math.min(40, this.box.width / 4) : this.box.center.x;
  }

  get dataX(): number {
    const centerX = this.box.center.x;
    if (!this.boundary.length) {
      return centerX + Math.min(GNode.DATA_OFFSET, this.box.width / 2 - 10);
    }
    return this.keepsBoundaryLeft ? centerX + GNode.DATA_OFFSET : centerX - GNode.DATA_OFFSET;
  }

  shift(dx: number, dy: number): void {
    this.box.translate(dx, dy);
    for (const boundaryEvent of this.boundary) {
      boundaryEvent.box.translate(dx, dy);
    }
  }

  bottomCandidates(): number[] {
    const { box } = this;
    const centerX = box.center.x;
    if (!this.boundary.length) {
      return box.width >= GNode.WIDE_ENOUGH_FOR_SLOTS ? [centerX, centerX - GNode.BOTTOM_SLOT_OFFSET, centerX + GNode.BOTTOM_SLOT_OFFSET] : [centerX];
    }
    return this.keepsBoundaryLeft ? [box.right - 20, box.right - 8] : [box.x + 20, box.x + 8];
  }

  risesInto(): GEdge[] {
    return this.in.filter((edge) => !edge.back && !edge.source.onTop && (edge.bandY !== undefined || edge.source.box.center.y > this.box.center.y + 1));
  }

  entriesFromBelow(): GEdge[] {
    return this.kind === 'gateway' && this.in.filter((edge) => !edge.back).length >= 2 ? this.risesInto() : [];
  }

  riseSlots(): number[] {
    const candidates = this.bottomCandidates();
    const dropsToBelow = this.out.some((edge) => !edge.back && edge.target.box.center.y > this.box.center.y + 1);
    return candidates.length > 1 && dropsToBelow ? candidates.slice(1) : candidates;
  }

  riseX(): number {
    return this.riseSlots()[0]!;
  }
}
