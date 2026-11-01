import { Box, Point, Polyline, type Segment } from '../../../model/index.js';
import { DrawnEdge } from '../../../scoring/index.js';
import type { GEdge, GNode, LaneBandInfo, ScopeLayout } from '../scopes/GNode.js';
import { Scope } from '../scopes/Scope.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { XIndex } from '../scopes/XIndex.js';
import { BorderSlots } from './BorderSlots.js';
import { Channels } from './Channels.js';

type ChosenChannel = { list: Channels; y: number; x1: number; x2: number };

export type Route = { points: Point[]; channel?: ChosenChannel | undefined; runsBelow?: boolean | undefined; runsAbove?: boolean | undefined };

export class RoutingArea {
  private static readonly SAME_ROW = 1;

  readonly obstacles: Box[];
  readonly boxes: XIndex<Box>;
  readonly channels = new Channels();
  readonly topChannels = new Channels();
  readonly routed = new XIndex<Segment>();
  readonly usedBottom = new BorderSlots();
  readonly usedTop = new BorderSlots();
  readonly gatewaySpots = new Map<GNode, Box>();
  readonly spots: XIndex<Box>;
  readonly openRow: Set<GEdge>;
  readonly flowLabels: Box[] = [];
  readonly flowLabelIndex = new XIndex<Box>();
  readonly leftTaken = new Set<GNode>();
  readonly overTop = new XIndex<Segment>();
  readonly flowSegments: Segment[][] = [];
  readonly firstIds: number[] = [];
  readonly allNodes: GNode[];
  private readonly labelsBelow: XIndex<Box>;
  private readonly labelsAbove: XIndex<Box>;

  constructor(readonly layout: ScopeLayout) {
    const scope = new Scope(layout);
    this.obstacles = scope.obstacles();
    this.boxes = RoutingArea.indexOf(this.obstacles);
    this.allNodes = [...layout.nodes, ...layout.nodes.flatMap((node) => node.boundary)];
    const { below, above } = RoutingArea.eventLabels(layout);
    this.labelsBelow = RoutingArea.indexOf(below);
    this.labelsAbove = RoutingArea.indexOf(above);
    for (const node of layout.nodes) {
      const label = node.kind === 'gateway' ? ScopeLabels.of(node, 'gateway') : undefined;
      if (label) {
        this.gatewaySpots.set(node, label);
      }
    }
    const dataLabels = scope.routedArtifacts().flatMap((artifact) => (artifact.kind === 'annotation' ? [] : (ScopeLabels.of(artifact, 'data') ?? [])));
    const labelSpots = [...below, ...above, ...this.gatewaySpots.values(), ...dataLabels];
    this.spots = RoutingArea.indexOf(labelSpots);
    this.openRow = new Set(layout.edges.filter((edge) => this.isOpenRow(edge, labelSpots)));
  }

  static crossingsOf(points: readonly Point[], routed: readonly Segment[] | XIndex<Segment>, stop = Number.POSITIVE_INFINITY): number {
    let crossings = 0;
    for (const segment of new Polyline(points).segments()) {
      const count = (other: Segment): boolean => segment.crosses(other) && ++crossings >= stop;
      const [low, high] = RoutingArea.xSpan(segment);
      if (routed instanceof XIndex ? routed.each(low, high, count) : routed.some(count)) {
        break;
      }
    }
    return crossings;
  }

  static straightLine({ source, target }: GEdge): Point[] {
    const lineY = Math.round((source.box.center.y + target.box.center.y) / 2);
    return [new Point(source.box.right, lineY), new Point(target.box.x, lineY)];
  }

  static xSpan({ start, end }: Segment): [number, number] {
    return start.x < end.x ? [start.x, end.x] : [end.x, start.x];
  }

  private static indexOf(boxes: readonly Box[]): XIndex<Box> {
    const index = new XIndex<Box>();
    for (const box of boxes) {
      index.add(box, box.x, box.right);
    }
    return index;
  }

  private static eventLabels(layout: ScopeLayout): { below: Box[]; above: Box[] } {
    const below: Box[] = [];
    const above: Box[] = [];
    for (const node of layout.nodes) {
      const label = node.isEvent ? ScopeLabels.of(node, 'event') : undefined;
      if (label) {
        below.push(label);
      }
      for (const boundaryEvent of node.boundary) {
        const boundaryLabel = ScopeLabels.of(boundaryEvent, 'boundary');
        if (boundaryLabel) {
          (boundaryEvent.onTop ? above : below).push(boundaryLabel);
        }
      }
    }
    return { below, above };
  }

  private static touchesLine({ start: from, end: to }: Segment, start: Point, end: Point): boolean {
    const reachesLine = Math.min(from.y, to.y) <= start.y && Math.max(from.y, to.y) >= start.y && Math.min(from.x, to.x) <= end.x && Math.max(from.x, to.x) >= start.x;
    return reachesLine && (from.y === to.y || from.x === start.x || from.x === end.x);
  }

