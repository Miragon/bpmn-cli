import { Segment, type Box, type Point } from '../../../model/index.js';
import { ShapeSides, type Side } from '../../plane/ShapeSides.js';
import { RouteCosts } from './RouteCosts.js';
import { RouteLines, type Seg } from './RouteLines.js';
import { RoutePorts, type Port } from './RoutePorts.js';

export interface RouteRequest {
  source: Box;
  target: Box;
  sourceSides?: readonly Side[];
  targetSides?: readonly Side[];
  sourceMiddle?: boolean;
  targetMiddle?: boolean;
  sourceAvoid?: readonly Side[];
  targetAvoid?: readonly Side[];
  targetMerge?: boolean;
  obstacles: readonly Box[];
  lines?: readonly Point[][];
  freeLines?: ReadonlySet<readonly Point[]>;
  frame?: Box;
  margin?: number;
}

interface SceneParts {
  source: Box;
  target: Box;
  margin: number;
  stub: number;
  obstacles: Box[];
  segs: Seg[];
  src: Port[];
  tgt: Port[];
  targetMiddle: boolean;
}

export interface RouteScore {
  hits: number;
  penalty: number;
}

export class RouteScene implements SceneParts {
  readonly source: Box;
  readonly target: Box;
  readonly margin: number;
  readonly stub: number;
  readonly obstacles: Box[];
  readonly segs: Seg[];
  readonly src: Port[];
  readonly tgt: Port[];
  readonly targetMiddle: boolean;

  private constructor(parts: SceneParts) {
    this.source = parts.source;
    this.target = parts.target;
    this.margin = parts.margin;
    this.stub = parts.stub;
    this.obstacles = parts.obstacles;
    this.segs = parts.segs;
    this.src = parts.src;
    this.tgt = parts.tgt;
    this.targetMiddle = parts.targetMiddle;
  }

  static of(request: RouteRequest): RouteScene {
    const margin = Math.max(0, request.margin ?? 15);
    const stub = Math.max(RouteCosts.MIN_STUB, margin);
    const { source, target, lines = [] } = request;
    const obstacles = request.obstacles.filter((box) => RouteScene.isFinite(box));
    const docked = lines.flatMap((line) => (line.length >= 2 ? [line[0]!, line.at(-1)!] : []));
    const ports = new RoutePorts(obstacles, margin, stub);
    const tgt = ports.of({ box: target, sides: RoutePorts.sidesOf(request.targetSides, ShapeSides.TARGET_DEFAULT), rank: RouteCosts.TGT_RANK, other: source, docked, middle: request.targetMiddle === true, avoid: request.targetAvoid });
    const src = ports.of({ box: source, sides: RoutePorts.sidesOf(request.sourceSides, ShapeSides.SOURCE_DEFAULT), rank: RouteCosts.SRC_RANK, other: target, docked, middle: request.sourceMiddle === true, avoid: request.sourceAvoid });
    const mergeAt = request.targetMerge ? tgt.filter((port) => port.side === 'top' || port.side === 'bottom') : [];
    const segs = new RouteLines(mergeAt, target.width + 2 * stub, request.freeLines).segments(lines);
    return new RouteScene({ source, target, margin, stub, obstacles, segs, src, tgt, targetMiddle: request.targetMiddle === true });
  }

  static isFinite(box: Box): boolean {
    return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width >= 0 && box.height >= 0;
  }

  thinned(): RouteScene {
    return new RouteScene({ ...this, margin: RouteCosts.THIN_MARGIN });
  }

  score(points: readonly Point[]): RouteScore {
    let hits = 0, penalty = 0;
    const boxes = [...this.obstacles, this.source, this.target];
    const tail = this.mergedTail(points);
    for (let index = 0; index + 1 < points.length; index++) {
      const start = points[index]!, end = points[index + 1]!;
      const segment = new Segment(start, end);
      hits += boxes.filter((box) => segment.hitsBounds(box)).length;
      for (const seg of this.segs) {
        penalty += this.penaltyAlong(segment, seg, seg.merge === true && index >= tail);
      }
    }
    return { hits, penalty };
  }

  private penaltyAlong(segment: Segment, seg: Seg, followsTail: boolean): number {
    const { start, end } = segment;
    if (segment.crosses(new Segment(seg.start, seg.end))) {
      return seg.free ? 0 : RouteCosts.CROSS;
    }
    return !followsTail && RouteLines.overlap(start, end, seg.start, seg.end) ? RouteCosts.OVERLAP : 0;
  }

  private mergedTail(points: readonly Point[]): number {
    const onTail = (index: number): boolean => this.segs.some((seg) => seg.merge && RouteLines.overlap(points[index]!, points[index + 1]!, seg.start, seg.end));
    let tail = points.length - 1;
    while (tail > 0 && onTail(tail - 1)) {
      tail--;
    }
    return tail;
  }
}
