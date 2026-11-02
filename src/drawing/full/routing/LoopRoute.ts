import { Point, Polyline } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GEdge, GNode, LaneBandInfo } from '../scopes/GNode.js';
import type { BorderSlots } from './BorderSlots.js';
import type { Channels } from './Channels.js';
import { RoutingArea, type Route } from './RoutingArea.js';

type BorderUse = { slots: BorderSlots; node: GNode; x: number };

type PathEnd = { points: Point[]; x?: number; penalty?: number };

type LoopWay = { points: Point[]; exit?: BorderUse | undefined; entry?: BorderUse | undefined; channel?: { list: Channels; y: number }; penalty: number; offDiamond?: boolean };

export class LoopRoute {
  private static readonly SLOT_TAKEN = 2;
  private static readonly HIT = 1000;
  private static readonly CROSSING = 3;
  private static readonly RANK_STEP = 0.001;
  private static readonly TOP_PENALTY = 0.5;
  private static readonly DIRECT_PENALTY = 0.25;
  private static readonly LEFT_VERTEX_PENALTY = 1.5;
  private static readonly HOOK_DEPTH = 15;
  private static readonly SELF_LOOP_DEPTH = 40;

  private readonly source: GNode;
  private readonly target: GNode;
  private readonly hostOrSource: GNode;
  private readonly x1: number;
  private readonly x2: number;
  private readonly columnGap = ShapeSizes.GAPS.hGap / 2;

  constructor(
    private readonly area: RoutingArea,
    edge: GEdge,
  ) {
    this.source = edge.source;
    this.target = edge.target;
    this.hostOrSource = edge.source.host ?? edge.source;
    this.x1 = this.target.box.x - this.columnGap;
    this.x2 = this.source.box.right + this.columnGap;
  }

  route(): Route {
    if (this.hostOrSource === this.target) {
      return { points: this.selfLoop() };
    }
    const band = this.area.bandOf(this.hostOrSource);
    const sameBand = band && band === this.area.bandOf(this.target) ? band : undefined;
    return this.take(this.pick([...this.waysBelow(sameBand), ...this.waysOverTop(sameBand), ...this.waysDirect()]));
  }

  private selfLoop(): Point[] {
    const { box } = this.source;
    const x1 = box.x + box.width * 0.7;
    const x2 = box.x + box.width * 0.3;
    const loopY = box.bottom + LoopRoute.SELF_LOOP_DEPTH;
    return [new Point(x1, box.bottom), new Point(x1, loopY), new Point(x2, loopY), new Point(x2, box.bottom)];
  }

  private sideExits(sideY: number, channelY: number): PathEnd[] {
    const { box } = this.source;
    const leftGap = box.x - this.columnGap;
    return [
      { points: [new Point(box.right, sideY), new Point(this.x2, sideY), new Point(this.x2, channelY)] },
      { points: [new Point(box.x, sideY), new Point(leftGap, sideY), new Point(leftGap, channelY)] },
    ];
  }

  private hooks(entryX: number, channelY: number, hookY: number, endY: number): PathEnd[] {
    const hookRight = this.target.box.right + this.columnGap;
    return [
      { points: [new Point(entryX, channelY), new Point(entryX, endY)], x: entryX },
      { points: [new Point(hookRight, channelY), new Point(hookRight, hookY), new Point(entryX, hookY), new Point(entryX, endY)], x: entryX },
      { points: [new Point(this.x1, channelY), new Point(this.x1, hookY), new Point(entryX, hookY), new Point(entryX, endY)], x: entryX },
    ];
  }

  private combine(exits: readonly PathEnd[], entries: readonly PathEnd[], slots: BorderSlots, channel: { list: Channels; y: number }, penalty?: number): LoopWay[] {
    return exits.flatMap((exit) =>
      entries.map((entry) => ({
        points: [...exit.points, ...entry.points],
        exit: exit.x !== undefined ? { slots, node: this.hostOrSource, x: exit.x } : undefined,
        entry: entry.x !== undefined ? { slots, node: this.target, x: entry.x } : undefined,
        channel,
        penalty: penalty ?? entry.penalty ?? 0,
        offDiamond: this.source.kind === 'gateway' && exit.x === undefined,
      })),
    );
  }

