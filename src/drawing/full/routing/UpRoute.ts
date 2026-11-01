import { Point, Polyline, type Box } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GEdge } from '../scopes/GEdge.js';
import type { GNode } from '../scopes/GNode.js';
import { BoundaryWays } from './BoundaryWays.js';
import type { Channel } from './Channels.js';
import type { FlowPaths } from './FlowPaths.js';
import { RoutingArea, type Route } from './RoutingArea.js';

export type Way = { points: Point[]; x?: number | undefined; below?: boolean; top?: number | undefined; over?: Channel; spare?: Box };

export type WayMaker = { penalty?: number | undefined; make: () => Way | undefined };

type ScoredWay = Way & { score: number; faults: number };

export class UpRoute {
  private static readonly HIT = 1000;
  private static readonly CROSSING_OF_EVENT = 3;
  private static readonly RANK_STEP = 0.5;
  private static readonly LATE_RANK = 100;

  private readonly source: GNode;
  private readonly target: GNode;
  private readonly gapX: number;
  private best: ScoredWay | undefined;
  private faultsBelow: number | undefined;

  constructor(
    private readonly area: RoutingArea,
    private readonly paths: FlowPaths,
    edge: GEdge,
  ) {
    this.source = edge.source;
    this.target = edge.target;
    this.gapX = this.target.box.x - ShapeSizes.GAPS.hGap / 2;
  }

  route(): Route {
    const makers = [...this.eventWays(), ...this.plainWays()];
    makers.forEach((maker, rank) => this.measure(maker, rank));
    return this.take(this.best!);
  }

  private eventWays(): WayMaker[] {
    const { source } = this;
    if (!source.host) {
      return [];
    }
    const ways = new BoundaryWays(this.area, this.paths, source, this.target);
    return source.onTop ? ways.fromTopBorder() : ways.fromBottomBorder();
  }

  private late(rank: number): number | undefined {
    return this.source.host ? UpRoute.LATE_RANK + rank * UpRoute.RANK_STEP : undefined;
  }

  private plainWays(): WayMaker[] {
    const { source, target, gapX, paths } = this;
    const sourceBox = source.box;
    const targetBox = target.box;
    const center = sourceBox.center;
    const targetY = targetBox.center.y;
    const riseX = target.riseX();
    const leave = new Point(sourceBox.right, center.y);
    const ways: WayMaker[] = [
      { penalty: this.late(0), make: () => ({ points: [leave, new Point(riseX, center.y), new Point(riseX, targetBox.bottom)], x: riseX }) },
      { penalty: this.late(1), make: () => ({ points: [leave, ...paths.hookFromBelow(target, center.y)], x: riseX }) },
    ];
    if (targetBox.x >= sourceBox.right) {
      ways.push({ penalty: this.late(2), make: () => ({ points: [new Point(center.x, sourceBox.y), new Point(center.x, targetY), new Point(targetBox.x, targetY)] }) });
    }
    if (gapX > sourceBox.right) {
      ways.push({ penalty: this.late(3), make: () => ({ points: [leave, new Point(gapX, center.y), new Point(gapX, targetY), new Point(targetBox.x, targetY)] }) });
    }
    return ways;
  }

  private isBeaten(score: number): boolean {
    return !!this.best && score >= this.best.score;
  }

  private measure(maker: WayMaker, rank: number): void {
    const { source, target, area } = this;
    let score = maker.penalty ?? rank * UpRoute.RANK_STEP;
    const way = this.isBeaten(score) ? undefined : maker.make();
    if (!way) {
      return;
    }
    if (way.over) {
      this.faultsBelow ??= this.best?.faults ?? Number.POSITIVE_INFINITY;
    }
    const line = new Polyline(way.points);
    const hits = line.hitCount(area.boxes, [source.box, target.box]);
    score += hits * UpRoute.HIT;
    if (this.isBeaten(score)) {
      return;
    }
    const perCrossing = source.host ? UpRoute.CROSSING_OF_EVENT : 1;
    const crossings = RoutingArea.crossingsOf(way.points, area.routed, this.crossingLimit(score, perCrossing, way));
    if (way.over && crossings >= this.faultsBelow!) {
      return;
    }
    score += perCrossing * crossings;
    if (source.host && !this.isBeaten(score)) {
      score += UpRoute.CROSSING_OF_EVENT * (line.hitCount(area.spots, way.spare ? [way.spare] : []) + line.hitCount(area.flowLabelIndex, []));
    }
    if (!this.isBeaten(score)) {
      this.best = { ...way, score, faults: hits + crossings };
    }
  }

  private crossingLimit(score: number, perCrossing: number, way: Way): number {
    const beatsBest = this.best ? Math.ceil((this.best.score - score) / perCrossing) : Number.POSITIVE_INFINITY;
    return Math.min(beatsBest, way.over ? this.faultsBelow! : Number.POSITIVE_INFINITY);
  }

  private take(best: ScoredWay): Route {
    const { area, source, target } = this;
    if (best.x !== undefined) {
      area.usedBottom.take(target, best.x, false);
    }
    if (best.score >= UpRoute.HIT) {
      return { points: this.throughChannel() };
    }
    if (best.points[0]!.y === source.box.y) {
      area.usedTop.take(source, source.box.center.x, true);
    }
    if (!best.over) {
      return { points: best.points, runsBelow: best.below };
    }
    if (best.top !== undefined) {
      area.usedTop.take(target, best.top, false);
    }
    return { points: best.points, runsBelow: best.below, runsAbove: true, channel: { list: area.topChannels, y: best.over.y, x1: best.over.from, x2: best.over.to } };
  }

  private throughChannel(): Point[] {
    const { area, paths, source, target, gapX } = this;
    const base = area.spanBottom(source.layer, target.layer) + ShapeSizes.GAPS.loopGap;
    return paths.throughChannel(source, target, paths.channelFor(gapX, source.exitX, base));
  }
}
