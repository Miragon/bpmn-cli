import { Point, Polyline, type Box } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { GNode, type LaneBandInfo } from '../scopes/GNode.js';
import type { Channel } from './Channels.js';
import type { FlowPaths } from './FlowPaths.js';
import type { RoutingArea } from './RoutingArea.js';
import { RunHeights } from './RunHeights.js';

export type Way = { points: Point[]; x?: number | undefined; below?: boolean; top?: number | undefined; over?: Channel; spare?: Box };

export type WayMaker = { penalty?: number | undefined; make: () => Way | undefined };

type OverEnd = { to: number; down: (runY: number) => Point[]; top?: number | undefined; penalty: number };

type RiseEnd = { to: number; up: (runY: number) => Point[]; penalty: number; x?: number | undefined };

export class BoundaryWays {
  private static readonly RISE_KEEP = 5;
  private static readonly SLOT_RANK = 0.1;
  private static readonly GAP_PENALTY = 0.5;
  private static readonly HOOK_PENALTY = 1;
  private static readonly DEEP_PENALTY = 1;
  private static readonly OVER_TOP_RANK = 2.5;
  private static readonly HOST_GAP_RANK = 0.2;
  private static readonly SIDE_END_RANK = 0.1;

  private readonly eventBox: Box;
  private readonly targetBox: Box;
  private readonly centerX: number;
  private readonly gapX: number;
  private readonly runs = new Map<number, number>();
  private area: Box[] = [];

  constructor(
    private readonly routing: RoutingArea,
    private readonly paths: FlowPaths,
    private readonly event: GNode,
    private readonly target: GNode,
  ) {
    this.eventBox = event.box;
    this.targetBox = target.box;
    this.centerX = event.box.center.x;
    this.gapX = target.box.x - ShapeSizes.GAPS.hGap / 2;
  }

  private static isWithin(box: Box, band: LaneBandInfo): boolean {
    return box.center.y >= band.top && box.center.y <= band.bottom;
  }

  fromTopBorder(): WayMaker[] {
    const { centerX, eventBox, targetBox } = this;
    const band = this.routing.bandOf(this.event);
    const ends = this.overEnds().filter((end) => end.top !== undefined || end.to - centerX >= GNode.RUN_CLEAR);
    const xs = ends.map((end) => end.to);
    this.area = this.routing.runArea(Math.min(centerX, ...xs), Math.max(centerX, ...xs));
    const topArea = this.inBand(band);
    const from = Math.min(targetBox.y, eventBox.y);
    return ends.map((end) => ({
      penalty: end.penalty,
      make: () => {
        const runY = new RunHeights(centerX, end.to, topArea).above(from);
        return this.overWay([new Point(centerX, eventBox.y), new Point(centerX, runY), ...end.down(runY)], runY, centerX, end);
      },
    }));
  }

  fromBottomBorder(): WayMaker[] {
    const host = this.event.host!;
    const { centerX, gapX, targetBox, routing } = this;
    const { hGap } = ShapeSizes.GAPS;
    const band = routing.bandOf(this.event);
    const slots = this.target.riseSlots().filter((slotX) => Math.abs(slotX - centerX) >= GNode.RUN_CLEAR);
    const hookX = targetBox.right + hGap / 2;
    const hostGaps = [host.box.right + hGap / 4, host.box.x - (hGap * 3) / 4];
    const xs = [centerX, gapX, hookX, ...slots, ...hostGaps];
    this.area = routing.runArea(Math.min(...xs), Math.max(...xs));
    const ways = this.riseEnds(slots, hookX).flatMap((end) => this.waysBelow(end, band));
    return !band || band === routing.bandOf(this.target) ? [...ways, ...this.waysOverHost(hostGaps, band)] : ways;
  }

  private inBand(band: LaneBandInfo | undefined): Box[] {
    return band ? this.area.filter((box) => BoundaryWays.isWithin(box, band)) : this.area;
  }

  private runTo(to: number): number {
    let runY = this.runs.get(to);
    if (runY === undefined) {
      runY = new RunHeights(this.centerX, to, this.area).below(this.eventBox.bottom);
      this.runs.set(to, runY);
    }
    return runY;
  }

  private isClearRise(slotX: number): boolean {
    const { targetBox } = this;
    const keep = BoundaryWays.RISE_KEEP;
    const runY = this.runTo(slotX);
    return !this.routing.boxes.near(slotX - keep, slotX + keep).some((box) => box !== targetBox && box.x - keep < slotX && slotX < box.right + keep && box.y < runY && box.bottom > targetBox.bottom);
  }

