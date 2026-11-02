import { Point, Polyline, type Box, type BpmnElement, type Segment } from '../../../model/index.js';
import { RoutingArea } from '../routing/RoutingArea.js';

export interface MessagePool {
  box: Box;
  obstacles: Box[];
  lines: Segment[];
  crossable?: Segment[];
  contentLeft: number;
}

export interface Leg {
  points: Point[];
  x: number;
}

export interface MessageEnd {
  box: Box;
  own: readonly Box[];
  element: BpmnElement;
  pool?: MessagePool | undefined;
}

export class MessageLegs {
  private static readonly JOG = 15;
  private static readonly CLEAR = 20;
  private static readonly NEAR = 8;
  private static readonly WIDE_GAP = 120;
  private static readonly BESIDE_MIDDLE = 25;
  private static readonly WIDE_EXIT = 100;
  private static readonly ON_LINE = 300;
  private static readonly ALONG_LINE = 30;
  private static readonly HIT = 1000;
  private static readonly CROSSING = 5;

  private static hits(points: readonly Point[], boxes: readonly Box[]): number {
    const segments = new Polyline(points).segments();
    return boxes.filter((box) => segments.some((segment) => segment.hitsBounds(box, 1))).length;
  }

  private static overlapLength(firstLow: number, firstHigh: number, secondLow: number, secondHigh: number): number {
    return Math.min(Math.max(firstLow, firstHigh), Math.max(secondLow, secondHigh)) - Math.max(Math.min(firstLow, firstHigh), Math.min(secondLow, secondHigh));
  }

  private static alongOne({ start, end }: Segment, line: Segment): number {
    const vertical = start.x === end.x;
    if (vertical ? line.start.x !== line.end.x : line.start.y !== line.end.y) {
      return 0;
    }
    const off = vertical ? Math.abs(line.start.x - start.x) : Math.abs(line.start.y - start.y);
    if (off >= MessageLegs.NEAR) {
      return 0;
    }
    const length = vertical ? MessageLegs.overlapLength(start.y, end.y, line.start.y, line.end.y) : MessageLegs.overlapLength(start.x, end.x, line.start.x, line.end.x);
    if (length <= 0) {
      return 0;
    }
    return off < 1 ? MessageLegs.ON_LINE : MessageLegs.ALONG_LINE;
  }

  private static alongCost(points: readonly Point[], lines: readonly Segment[]): number {
    let cost = 0;
    for (const segment of new Polyline(points).segments()) {
      for (const line of lines) {
        cost += MessageLegs.alongOne(segment, line);
      }
    }
    return cost;
  }

  private static isOnTop(obstacle: Box, box: Box): boolean {
    return obstacle.center.y < box.center.y;
  }

  private static obstaclesFor(pool: MessagePool, box: Box, own: readonly Box[], up = false): Box[] {
    const mine = up ? own.filter((obstacle) => !MessageLegs.isOnTop(obstacle, box)) : own;
    return pool.obstacles.filter((obstacle) => obstacle !== box && !mine.includes(obstacle));
  }

  private static exitXs(box: Box): number[] {
    const centerX = Math.round(box.x + box.width / 2);
    return box.width >= MessageLegs.WIDE_EXIT ? [centerX, centerX - MessageLegs.BESIDE_MIDDLE, centerX + MessageLegs.BESIDE_MIDDLE] : [centerX];
  }

  private static gapXs(gapStart: number, gapEnd: number, near: number): number[] {
    if (gapEnd < gapStart) {
      return [];
    }
    if (gapEnd - gapStart > MessageLegs.WIDE_GAP) {
      return [Math.round(Math.min(Math.max(near, gapStart + MessageLegs.CLEAR), gapEnd - MessageLegs.CLEAR))];
    }
    const middle = (gapStart + gapEnd) / 2;
    const beside = Math.min(10, (gapEnd - gapStart) / 2);
    return [Math.round(middle), Math.round(middle - beside), Math.round(middle + beside)];
  }

