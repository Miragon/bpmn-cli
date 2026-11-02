import { Point, Polyline } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GEdge } from '../scopes/GNode.js';
import type { FlowPaths } from './FlowPaths.js';
import type { Route, RoutingArea } from './RoutingArea.js';
import { RunHeights } from './RunHeights.js';

export class DownRoute {
  private readonly source;
  private readonly target;
  private readonly exitX: number;

  constructor(
    private readonly area: RoutingArea,
    private readonly paths: FlowPaths,
    edge: GEdge,
  ) {
    this.source = edge.source;
    this.target = edge.target;
    this.exitX = this.source.host ? this.source.box.center.x : this.source.exitX;
  }

  route(): Route {
    const { source, exitX } = this;
    const drop = this.dropFromBottom();
    const joinSide = source.entriesFromBelow().length ? this.besideJoin() : undefined;
    if (joinSide) {
      return { points: joinSide, runsBelow: undefined };
    }
    if (this.hits(drop)) {
      return this.aroundObstacle();
    }
    this.area.usedBottom.take(source.host ?? source, exitX, true);
    return { points: drop, runsBelow: undefined };
  }

  private hits(points: readonly Point[]): boolean {
    return new Polyline(points).hitsAny(this.area.boxes, [this.source.box, this.target.box]);
  }

  private dropFromBottom(): Point[] {
    const { exitX, source, target } = this;
    const targetY = target.box.center.y;
    return [new Point(exitX, source.box.bottom), new Point(exitX, targetY), new Point(target.box.x, targetY)];
  }

  private sideAt(dropX: number): Point[] {
    const { box } = this.source;
    const startY = box.center.y;
    const targetY = this.target.box.center.y;
    return [new Point(box.right, startY), new Point(dropX, startY), new Point(dropX, targetY), new Point(this.target.box.x, targetY)];
  }

  private besideJoin(): Point[] | undefined {
    const { hGap } = ShapeSizes.GAPS;
    return [hGap / 4, hGap / 2].map((offset) => this.sideAt(this.source.box.right + offset)).find((path) => !this.hits(path));
  }

  private aroundObstacle(): Route {
    const { source, target, area, exitX } = this;
    let points = this.sideAt(source.box.right + ShapeSizes.GAPS.hGap / 2);
    let runsBelow: boolean | undefined;
    const run = source.host ? this.runBelowHost() : undefined;
    if (run) {
      points = run;
      runsBelow = true;
    }
    if (this.hits(points)) {
      runsBelow = source.host && area.bandOf(source) === area.bandOf(target) ? true : undefined;
      points = this.throughChannel(exitX);
    }
    return { points, runsBelow };
  }

  private runBelowHost(): Point[] | undefined {
    const { source, target, area } = this;
    const { box } = source;
    const centerX = box.center.x;
    const targetY = target.box.center.y;
    const gapX = source.host!.box.right + ShapeSizes.GAPS.hGap / 2;
    const runY = new RunHeights(centerX, gapX, area.runArea(Math.min(centerX, gapX), Math.max(centerX, gapX))).below(box.bottom);
    const down = [new Point(centerX, box.bottom), new Point(centerX, runY), new Point(gapX, runY), new Point(gapX, targetY), new Point(target.box.x, targetY)];
    return runY < targetY && !this.hits(down) ? down : undefined;
  }

  private throughChannel(exitX: number): Point[] {
    const { source, target, area } = this;
    const fromLayer = source.host ? source.host.layer : source.layer;
    const base = area.spanBottom(fromLayer, target.layer) + ShapeSizes.GAPS.loopGap;
    const entryX = target.box.x - 20;
    const channelY = this.paths.channelFor(exitX, entryX, base);
    const targetY = target.box.center.y;
    return [new Point(exitX, source.box.bottom), new Point(exitX, channelY), new Point(entryX, channelY), new Point(entryX, targetY), new Point(target.box.x, targetY)];
  }
}
