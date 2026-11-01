import type { Box } from '../../../model/index.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import { ShapeSides, type Side } from '../../plane/ShapeSides.js';

interface Seat {
  side: Side;
  center: number;
}

export class BoundaryReseat {
  private static readonly GAP = 4;
  private static readonly CORNER = 7;
  private static readonly OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

  private readonly seats = new Map<DShape, Seat>();
  private readonly overflow: Array<[Side, DShape]> = [];

  constructor(
    private readonly plane: Plane,
    private readonly host: DShape,
    private readonly old: Box,
    private readonly touched: Set<string>,
  ) {}

  private static horizontal(side: Side): boolean {
    return side === 'top' || side === 'bottom';
  }

  private static along({ bounds }: DShape, side: Side): number {
    return BoundaryReseat.horizontal(side) ? bounds.center.x : bounds.center.y;
  }

  private static size({ bounds }: DShape, side: Side): number {
    return BoundaryReseat.horizontal(side) ? bounds.width : bounds.height;
  }

  reseat(): void {
    const bySide = new Map<Side, DShape[]>();
    for (const event of this.plane.boundariesOf(this.host.id)) {
      const side = ShapeSides.attached(event.bounds, this.old);
      bySide.set(side, [...(bySide.get(side) ?? []), event]);
    }
    for (const [side, events] of bySide) {
      this.fit(side, events, true);
    }
    for (const [side, event] of this.overflow.splice(0)) {
      this.fit(BoundaryReseat.OPPOSITE[side], [event], false);
    }
    for (const [side, event] of this.overflow) {
      this.seats.set(event, { side, center: ShapeSides.span(this.host.bounds, side)[1] - BoundaryReseat.size(event, side) / 2 });
    }
    for (const [event, seat] of this.seats) {
      this.seatEvent(event, seat);
    }
  }

  private free(side: Side, center: number, event: DShape): boolean {
    const [low, high] = ShapeSides.span(this.host.bounds, side);
    const size = BoundaryReseat.size(event, side);
    const taken = [...this.seats].filter(([, seat]) => seat.side === side);
    return center - size / 2 >= low - 0.5 && center + size / 2 <= high + 0.5 && taken.every(([other, seat]) => this.clearOf(side, event, center, other, seat.center));
  }

  private clearOf(side: Side, event: DShape, center: number, other: DShape, otherCenter: number): boolean {
    return Math.abs(otherCenter - center) >= (BoundaryReseat.size(other, side) + BoundaryReseat.size(event, side)) / 2 + BoundaryReseat.GAP;
  }

  private fit(side: Side, events: readonly DShape[], keepOffsets: boolean): void {
    const sorted = [...events].sort((first, second) => BoundaryReseat.along(first, side) - BoundaryReseat.along(second, side));
    if (!keepOffsets || !this.keepOffsets(side, sorted)) {
      this.fitFromEnd(side, sorted);
    }
  }

  private keepOffsets(side: Side, sorted: readonly DShape[]): boolean {
    const high = ShapeSides.span(this.host.bounds, side)[1];
    const oldHigh = ShapeSides.span(this.old, side)[1];
    const centers = sorted.map((event) => high - (oldHigh - BoundaryReseat.along(event, side)));
    const fits = sorted.every((event, index) => this.free(side, centers[index]!, event) && sorted.every((other, otherIndex) => otherIndex === index || this.clearOf(side, event, centers[index]!, other, centers[otherIndex]!)));
    if (fits) {
      sorted.forEach((event, index) => this.seats.set(event, { side, center: centers[index]! }));
    }
    return fits;
  }

  private fitFromEnd(side: Side, sorted: readonly DShape[]): void {
    const [low, high] = ShapeSides.span(this.host.bounds, side);
    let center = high;
    for (const event of [...sorted].reverse()) {
      const half = BoundaryReseat.size(event, side) / 2;
      center = Math.min(center - half - BoundaryReseat.CORNER, high - half - BoundaryReseat.CORNER);
      while (!this.free(side, center, event) && center - half >= low) {
        center -= BoundaryReseat.GAP;
      }
      if (this.free(side, center, event)) {
        this.seats.set(event, { side, center });
        center -= half;
      } else {
        this.overflow.push([side, event]);
      }
    }
  }

  private seatEvent(event: DShape, { side, center }: Seat): void {
    const { bounds } = this.host;
    const { x: centerX, y: centerY } = ShapeSides.pointOn(bounds, side, center);
    const dx = Math.round(centerX - event.bounds.width / 2) - event.bounds.x;
    const dy = Math.round(centerY - event.bounds.height / 2) - event.bounds.y;
    if (dx || dy) {
      event.translate(dx, dy);
      this.touched.add(event.id);
    }
  }
}