  private static corridorXs(pool: MessagePool, obstacles: readonly Box[], firstY: number, secondY: number, near: number): number[] {
    const { CLEAR } = MessageLegs;
    const [low, high] = [Math.min(firstY, secondY), Math.max(firstY, secondY)];
    const spans = obstacles
      .filter((obstacle) => obstacle.y < high && obstacle.bottom > low)
      .map((obstacle): [number, number] => [obstacle.x - CLEAR, obstacle.right + CLEAR])
      .sort((first, second) => first[0] - second[0]);
    const right = pool.box.right - CLEAR;
    const xs: number[] = [];
    let cursor = pool.contentLeft + CLEAR;
    for (const [spanStart, spanEnd] of spans) {
      xs.push(...MessageLegs.gapXs(cursor, Math.min(spanStart, right), near));
      cursor = Math.max(cursor, spanEnd);
    }
    return [...xs, ...MessageLegs.gapXs(cursor, right, near)];
  }

  private static straight(x: number, edge: number): Leg {
    return { points: [new Point(x, edge)], x };
  }

  private static reachOf({ box, own }: MessageEnd, up: boolean): number {
    return up ? Math.min(box.y, ...own.filter((event) => MessageLegs.isOnTop(event, box)).map((event) => event.y)) : Math.max(box.bottom, ...own.map((event) => event.bottom));
  }

  straightHits({ box, own }: MessageEnd, pool: MessagePool | undefined, up: boolean): number {
    if (!pool) {
      return 0;
    }
    const centerX = Math.round(box.x + box.width / 2);
    const line = [new Point(centerX, up ? box.y : box.bottom), new Point(centerX, up ? pool.box.y : pool.box.bottom)];
    return MessageLegs.hits(line, MessageLegs.obstaclesFor(pool, box, own, up)) + (MessageLegs.alongCost(line, pool.lines) >= MessageLegs.ON_LINE ? 1 : 0);
  }

  legOf(end: MessageEnd, up: boolean): Leg {
    const { box, own, pool, element } = end;
    const edge = up ? box.y : box.bottom;
    const exits = MessageLegs.exitXs(box);
    if (!pool || element.is('bpmn:Participant')) {
      return MessageLegs.straight(exits[0]!, edge);
    }
    const border = up ? pool.box.y : pool.box.bottom;
    const obstacles = MessageLegs.obstaclesFor(pool, box, own, up);
    const crossable = pool.crossable ?? pool.lines;
    const clean = exits
      .map((x, exitIndex) => ({ x, line: [new Point(x, edge), new Point(x, border)], exitIndex }))
      .filter(({ line }) => !MessageLegs.hits(line, obstacles) && MessageLegs.alongCost(line, pool.lines) < MessageLegs.ON_LINE)
      .map(({ x, line, exitIndex }) => ({ x, score: exitIndex === 0 ? -1 : RoutingArea.crossingsOf(line, crossable) * MessageLegs.CROSSING + exitIndex }));
    if (clean.length) {
      return MessageLegs.straight(clean.reduce((best, candidate) => (candidate.score < best.score ? candidate : best)).x, edge);
    }
    return this.jogged(end, up, { edge, border, exits, obstacles, crossable, pool });
  }

  private jogged(end: MessageEnd, up: boolean, { edge, border, exits, obstacles, crossable, pool }: { edge: number; border: number; exits: readonly number[]; obstacles: readonly Box[]; crossable: readonly Segment[]; pool: MessagePool }): Leg {
    const reach = MessageLegs.reachOf(end, up);
    const jogY = Math.round(up ? reach - MessageLegs.JOG : reach + MessageLegs.JOG);
    const score = (points: readonly Point[]): number => MessageLegs.hits(points, obstacles) * MessageLegs.HIT + RoutingArea.crossingsOf(points, crossable) * MessageLegs.CROSSING + MessageLegs.alongCost(points, pool.lines);
    let best = { leg: MessageLegs.straight(exits[0]!, edge), score: score([new Point(exits[0]!, edge), new Point(exits[0]!, border)]) };
    exits.forEach((exitX, exitIndex) => {
      for (const corridorX of MessageLegs.corridorXs(pool, obstacles, jogY, border, exitX)) {
        const points = [new Point(exitX, edge), new Point(exitX, jogY), new Point(corridorX, jogY)];
        const total = score([...points, new Point(corridorX, border)]) + Math.abs(corridorX - exitX) * 0.01 + exitIndex;
        if (total < best.score) {
          best = { leg: { points, x: corridorX }, score: total };
        }
      }
    });
    return best.leg;
  }
}
