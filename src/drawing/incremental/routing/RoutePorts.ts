import { Point, Segment, type Box } from '../../../model/index.js';
import { ShapeSides, type Side } from '../../plane/ShapeSides.js';
import { RouteCosts } from './RouteCosts.js';

export interface Port {
  x: number;
  y: number;
  side: Side;
  cost: number;
}

export interface PortEnd {
  box: Box;
  sides: readonly Side[];
  rank: readonly number[];
  other: Box;
  docked?: readonly Point[];
  middle?: boolean;
  avoid?: readonly Side[] | undefined;
}

type SideSpan = Pick<PortEnd, 'box' | 'middle'> & { side: Side; low: number; high: number; base: number };

export class RoutePorts {
  constructor(
    private readonly obstacles: readonly Box[],
    private readonly margin: number,
    private readonly stub: number,
  ) {}

  static sidesOf(sides: readonly Side[] | undefined, fallback: readonly Side[]): readonly Side[] {
    const list = (sides ?? []).filter((side, index, all) => all.indexOf(side) === index && side in RouteCosts.OUTWARD);
    return list.length ? list : fallback;
  }

  private static faces(box: Box, side: Side, other: Box): boolean {
    switch (side) {
      case 'left':
        return other.right <= box.x;
      case 'right':
        return other.x >= box.right;
      case 'top':
        return other.bottom <= box.y;
      case 'bottom':
        return other.y >= box.bottom;
    }
  }

  of(end: PortEnd): Port[] {
    return end.sides.flatMap((side, sideIndex) => {
      const base = end.rank[Math.min(sideIndex, end.rank.length - 1)]! + (end.avoid?.includes(side) ? RouteCosts.AVOID : 0);
      const offsets = this.offsetsOn(end, side, base);
      return [...offsets].sort((first, second) => first[0] - second[0]).map(([offset, cost]) => RoutePorts.portAt(end.box, side, offset, cost));
    });
  }

  private static portAt(box: Box, side: Side, offset: number, cost: number): Port {
    const { x, y } = ShapeSides.pointOn(box, side, offset);
    return { x, y, side, cost };
  }

  private stubBlocked(box: Box, side: Side, offset: number, obstacles: readonly Box[]): boolean {
    const foot = ShapeSides.pointOn(box, side, offset);
    const outward = RouteCosts.OUTWARD[side];
    const stubEnd = new Point(foot.x + RouteCosts.DX[outward]! * this.stub, foot.y + RouteCosts.DY[outward]! * this.stub);
    return obstacles.some((obstacle) => new Segment(foot, stubEnd).hitsBounds(obstacle));
  }

  private offsetsOn({ box, other, docked = [], middle }: PortEnd, side: Side, base: number): Map<number, number> {
    const [low, high] = ShapeSides.span(box, side);
    const length = high - low;
    const center = Math.round(low + length / 2);
    const offsets = new Map<number, number>([[center, base]]);
    const span: SideSpan = { box, middle, side, low, high, base };
    if (RoutePorts.faces(box, side, other)) {
      const [otherLow, otherHigh] = ShapeSides.span(other, side);
      this.addOffset(offsets, span, Math.round(otherLow + (otherHigh - otherLow) / 2));
    }
    const blockers = this.obstacles.filter((obstacle) => this.stubBlocked(box, side, center, [obstacle]));
    for (const obstacle of blockers) {
      const [obstacleLow, obstacleHigh] = ShapeSides.span(obstacle, side);
      this.addOffset(offsets, span, this.clampOffset(span, obstacleLow - this.margin));
      this.addOffset(offsets, span, this.clampOffset(span, obstacleHigh + this.margin));
    }
    const centerPoint = ShapeSides.pointOn(box, side, center);
    const taken = docked.some((dock) => Math.abs(dock.x - centerPoint.x) <= 2 && Math.abs(dock.y - centerPoint.y) <= 2);
    if (blockers.length || taken) {
      this.addOffset(offsets, span, Math.round(low + length / 4));
      this.addOffset(offsets, span, Math.round(low + (3 * length) / 4));
    }
    return offsets;
  }

  private clampOffset({ low, high }: SideSpan, offset: number): number {
    const inset = Math.min(10, (high - low) / 4);
    return Math.round(Math.min(high - inset, Math.max(low + inset, offset)));
  }

  private addOffset(offsets: Map<number, number>, { box, middle, side, low, high, base }: SideSpan, offset: number): void {
    const length = high - low;
    const inset = Math.min(10, length / 4);
    if (middle || offset < low + inset || offset > high - inset || offsets.has(offset) || this.stubBlocked(box, side, offset, this.obstacles)) {
      return;
    }
    const center = Math.round(low + length / 2);
    offsets.set(offset, base + RouteCosts.PORT_OFFSET + (RouteCosts.PORT_SLOPE * Math.abs(offset - center)) / Math.max(length, 1));
  }
}