  private riseEnds(slots: readonly number[], hookX: number): RiseEnd[] {
    const { centerX, gapX, target, targetBox, paths, routing } = this;
    const free = slots.filter((slotX) => this.isClearRise(slotX) && !routing.usedBottom.taken(target, slotX, true));
    const rises = free.length ? free : slots.filter((slotX) => this.isClearRise(slotX)).slice(0, 1);
    const risings = (rises.length ? rises : slots.slice(0, 1)).map((slotX, rank) => ({
      to: slotX,
      up: (runY: number): Point[] => [new Point(slotX, runY), new Point(slotX, targetBox.bottom)],
      penalty: rank * BoundaryWays.SLOT_RANK,
      x: slotX,
    }));
    const targetY = targetBox.center.y;
    const intoSide = { to: gapX, up: (runY: number): Point[] => [new Point(gapX, runY), new Point(gapX, targetY), new Point(targetBox.x, targetY)], penalty: BoundaryWays.GAP_PENALTY };
    const hook = { to: hookX, up: (runY: number): Point[] => paths.hookFromBelow(target, runY), penalty: BoundaryWays.HOOK_PENALTY, x: target.riseX() };
    return [...risings, ...(gapX - centerX >= GNode.RUN_CLEAR ? [intoSide] : []), hook];
  }

  private waysBelow({ to, up, penalty, x }: RiseEnd, band: LaneBandInfo | undefined): WayMaker[] {
    const { centerX, eventBox, routing } = this;
    const way = (runY: number): Way => ({ points: [new Point(centerX, eventBox.bottom), new Point(centerX, runY), ...up(runY)], ...(x !== undefined ? { x } : {}), below: true });
    const deepWay = (): Way | undefined => {
      const near = this.runTo(to);
      const floor = Math.max(near, routing.rangeBottom(centerX, to, band) + ShapeSizes.GAPS.loopGap) - GNode.RUN_CLEAR;
      const deep = new RunHeights(centerX, to, this.area).below(floor);
      return deep > near ? way(deep) : undefined;
    };
    return [
      { penalty, make: () => way(this.runTo(to)) },
      { penalty: penalty + BoundaryWays.DEEP_PENALTY, make: deepWay },
    ];
  }

  private waysOverHost(hostGaps: readonly number[], band: LaneBandInfo | undefined): WayMaker[] {
    const host = this.event.host!;
    const topArea = this.inBand(band);
    const from = Math.min(this.targetBox.y, host.box.y);
    const ends = this.overEnds();
    return hostGaps.flatMap((gapX, rank) => (this.canLeaveThrough(gapX) ? ends.filter((end) => end.top !== undefined || this.gapX - gapX >= GNode.RUN_CLEAR).map((end) => this.overHost(gapX, rank, end, topArea, from)) : []));
  }

  private canLeaveThrough(gapX: number): boolean {
    const { centerX, event } = this;
    if (gapX < 0 || Math.abs(gapX - centerX) < GNode.RUN_CLEAR) {
      return false;
    }
    const low = Math.min(gapX, centerX);
    const high = Math.max(gapX, centerX);
    const passesEvent = (other: GNode): boolean => other !== event && !other.onTop && low < other.box.center.x && other.box.center.x < high;
    return !event.host!.boundary.some(passesEvent);
  }

  private overHost(gapX: number, rank: number, end: OverEnd, topArea: readonly Box[], from: number): WayMaker {
    const { centerX, eventBox } = this;
    return {
      penalty: BoundaryWays.OVER_TOP_RANK + rank * BoundaryWays.HOST_GAP_RANK + end.penalty,
      make: () => {
        const low = this.runTo(gapX);
        const runY = new RunHeights(gapX, end.to, topArea).above(from);
        return this.overWay([new Point(centerX, eventBox.bottom), new Point(centerX, low), new Point(gapX, low), new Point(gapX, runY), ...end.down(runY)], runY, gapX, end, true);
      },
    };
  }

  private overEnds(): OverEnd[] {
    const { target, targetBox, gapX, routing } = this;
    const topX = target.topX;
    const targetY = targetBox.center.y;
    const endsOnSide = (point: Point): boolean => Math.abs(point.x - targetBox.x) < 1 && point.y > targetBox.y && point.y < targetBox.bottom;
    const sideFree = !routing.routed.near(targetBox.x - 1, targetBox.x + 1).some(({ start, end }) => endsOnSide(start) || endsOnSide(end));
    return [
      ...(routing.usedTop.taken(target, topX, true) ? [] : [{ to: topX, down: (runY: number): Point[] => [new Point(topX, runY), new Point(topX, targetBox.y)], top: topX, penalty: 0 }]),
      ...(sideFree ? [{ to: gapX, down: (runY: number): Point[] => [new Point(gapX, runY), new Point(gapX, targetY), new Point(targetBox.x, targetY)], penalty: BoundaryWays.SIDE_END_RANK }] : []),
    ];
  }

  private overWay(points: Point[], runY: number, x1: number, end: OverEnd, below?: boolean): Way | undefined {
    const { routing, target, eventBox, targetBox } = this;
    if (new Polyline(points).hitsAny(routing.boxes, [eventBox, targetBox]) || routing.onRouted(points)) {
      return undefined;
    }
    const spare = end.top !== undefined ? routing.gatewaySpots.get(target) : undefined;
    return { points, ...(below ? { below } : {}), over: { y: runY, from: Math.min(x1, end.to), to: Math.max(x1, end.to) }, ...(end.top !== undefined ? { top: end.top } : {}), ...(spare ? { spare } : {}) };
  }
}