  private static withinBand(y: number, band: LaneBandInfo | undefined): boolean {
    return !band || (y >= band.top && y <= band.bottom);
  }

  bandOf(node: GNode): LaneBandInfo | undefined {
    return this.layout.laneBands?.find((band) => band.nodes.has(node.host ?? node));
  }

  spanBottom(fromLayer: number, toLayer: number): number {
    let lowest = 0;
    for (const node of this.allNodes) {
      const layer = node.host ? node.host.layer : node.layer;
      if (layer >= fromLayer && layer <= toLayer) {
        lowest = Math.max(lowest, node.box.bottom);
      }
    }
    return lowest;
  }

  rangeTop(x1: number, x2: number, band?: LaneBandInfo): number {
    const low = Math.min(x1, x2);
    const high = Math.max(x1, x2);
    let top = Number.POSITIVE_INFINITY;
    for (const box of this.boxes.near(low, high)) {
      if (box.x <= high && box.right >= low && RoutingArea.withinBand(box.center.y, band)) {
        top = Math.min(top, box.y);
      }
    }
    for (const label of this.labelsAbove.near(low, high)) {
      if (label.x <= high && label.right >= low && RoutingArea.withinBand(label.bottom, band)) {
        top = Math.min(top, label.y);
      }
    }
    for (const { start, end } of this.routedAcross(low, high, band)) {
      top = Math.min(top, start.y, end.y);
    }
    return top === Number.POSITIVE_INFINITY ? 0 : top;
  }

  rangeBottom(x1: number, x2: number, band?: LaneBandInfo): number {
    const low = Math.min(x1, x2);
    const high = Math.max(x1, x2);
    let lowest = 0;
    for (const box of this.boxes.near(low, high)) {
      if (box.x <= high && box.right >= low && RoutingArea.withinBand(box.center.y, band)) {
        lowest = Math.max(lowest, box.bottom);
      }
    }
    for (const label of this.labelsBelow.near(low, high)) {
      if (label.x <= high && label.right >= low && RoutingArea.withinBand(label.y, band)) {
        lowest = Math.max(lowest, label.bottom);
      }
    }
    for (const { start, end } of this.routedAcross(low, high, band)) {
      lowest = Math.max(lowest, start.y, end.y);
    }
    return lowest;
  }

  runArea(low: number, high: number): Box[] {
    const horizontalRuns = this.routed.near(low, high).flatMap(({ start, end }): Box[] => (start.y === end.y ? [new Box(Math.min(start.x, end.x), start.y, Math.abs(end.x - start.x), 0)] : []));
    return [...this.boxes.near(low, high), ...this.spots.near(low, high), ...this.flowLabelIndex.near(low, high), ...horizontalRuns];
  }

  lineFree(line: readonly Point[]): boolean {
    const [start, end] = line as [Point, Point];
    const isOn = (segment: Segment): boolean => RoutingArea.touchesLine(segment, start, end);
    return !this.routed.near(Math.min(start.x, end.x), Math.max(start.x, end.x)).some(isOn) && !new Polyline(line).hitsAny(this.flowLabels, []);
  }

  onRouted(points: readonly Point[], lines: XIndex<Segment> = this.routed): boolean {
    const rounded = points.map((point) => new Point(Math.round(point.x), Math.round(point.y)));
    return new Polyline(rounded).segments().some((segment) => {
      const [low, high] = RoutingArea.xSpan(segment);
      return lines.each(low, high, (other) => DrawnEdge.collinearLength(segment, other) > 0);
    });
  }

  record(edge: GEdge, runsAbove: boolean | undefined): void {
    const segments = new Polyline(edge.points).segments();
    this.firstIds.push(this.routed.size);
    this.flowSegments.push(segments);
    this.addSegments(this.routed, segments);
    if (runsAbove) {
      this.addSegments(this.overTop, segments);
    }
  }

  private isOpenRow(edge: GEdge, labelSpots: readonly Box[]): boolean {
    const { source, target } = edge;
    return !edge.back && edge.bandY !== undefined && Math.abs(source.box.center.y - target.box.center.y) < RoutingArea.SAME_ROW && !new Polyline(RoutingArea.straightLine(edge)).hitsAny([...this.obstacles, ...labelSpots], [source.box, target.box]);
  }

  private routedAcross(low: number, high: number, band: LaneBandInfo | undefined): Segment[] {
    return this.routed.near(low, high).filter(({ start, end }) => Math.max(start.x, end.x) >= low && Math.min(start.x, end.x) <= high && RoutingArea.withinBand(start.y, band) && RoutingArea.withinBand(end.y, band));
  }

  private addSegments(index: XIndex<Segment>, segments: readonly Segment[]): void {
    for (const segment of segments) {
      const [low, high] = RoutingArea.xSpan(segment);
      index.add(segment, low, high);
    }
  }
}
