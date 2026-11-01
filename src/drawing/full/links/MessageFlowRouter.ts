import { Box, Point, Polyline, type BpmnElement } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { MessageLegs, type Leg, type MessageEnd, type MessagePool } from './MessageLegs.js';

export interface MessageFlowJob {
  el: BpmnElement;
  source: BpmnElement;
  target: BpmnElement;
  sourceBox: Box;
  targetBox: Box;
  sourceOwn: Box[];
  targetOwn: Box[];
  sourcePool?: MessagePool | undefined;
  targetPool?: MessagePool | undefined;
}

export interface MessageRoute {
  el: BpmnElement;
  points: Point[];
  channelY?: number;
}

interface Plan {
  job: MessageFlowJob;
  sourceLeg: Leg;
  targetLeg: Leg;
  sx: number;
  tx: number;
  gaps: number[];
  outside: boolean;
  down: boolean;
}

interface GapRange {
  top: number;
  bottom: number;
}

interface EndCost {
  up: number;
  down: number;
}

interface FlowCost {
  sourcePool: MessagePool;
  targetPool: MessagePool;
  source: EndCost;
  target: EndCost;
}

export class MessageFlowRouter {
  private static readonly SKIP = 2;
  private static readonly MAX_PERMUTED = 6;
  private static readonly MAX_TRIED_CHANNELS = 5;
  private static readonly OUTSIDE_MARGIN = 30;
  private static readonly OUTSIDE_STEP = 25;
  private static readonly LABEL_WIDTH = 90;
  private static readonly LABEL_CHAR = 7;
  private static readonly LABEL_LINE = 14;
  private static readonly POOL_DOCK_INSET = 40;

  private readonly legs = new MessageLegs();

  constructor(
    private readonly jobs: readonly MessageFlowJob[],
    private readonly pools: readonly MessagePool[],
  ) {}

  static label(points: readonly Point[], name: string, channelY?: number): Box {
    const { LABEL_WIDTH, LABEL_CHAR, LABEL_LINE } = MessageFlowRouter;
    const width = Math.min(LABEL_WIDTH, name.length * LABEL_CHAR + 4);
    const height = LABEL_LINE * Math.max(1, Math.ceil((name.length * LABEL_CHAR) / LABEL_WIDTH));
    const channelStart = channelY === undefined ? -1 : points.findIndex((point, index) => index + 1 < points.length && point.y === channelY && points[index + 1]!.y === channelY);
    const [first, second] = MessageFlowRouter.labelledLeg(points, channelStart);
    if (first!.y === second!.y) {
      return new Box(Math.min(first!.x, second!.x) + 8, first!.y - height - 4, width, height);
    }
    const [start, next] = [points[0]!, points[1]!];
    const centerY = channelY !== undefined && points.length === 2 ? channelY : (start.y + next.y) / 2;
    return new Box(start.x + 6, centerY - height / 2, width, height);
  }

  private static labelledLeg(points: readonly Point[], channelStart: number): readonly Point[] {
    if (channelStart >= 0) {
      return [points[channelStart]!, points[channelStart + 1]!];
    }
    return points.length >= 3 ? [points[1]!, points[2]!] : [points[0]!, points[1]!];
  }

