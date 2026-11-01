import { Polyline, type Box, type Point, type Segment } from '../../../model/index.js';
import { GEdge } from '../scopes/GEdge.js';
import type { GNode } from '../scopes/GNode.js';
import type { ScopeLayout } from '../scopes/ScopeLayout.js';
import { XIndex } from '../scopes/XIndex.js';
import { DownRoute } from './DownRoute.js';
import { FlowLabelSpot } from './FlowLabelSpot.js';
import { FlowPaths } from './FlowPaths.js';
import { LoopRoute } from './LoopRoute.js';
import { RoutingArea, type Route } from './RoutingArea.js';
import { SameRowRoute } from './SameRowRoute.js';
import { UpRoute } from './UpRoute.js';

export class ChannelRouter {
  private static readonly CLEAR_OF_THE_TOP = 10;
  private static readonly SAME_ROW = 1;

  private readonly area: RoutingArea;
  private readonly paths: FlowPaths;
  private readonly sameRow: SameRowRoute;

  constructor(private readonly layout: ScopeLayout) {
    this.area = new RoutingArea(layout);
    this.paths = new FlowPaths(this.area);
    this.sameRow = new SameRowRoute(this.area, this.paths);
  }

  route(): void {
    const { layout, area } = this;
    for (const edge of [...this.forwardFlows(), ...this.loops()]) {
      this.routeEdge(edge);
    }
    this.markTopsUsed();
    const lowestRun = Math.max(0, ...layout.edges.filter((edge) => edge.runsBelow).map((edge) => edge.points[1]!.y + GEdge.RUN_CLEAR));
    layout.height = Math.max(layout.height, area.channels.lowest() + ChannelRouter.CLEAR_OF_THE_TOP, lowestRun);
    this.moveBelowTop();
  }

  faults(labels: readonly Box[] = []): { crossings: number; hits: number; labels: number } {
    const { routed } = this.area;
    let hits = 0;
    for (const edge of this.layout.edges) {
      const own = [edge.source.box, edge.target.box, ...(edge.source.host ? [edge.source.host.box] : [])];
      hits += new Polyline(edge.points).hitCount(this.area.boxes, own);
    }
    const crossedLabels = labels.filter((label) => routed.each(label.x, label.right, (segment) => segment.hitsBounds(label)));
    return { crossings: this.crossingPairs(), hits, labels: crossedLabels.length };
  }

  private crossingPairs(): number {
    const { routed, flowSegments, firstIds } = this.area;
    const owner = new Int32Array(routed.size);
    firstIds.forEach((id, flowIndex) => owner.fill(flowIndex, id));
    const lastCrossedBy = new Array<number>(flowSegments.length).fill(-1);
    let crossings = 0;
    flowSegments.forEach((segments, flowIndex) => {
      const later = firstIds[flowIndex + 1] ?? routed.size;
      for (const segment of segments) {
        const [low, high] = RoutingArea.xSpan(segment);
        const visit = (other: Segment, id: number): void => {
          const otherFlow = owner[id]!;
          if (lastCrossedBy[otherFlow] !== flowIndex && segment.crosses(other)) {
            lastCrossedBy[otherFlow] = flowIndex;
            crossings++;
          }
        };
        routed.each(low, high, visit, later);
      }
    });
    return crossings;
  }

  private forwardFlows(): GEdge[] {
    const { openRow } = this.area;
    const forward = this.layout.edges.filter((edge) => !edge.back && !openRow.has(edge));
    const lowOf = (edge: GEdge): number => edge.source.host!.box.bottom;
    const fromEvents = forward.filter((edge) => edge.source.host).sort((first, second) => lowOf(second) - lowOf(first) || second.source.box.center.x - first.source.box.center.x);
    return [...forward.filter((edge) => !edge.source.host), ...fromEvents, ...openRow];
  }

  private loops(): GEdge[] {
    const span = (edge: GEdge): number => Math.abs(edge.source.box.center.x - edge.target.box.center.x);
    return this.layout.edges.filter((edge) => edge.back).sort((first, second) => span(first) - span(second));
  }

  private routeOf(edge: GEdge): Route {
    const { source, target, back } = edge;
    if (back) {
      return new LoopRoute(this.area, edge).route();
    }
    const sourceY = source.box.center.y;
    const targetY = target.box.center.y;
    if (!source.onTop && Math.abs(sourceY - targetY) < ChannelRouter.SAME_ROW) {
      return this.sameRow.of(edge);
    }
    return !source.onTop && targetY > sourceY ? new DownRoute(this.area, this.paths, edge).route() : new UpRoute(this.area, this.paths, edge).route();
  }

  private routeEdge(edge: GEdge): void {
    const { area } = this;
    const route = this.routeOf(edge);
    edge.points = new Polyline(route.points).rounded();
    edge.runsBelow = route.runsBelow;
    edge.runsAbove = route.runsAbove;
    area.record(edge, route.runsAbove);
    if (route.channel) {
      route.channel.list.take(route.channel.y, route.channel.x1, route.channel.x2);
    }
    edge.label = new FlowLabelSpot(edge).box();
    if (edge.label) {
      area.flowLabels.push(edge.label);
      area.flowLabelIndex.add(edge.label, edge.label.x, edge.label.right);
    }
  }

  private markTopsUsed(): void {
    const byTop = new Map<number, XIndex<GNode>>();
    for (const node of this.area.allNodes) {
      node.topUsed = false;
      const row = Math.floor(node.box.y);
      const nodes = byTop.get(row) ?? new XIndex<GNode>();
      nodes.add(node, node.box.x, node.box.right);
      byTop.set(row, nodes);
    }
    for (const edge of this.layout.edges) {
      for (const point of [edge.points[0], edge.points.at(-1)]) {
        if (point) {
          this.markTopAt(byTop, point);
        }
      }
    }
  }

  private markTopAt(byTop: ReadonlyMap<number, XIndex<GNode>>, point: Point): void {
    for (let row = Math.floor(point.y) - 1; row <= Math.floor(point.y) + 1; row++) {
      for (const node of byTop.get(row)?.near(point.x, point.x) ?? []) {
        if (Math.abs(point.y - node.box.y) < 1 && point.x >= node.box.x && point.x <= node.box.right) {
          node.topUsed = true;
        }
      }
    }
  }

  private highestDrawnY(): number {
    let highest = 0;
    for (const edge of this.layout.edges) {
      for (const point of edge.points) {
        highest = Math.min(highest, point.y);
      }
    }
    for (const edge of this.layout.edges) {
      if (edge.label) {
        highest = Math.min(highest, edge.label.y);
      }
    }
    return highest;
  }

  private moveBelowTop(): void {
    const { layout } = this;
    const highest = this.highestDrawnY();
    if (highest >= 0) {
      return;
    }
    const dy = -highest + ChannelRouter.CLEAR_OF_THE_TOP;
    for (const node of layout.nodes) {
      node.shift(0, dy);
    }
    for (const artifact of layout.routedArtifacts()) {
      artifact.box.y += dy;
    }
    for (const edge of layout.edges) {
      new Polyline(edge.points).translate(0, dy);
      edge.label?.translate(0, dy);
      if (edge.bandY !== undefined) {
        edge.bandY += dy;
      }
    }
    for (const compensation of layout.compensations) {
      new Polyline(compensation.points).translate(0, dy);
    }
    for (const band of layout.laneBands ?? []) {
      band.top += dy;
      band.bottom += dy;
    }
    layout.height += dy;
  }
}
