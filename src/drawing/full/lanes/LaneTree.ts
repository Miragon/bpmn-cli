import { Box, type BpmnElement } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode, ScopeLayout } from '../scopes/GNode.js';
import { LaneBox } from '../scopes/LaneBox.js';

export interface LaneBand {
  el: BpmnElement;
  id: string;
  nodes: GNode[];
  subs: GNode[];
  children: LaneBand[];
  y: number;
  height: number;
}

export class LaneTree {
  readonly leaves: LaneBand[] = [];

  private readonly top: LaneBand[];
  private readonly nodesById: ReadonlyMap<string, GNode>;
  private readonly subsById: ReadonlyMap<string, GNode>;

  constructor(laneSet: BpmnElement, scope: ScopeLayout) {
    this.nodesById = new Map(scope.nodes.map((node) => [node.id, node]));
    this.subsById = new Map(scope.eventSubs.map((eventSub) => [eventSub.id, eventSub]));
    this.top = this.bandsOf(laneSet);
    this.top.forEach((band) => this.collectLeaves(band));
    const assigned = new Set(this.leaves.flatMap((lane) => lane.nodes));
    for (const node of scope.nodes) {
      if (!assigned.has(node)) {
        this.leaves[0]?.nodes.push(node);
      }
    }
  }

  private static closeUp(band: LaneBand): void {
    if (band.children.length) {
      band.children.forEach(LaneTree.closeUp);
      band.y = band.children[0]!.y;
      const end = band.children.at(-1)!;
      band.height = end.y + end.height - band.y;
    }
  }

  private static depthOf(bands: readonly LaneBand[]): number {
    return bands.length ? 1 + Math.max(...bands.map((band) => LaneTree.depthOf(band.children))) : 0;
  }

  private static boxOf(band: LaneBand, level: number, width: number, depth: number): LaneBox {
    const { LANE_HEADER } = ShapeSizes;
    const lane = new LaneBox(band.el, band.id, new Box(level * LANE_HEADER, band.y, width + (depth - level) * LANE_HEADER, band.height));
    lane.children.push(...band.children.map((child) => LaneTree.boxOf(child, level + 1, width, depth)));
    return lane;
  }

  closeUp(): void {
    this.top.forEach(LaneTree.closeUp);
  }

  boxes(width: number): LaneBox[] {
    const depth = LaneTree.depthOf(this.top);
    return this.top.map((band) => LaneTree.boxOf(band, 0, width, depth));
  }

  private bandsOf(laneSet: BpmnElement): LaneBand[] {
    return laneSet.list('lanes').map((lane) => {
      const child = lane.peek<BpmnElement>('childLaneSet');
      const band: LaneBand = { el: lane, id: lane.id, nodes: [], subs: [], children: child ? this.bandsOf(child) : [], y: 0, height: 0 };
      if (!band.children.length) {
        this.fill(band, lane);
      }
      return band;
    });
  }

  private fill(band: LaneBand, lane: BpmnElement): void {
    for (const ref of lane.get<BpmnElement[] | undefined>('flowNodeRef') ?? []) {
      const node = this.nodesById.get(ref.id);
      const sub = this.subsById.get(ref.id);
      if (node) {
        band.nodes.push(node);
      }
      if (sub) {
        band.subs.push(sub);
      }
    }
  }

  private collectLeaves(band: LaneBand): void {
    if (band.children.length) {
      band.children.forEach((child) => this.collectLeaves(child));
    } else {
      this.leaves.push(band);
    }
  }
}