  private waysBelow(band: LaneBandInfo | undefined): LoopWay[] {
    const { area, source, target, x1, x2 } = this;
    const { loopGap } = ShapeSizes.GAPS;
    const channelY = area.channels.free(x1, x2, area.rangeBottom(x1, x2, band) + loopGap, loopGap / 2);
    const exitX = source.host ? source.box.center.x : source.exitX;
    const entryX = target.riseX();
    const exits = [{ points: [new Point(exitX, source.box.bottom), new Point(exitX, channelY)], x: exitX }, ...this.sideExits(source.box.y + source.box.height * 0.75, channelY)];
    const entries = this.hooks(entryX, channelY, target.box.bottom + LoopRoute.HOOK_DEPTH, target.box.bottom);
    if (target.kind === 'gateway' && !area.leftTaken.has(target)) {
      const targetY = target.box.center.y;
      entries.push({ points: [new Point(x1, channelY), new Point(x1, targetY), new Point(target.box.x, targetY)], penalty: LoopRoute.LEFT_VERTEX_PENALTY });
    }
    return this.combine(exits, entries, area.usedBottom, { list: area.channels, y: channelY });
  }

  private waysOverTop(band: LaneBandInfo | undefined): LoopWay[] {
    const { area, source, target, x1, x2 } = this;
    const { box } = source;
    const { loopGap } = ShapeSizes.GAPS;
    const topY = area.topChannels.free(x1, x2, area.rangeTop(x1, x2, band) - loopGap, -loopGap / 2);
    const centerX = box.center.x;
    const exits = [{ points: [new Point(centerX, box.y), new Point(centerX, topY)], x: centerX }, ...this.sideExits(box.y + box.height * 0.25, topY)];
    const entries = this.hooks(target.topX, topY, target.box.y - LoopRoute.HOOK_DEPTH, target.box.y);
    return this.combine(exits, entries, area.usedTop, { list: area.topChannels, y: topY }, LoopRoute.TOP_PENALTY);
  }

  private waysDirect(): LoopWay[] {
    const { source, target, area, hostOrSource } = this;
    const { box } = source;
    if (target.box.y <= box.bottom) {
      return [];
    }
    const exitX = source.host ? box.center.x : source.exitX;
    const topX = target.topX;
    const middleY = (box.bottom + target.box.y) / 2;
    const center = box.center;
    const sideX = topX < center.x ? box.x : box.right;
    const entry = { slots: area.usedTop, node: target, x: topX };
    return [
      { points: [new Point(exitX, box.bottom), new Point(exitX, middleY), new Point(topX, middleY), new Point(topX, target.box.y)], exit: { slots: area.usedBottom, node: hostOrSource, x: exitX }, entry, penalty: LoopRoute.DIRECT_PENALTY },
      { points: [new Point(sideX, center.y), new Point(topX, center.y), new Point(topX, target.box.y)], entry, penalty: LoopRoute.DIRECT_PENALTY },
    ];
  }

  private pick(ways: readonly LoopWay[]): LoopWay {
    let best = ways[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    ways.forEach((way, rank) => {
      const score = this.scoreOf(way, rank, bestScore);
      if (score < bestScore) {
        best = way;
        bestScore = score;
      }
    });
    return best;
  }

  private slotPenalty({ exit, entry, offDiamond }: LoopWay): number {
    const exitTaken = exit?.slots.taken(exit.node, exit.x) ? LoopRoute.SLOT_TAKEN : 0;
    const entryTaken = entry?.slots.taken(entry.node, entry.x, !offDiamond) ? LoopRoute.SLOT_TAKEN : 0;
    return exitTaken + entryTaken;
  }

  private scoreOf(way: LoopWay, rank: number, limit: number): number {
    const { area } = this;
    let score = way.penalty + rank * LoopRoute.RANK_STEP + this.slotPenalty(way);
    if (score >= limit) {
      return Number.POSITIVE_INFINITY;
    }
    score += new Polyline(way.points).hitCount(area.boxes, [this.source.box, this.target.box]) * LoopRoute.HIT;
    if (score >= limit) {
      return Number.POSITIVE_INFINITY;
    }
    score += RoutingArea.crossingsOf(way.points, area.routed, Math.ceil((limit - score) / LoopRoute.CROSSING)) * LoopRoute.CROSSING;
    if (area.overTop.size && score < limit && area.onRouted(way.points, area.overTop)) {
      score += LoopRoute.CROSSING;
    }
    return score;
  }

  private take({ points, exit, entry, channel }: LoopWay): Route {
    exit?.slots.take(exit.node, exit.x, true);
    entry?.slots.take(entry.node, entry.x, false);
    return { points, ...(channel ? { channel: { list: channel.list, y: channel.y, x1: this.x1, x2: this.x2 } } : {}) };
  }
}