  private static permutations<TItem>(list: readonly TItem[]): TItem[][] {
    if (list.length <= 1) {
      return [[...list]];
    }
    return list.flatMap((item, index) => MessageFlowRouter.permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [item, ...rest]));
  }

  private static gapPolyline(sx: number, tx: number, channelY: number, above: number, below: number): Point[] {
    return [new Point(sx, above), new Point(sx, channelY), new Point(tx, channelY), new Point(tx, below)];
  }

  private static crossingsAmong(lines: ReadonlyArray<readonly Point[]>): number {
    const segments = lines.map((line) => new Polyline(line).segments());
    let count = 0;
    segments.forEach((line, index) => {
      for (const other of segments.slice(index + 1)) {
        for (const segment of line) {
          count += other.filter((otherSegment) => segment.crosses(otherSegment)).length;
        }
      }
    });
    return count;
  }

  private static level(range: GapRange, index: number, count: number): number {
    return Math.round(range.top + ((index + 1) * (range.bottom - range.top)) / (count + 1));
  }

  private static channelCrossings(order: readonly Plan[], range: GapRange): number {
    const lines = order.map((plan, index) => {
      const [above, below] = plan.down ? [range.top - 1, range.bottom + 1] : [range.bottom + 1, range.top - 1];
      return MessageFlowRouter.gapPolyline(plan.sx, plan.tx, MessageFlowRouter.level(range, index, order.length), above, below);
    });
    return MessageFlowRouter.crossingsAmong(lines);
  }

  private static bestChannelOrder(list: readonly Plan[], range: GapRange): readonly Plan[] {
    let best = list;
    let bestCount = MessageFlowRouter.channelCrossings(list, range);
    const permute = (rest: readonly Plan[], chosen: readonly Plan[]): void => {
      if (bestCount === 0) {
        return;
      }
      if (rest.length) {
        rest.forEach((item, index) => permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...chosen, item]));
        return;
      }
      const count = MessageFlowRouter.channelCrossings(chosen, range);
      if (count < bestCount) {
        bestCount = count;
        best = chosen;
      }
    };
    permute(list, []);
    return best;
  }

  private static dockLeg(box: Box, otherX: number, up: boolean): Leg {
    const { POOL_DOCK_INSET } = MessageFlowRouter;
    const x = Math.round(Math.min(Math.max(otherX, box.x + POOL_DOCK_INSET), box.right - POOL_DOCK_INSET));
    return { points: [new Point(x, up ? box.y : box.bottom)], x };
  }

  poolOrder(): readonly MessagePool[] {
    const { pools, jobs } = this;
    if (pools.length < 2 || pools.length > MessageFlowRouter.MAX_PERMUTED || !jobs.length) {
      return pools;
    }
    const flows = this.flowCosts();
    if (!flows.length) {
      return pools;
    }
    let best = pools;
    let bestCost = this.orderCost(pools, flows);
    for (const order of MessageFlowRouter.permutations(pools)) {
      if (bestCost === 0) {
        break;
      }
      const cost = this.orderCost(order, flows);
      if (cost < bestCost) {
        best = order;
        bestCost = cost;
      }
    }
    return best;
  }

  route(): MessageRoute[] {
    const plans = this.jobs.map((job) => this.planOf(job));
    const channels = this.channelsOf(plans);
    const rightEdge = Math.max(0, ...this.pools.map((pool) => pool.box.right));
    return plans.map((plan, index) => this.routeOf(plan, index, channels, rightEdge));
  }

  private endCost(end: MessageEnd): EndCost {
    const inside = end.element.is('bpmn:Participant') ? undefined : end.pool;
    return { up: this.legs.straightHits(end, inside, true), down: this.legs.straightHits(end, inside, false) };
  }

  private flowCosts(): FlowCost[] {
    return this.jobs
      .filter((job) => job.sourcePool && job.targetPool && job.sourcePool !== job.targetPool)
      .map((job) => ({ sourcePool: job.sourcePool!, targetPool: job.targetPool!, source: this.endCost(this.sourceEnd(job)), target: this.endCost(this.targetEnd(job)) }));
  }

  private orderCost(order: readonly MessagePool[], flows: readonly FlowCost[]): number {
    let total = 0;
    for (const { sourcePool, targetPool, source, target } of flows) {
      const [sourceIndex, targetIndex] = [order.indexOf(sourcePool), order.indexOf(targetPool)];
      const down = sourceIndex < targetIndex;
      total += (down ? source.down : source.up) + (down ? target.up : target.down);
      total += MessageFlowRouter.SKIP * Math.max(0, Math.abs(sourceIndex - targetIndex) - 1);
    }
    return total;
  }

  private sourceEnd(job: MessageFlowJob): MessageEnd {
    return { box: job.sourceBox, own: job.sourceOwn, element: job.source, pool: job.sourcePool };
  }

  private targetEnd(job: MessageFlowJob): MessageEnd {
    return { box: job.targetBox, own: job.targetOwn, element: job.target, pool: job.targetPool };
  }

  private gapRange(gapIndex: number): GapRange {
    const { POOL_GAP } = ShapeSizes;
    const upper = this.pools[gapIndex];
    const lower = this.pools[gapIndex + 1];
    return { top: upper ? upper.box.bottom : (lower?.box.y ?? 0) - POOL_GAP, bottom: lower ? lower.box.y : (upper?.box.bottom ?? 0) + POOL_GAP };
  }

  private channelsOf(plans: readonly Plan[]): Map<string, number> {
    const byGap = new Map<number, Plan[]>();
    for (const plan of plans) {
      for (const gap of new Set(plan.gaps)) {
        byGap.set(gap, [...(byGap.get(gap) ?? []), plan]);
      }
    }
    const channels = new Map<string, number>();
    for (const [gap, list] of byGap) {
      const range = this.gapRange(gap);
      const sorted = [...list].sort((left, right) => Math.min(left.sx, left.tx) - Math.min(right.sx, right.tx));
      const order = sorted.length <= MessageFlowRouter.MAX_TRIED_CHANNELS ? MessageFlowRouter.bestChannelOrder(sorted, range) : sorted;
      order.forEach((plan, index) => channels.set(`${gap}|${plans.indexOf(plan)}`, MessageFlowRouter.level(range, index, order.length)));
    }
    return channels;
  }

  private routeOf(plan: Plan, index: number, channels: ReadonlyMap<string, number>, rightEdge: number): MessageRoute {
    const { job, sourceLeg, targetLeg } = plan;
    const lead = sourceLeg.points;
    const tail = [...targetLeg.points].reverse();
    const sy = lead.at(-1)!.y;
    const ty = tail[0]!.y;
    const { middle, channelY } = plan.outside ? this.outsideMiddle(plan, index, channels, rightEdge, sy, ty) : this.gapMiddle(plan, index, channels, sy, ty);
    return { el: job.el, points: new Polyline(new Polyline([...lead, ...middle, ...tail]).rounded()).simplified(), ...(channelY !== undefined ? { channelY } : {}) };
  }

  private gapMiddle({ gaps, sx, tx }: Plan, index: number, channels: ReadonlyMap<string, number>, sy: number, ty: number): { middle: Point[]; channelY: number } {
    const channelHeight = channels.get(`${gaps[0]}|${index}`) ?? Math.round((sy + ty) / 2);
    const middle = Math.abs(sx - tx) < 1 ? [] : [new Point(sx, channelHeight), new Point(tx, channelHeight)];
    const range = this.gapRange(gaps[0]!);
    return { middle, channelY: middle.length ? channelHeight : Math.round((range.top + range.bottom) / 2) };
  }

  private outsideMiddle({ gaps, sx, tx }: Plan, index: number, channels: ReadonlyMap<string, number>, rightEdge: number, sy: number, ty: number): { middle: Point[]; channelY: number } {
    const outX = Math.round(rightEdge + MessageFlowRouter.OUTSIDE_MARGIN + index * MessageFlowRouter.OUTSIDE_STEP);
    const firstY = channels.get(`${gaps[0]}|${index}`) ?? sy;
    const secondY = channels.get(`${gaps[1]}|${index}`) ?? ty;
    return { middle: [new Point(sx, firstY), new Point(outX, firstY), new Point(outX, secondY), new Point(tx, secondY)], channelY: firstY };
  }

  private docked(job: MessageFlowJob, down: boolean, sourceLeg: Leg, targetLeg: Leg): [Leg, Leg] {
    const sourceDocks = job.source.is('bpmn:Participant');
    const targetDocks = job.target.is('bpmn:Participant');
    if (sourceDocks && targetDocks) {
      return [MessageFlowRouter.dockLeg(job.sourceBox, job.targetBox.center.x, !down), MessageFlowRouter.dockLeg(job.targetBox, job.sourceBox.center.x, down)];
    }
    if (sourceDocks) {
      return [MessageFlowRouter.dockLeg(job.sourceBox, targetLeg.x, !down), targetLeg];
    }
    return targetDocks ? [sourceLeg, MessageFlowRouter.dockLeg(job.targetBox, sourceLeg.x, down)] : [sourceLeg, targetLeg];
  }

  private planOf(job: MessageFlowJob): Plan {
    const indexOf = (pool: MessagePool | undefined): number => (pool ? this.pools.indexOf(pool) : -1);
    const [sourceIndex, targetIndex] = [indexOf(job.sourcePool), indexOf(job.targetPool)];
    const down = sourceIndex < targetIndex || (sourceIndex === targetIndex && job.sourceBox.center.y < job.targetBox.center.y) || targetIndex < 0;
    const [sourceLeg, targetLeg] = this.docked(job, down, this.legs.legOf(this.sourceEnd(job), !down), this.legs.legOf(this.targetEnd(job), down));
    const [sx, tx] = [sourceLeg.x, targetLeg.x];
    const low = Math.min(sourceIndex, targetIndex);
    if (low < 0 || Math.abs(sourceIndex - targetIndex) === 1) {
      return { job, sourceLeg, targetLeg, sx, tx, gaps: [Math.max(low, 0)], outside: false, down };
    }
    const gaps = sourceIndex < targetIndex ? [sourceIndex, targetIndex - 1] : [sourceIndex - 1, targetIndex];
    return { job, sourceLeg, targetLeg, sx, tx, gaps, outside: true, down };
  }
}
