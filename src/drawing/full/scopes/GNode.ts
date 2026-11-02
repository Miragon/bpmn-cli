import { Box, type BpmnElement, type Point } from '../../../model/index.js';
import type { LaneBox } from './LaneBox.js';

export type GNodeKind = 'start' | 'end' | 'event' | 'gateway' | 'task' | 'subProcess' | 'eventSubProcess';

export interface GEdge {
  el: BpmnElement;
  id: string;
  source: GNode;
  target: GNode;
  back: boolean;
  bandRow?: number | undefined;
  bandY?: number | undefined;
  points: Point[];
  label?: Box | undefined;
  runsBelow?: boolean | undefined;
  runsAbove?: boolean | undefined;
}

export interface LinkEnd {
  box: Box;
  flow?: GEdge;
}

interface ArtifactLink {
  el: BpmnElement;
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  points: Point[];
}

export type GArtifactKind = 'annotation' | 'dataObject' | 'dataStore';

export interface GArtifact {
  el: BpmnElement;
  id: string;
  kind: GArtifactKind;
  width: number;
  height: number;
  box: Box;
  anchor?: LinkEnd | undefined;
  anchorNode?: GNode | undefined;
  links: ArtifactLink[];
}

export interface LaneBandInfo {
  nodes: Set<GNode>;
  top: number;
  bottom: number;
}

interface Compensation {
  el: BpmnElement;
  id: string;
  event: GNode;
  handler: GNode;
  points: Point[];
}

interface CrossLink {
  el: BpmnElement;
  id: string;
  sourceId: string;
  targetId: string;
}

export interface ScopeLayout {
  el: BpmnElement;
  nodes: GNode[];
  edges: GEdge[];
  artifacts: GArtifact[];
  eventSubs: GNode[];
  compensations: Compensation[];
  width: number;
  height: number;
  lanes: LaneBox[];
  laneBands?: LaneBandInfo[] | undefined;
  crossLinks: CrossLink[];
}

export class GNode {
  static readonly RUN_CLEAR = 15;
  static readonly RISE_KEEP = 5;

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
