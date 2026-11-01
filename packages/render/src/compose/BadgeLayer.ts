import { Box, type Plane, type Point } from '../read/index.js';
import { Svg } from '../paint/index.js';

export interface Badge {
  n: number;
  ids: string[];
  at?: Point;
}

export interface PlacedBadge {
  n: number;
  box: Box;
  svg: string;
}

export class BadgeLayer {
  private static readonly COLOR = '#e03131';
  private static readonly RADIUS = 9;
  private static readonly RINGS = [2, 4, 6];
  private static readonly SPOTS_PER_RING = 8;

  private readonly radius: number;
  private readonly taken: Point[] = [];

  constructor(
    private readonly plane: Plane,
    private readonly view: Box,
    private readonly scale: number,
  ) {
    this.radius = BadgeLayer.RADIUS / scale;
  }

  placed(badges: readonly Badge[]): PlacedBadge[] {
    return badges.flatMap((badge) => this.place(badge) ?? []);
  }

  private place(badge: Badge): PlacedBadge | undefined {
    const box = this.boxOf(badge.ids);
    const at = badge.at ?? (box ? { x: box.centerX, y: box.centerY } : undefined);
    if (!box || !at || !this.view.contains(at)) {
      return undefined;
    }
    const spot = this.freeSpot(at, box);
    this.taken.push(spot);
    return { n: badge.n, box: new Box(spot.x, spot.y, 0, 0).grown(this.radius), svg: this.circle(badge.n, spot) };
  }

  private circle(n: number, spot: Point): string {
    const label = String(n);
    const size = (label.length > 2 ? 9 : 11) / this.scale;
    return `<g data-badge="${n}"><circle cx="${Svg.number(spot.x)}" cy="${Svg.number(spot.y)}" r="${Svg.number(this.radius)}" fill="${BadgeLayer.COLOR}" stroke="${Svg.FILL}" stroke-width="${Svg.number(1.5 / this.scale)}"/><text x="${Svg.number(spot.x)}" y="${Svg.number(spot.y + size * 0.36)}" font-size="${Svg.number(size)}" fill="${Svg.FILL}" text-anchor="middle">${label}</text></g>`;
  }

  private boxOf(ids: readonly string[]): Box | undefined {
    return Box.around(ids.flatMap((id) => this.boxesOf(id)));
  }

  private boxesOf(id: string): Box[] {
    const shape = this.plane.shapes.get(id);
    const edge = this.plane.edges.get(id);
    const spanned = edge ? Box.spanning(edge.points) : undefined;
    return [shape?.bounds, shape?.label, spanned, spanned && edge?.label].filter((box): box is Box => !!box);
  }

  private freeSpot(at: Point, box: Box): Point {
    if (this.free(at)) {
      return at;
    }
    for (const ring of BadgeLayer.RINGS) {
      for (let step = 0; step < BadgeLayer.SPOTS_PER_RING; step++) {
        const angle = (step * Math.PI) / 4;
        const spot = { x: at.x + Math.cos(angle) * ring * this.radius, y: at.y + Math.sin(angle) * ring * this.radius };
        if (box.contains(spot) && this.free(spot)) {
          return { x: Math.round(spot.x * 100) / 100, y: Math.round(spot.y * 100) / 100 };
        }
      }
    }
    return at;
  }

  private free(point: Point): boolean {
    return this.taken.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 2 * this.radius - 0.01);
  }
}
