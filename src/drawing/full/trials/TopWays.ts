import { Box, Polyline, type Point, type Segment } from '../../../model/index.js';
import { LinkRouter } from '../links/LinkRouter.js';
import { Semantics } from '../../plane/Semantics.js';
import { RoutingArea } from '../routing/RoutingArea.js';
import type { GEdge, GNode, ScopeLayout } from '../scopes/GNode.js';
import { Scope } from '../scopes/Scope.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { XIndex } from '../scopes/XIndex.js';

export interface TopWay {
  length: number;
  bends: number;
  up: boolean;
  clearOfLines: boolean;
  labelClear: boolean;
  worth: boolean;
}

interface Drawn {
  lines: Array<{ edge: GEdge | undefined; segments: Segment[] }>;
  shapes: Box[];
  labels: Box[];
  flowLabels: Box[];
}

export class TopWays {
  private static readonly LABEL_KEEP = 2;
  private static readonly DETOUR_POINTS = 5;

  readonly ways = new Map<GNode, TopWay>();
  linkCrossings = 0;

  constructor(
    private readonly layout: ScopeLayout,
    private readonly events: readonly GNode[],
  ) {}

  static crossingPairs(lines: ReadonlyArray<readonly Point[]>, otherLines: ReadonlyArray<readonly Point[]>): number {
    const index = new XIndex<[Segment, number]>();
    otherLines.forEach((points, lineIndex) => {
      for (const segment of new Polyline(points).segments()) {
        const [low, high] = RoutingArea.xSpan(segment);
        index.add([segment, lineIndex], low, high);
      }
    });
    let count = 0;
    for (const points of lines) {
      const met = new Set<number>();
      for (const segment of new Polyline(points).segments()) {
        const [low, high] = RoutingArea.xSpan(segment);
        index.each(low, high, ([other, lineIndex]) => {
          if (!met.has(lineIndex) && segment.crosses(other)) {
            met.add(lineIndex);
          }
        });
      }
      count += met.size;
    }
    return count;
  }

  private static measure(event: GNode): Pick<TopWay, 'length' | 'bends'> {
    let length = 0;
    let bends = 0;
    for (const { points } of event.out) {
      for (const { start, end } of new Polyline(points).segments()) {
        length += Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
      }
      bends += Math.max(0, points.length - 2);
    }
    return { length, bends };
  }

  private static isLabelClear(event: GNode, label: Box | undefined, { lines, shapes, labels, flowLabels }: Drawn): boolean {
    if (!label) {
      return true;
    }
    const keep = TopWays.LABEL_KEEP;
    return (
      !shapes.some((shape) => shape !== event.box && shape.overlaps(label, keep)) &&
      !labels.some((other) => !Box.same(other, label, 0) && other.overlaps(label, keep)) &&
      !flowLabels.some((flowLabel) => flowLabel.overlaps(label, keep)) &&
      !lines.some(({ segments }) => segments.some((segment) => segment.hitsBounds(label)))
    );
  }

  private static onTopWay(event: GNode, drawn: Drawn): TopWay {
    const mine = new Set(event.out);
    return {
      ...TopWays.measure(event),
      up: event.out.every((edge) => edge.runsAbove && edge.points.length > 1 && edge.points[1]!.y < edge.points[0]!.y),
      clearOfLines: !drawn.lines.some(({ edge, segments }) => (!edge || !mine.has(edge)) && segments.some((segment) => segment.hitsBounds(event.box))),
      labelClear: TopWays.isLabelClear(event, ScopeLabels.of(event, 'boundary'), drawn),
      worth: false,
    };
  }

  look(): void {
    new LinkRouter(this.layout).route();
    const drawn = this.drawn();
    for (const event of this.events) {
      this.ways.set(event, event.onTop ? TopWays.onTopWay(event, drawn) : this.bottomWay(event, drawn));
    }
  }

  private drawn(): Drawn {
    const { layout } = this;
    const scope = new Scope(layout);
    const artifactLinks = scope.routedArtifacts().flatMap((artifact) => artifact.links);
    const compensations = layout.compensations.map((compensation) => compensation.points);
    this.linkCrossings = TopWays.crossingPairs(
      layout.edges.map((edge) => edge.points),
      [...compensations, ...artifactLinks.filter((link) => !Semantics.isAnnotationLine(link.el)).map((link) => link.points)],
    );
    const flows = layout.edges.map((edge) => ({ edge, segments: new Polyline(edge.points).segments() }));
    const links = [...compensations, ...artifactLinks.map((link) => link.points)].map((points) => ({ edge: undefined, segments: new Polyline(points).segments() }));
    const shapes = [...layout.nodes.flatMap((node) => [node.box, ...node.boundary.map((event) => event.box)]), ...scope.routedArtifacts().map((artifact) => artifact.box)];
    const labels = new ScopeLabels(layout);
    return { lines: [...flows, ...links], shapes, labels: [...labels.shapes(), ...labels.data()], flowLabels: layout.edges.flatMap((edge) => edge.label ?? []) };
  }

  private bottomWay(event: GNode, { labels }: Drawn): TopWay {
    const worth = event.out.some((edge) => edge.runsAbove || edge.points.length >= TopWays.DETOUR_POINTS) || this.hasFaultyFlow(event.out, labels);
    return { ...TopWays.measure(event), up: false, clearOfLines: false, labelClear: false, worth };
  }

  private hasFaultyFlow(flows: readonly GEdge[], labels: readonly Box[]): boolean {
    const { layout } = this;
    const boxes = new Scope(layout).obstacles();
    const cuts = (flow: GEdge): boolean => new Polyline(flow.points).hitCount(boxes, [flow.source.box, flow.target.box, ...(flow.source.host ? [flow.source.host.box] : [])]) > 0;
    const crosses = (flow: GEdge): boolean => TopWays.crossingPairs([flow.points], layout.edges.filter((other) => other !== flow).map((other) => other.points)) > 0;
    const onLabel = (flow: GEdge): boolean => labels.some((label) => new Polyline(flow.points).segments().some((segment) => segment.hitsBounds(label)));
    return flows.some((flow) => cuts(flow) || crosses(flow) || onLabel(flow));
  }
}
