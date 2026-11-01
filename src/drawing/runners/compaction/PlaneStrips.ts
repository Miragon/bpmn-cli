import { Box, type Point } from '../../../model/index.js';
import { BoxAxis, type Axis } from '../../plane/BoxAxis.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';

export interface Strip {
  from: number;
  to: number;
  keep: number;
}

export interface Occupancy {
  skip: ReadonlySet<string>;
  solid?: ((shape: DShape) => boolean) | undefined;
  loose?: ReadonlySet<string> | undefined;
}

export interface StripOptions extends Occupancy {
  start?: number;
  end?: number;
  lead: number;
  trail: number;
  gap: number;
  empty?: number;
}

export class PlaneStrips {
  static readonly PAD = 30;

  private static readonly MIN_GAIN = 10;
  private static readonly GROUP_BORDER = 2;
  private static readonly MIN_ROW_GAP = 30;
  private static readonly MAX_ROW_GAP = 60;
  private static readonly ROW_TAKEN_BY_SHAPE = 80;

  constructor(private readonly plane: Plane) {}

  private static isExpanded(shape: DShape): boolean {
    return shape.kind === 'subProcess' && shape.container;
  }

  private static merged(spans: Array<[number, number]>, low: number, high: number): Array<[number, number]> {
    const clipped = spans.map(([start, end]): [number, number] => [Math.max(start, low), Math.min(end, high)]).filter(([start, end]) => end >= start);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of clipped.sort((one, other) => one[0] - other[0])) {
      const last = merged.at(-1);
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  }

  private static stripsAround(merged: ReadonlyArray<[number, number]>, options: StripOptions): Strip[] {
    const { start, end, lead, gap, trail } = options;
    const strips: Strip[] = [];
    if (start !== undefined) {
      strips.push({ from: start, to: merged[0]![0], keep: lead });
    }
    for (let index = 0; index + 1 < merged.length; index++) {
      strips.push({ from: merged[index]![1], to: merged[index + 1]![0], keep: gap });
    }
    if (end !== undefined) {
      strips.push({ from: merged.at(-1)![1], to: end, keep: trail });
    }
    return strips;
  }

  private static groupBorder(axis: Axis, { x, y, width, height }: Box, at: number): Box {
    return axis === 'x' ? new Box(at, y, 0, height) : new Box(x, at, width, 0);
  }

  private static runsAlong(axis: Axis, from: Point, to: Point): boolean {
    return axis === 'x' ? from.y === to.y : from.x === to.x;
  }

  private static takeEdge(axis: Axis, { label, points }: DEdge, take: (box: Box, margin?: number) => void): void {
    if (label) {
      take(label);
    }
    for (const { x, y } of points) {
      take(new Box(x - 1, y - 1, 2, 2));
    }
    for (let index = 0; index + 1 < points.length; index++) {
      const from = points[index]!;
      const to = points[index + 1]!;
      if (!PlaneStrips.runsAlong(axis, from, to)) {
        take(new Box(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y)), 1);
      }
    }
  }

  gaps(): { x: number; y: number } {
    const { gap, row } = this.plane.spacing();
    return { x: gap, y: Math.min(PlaneStrips.MAX_ROW_GAP, Math.max(PlaneStrips.MIN_ROW_GAP, row - PlaneStrips.ROW_TAKEN_BY_SHAPE)) };
  }

  looseEdges(): Set<string> {
    return new Set([...this.plane.edges.values()].filter((edge) => edge.kind === 'messageFlow').map((edge) => edge.id));
  }

  emptyStrips(axis: Axis, region: Box, options: StripOptions): Strip[] {
    const merged = this.occupied(axis, region, options);
    const { start, end, empty } = options;
    const strips = merged.length ? PlaneStrips.stripsAround(merged, options) : [];
    if (!merged.length && empty !== undefined && start !== undefined && end !== undefined) {
      strips.push({ from: start, to: end, keep: empty });
    }
    return strips.filter((strip) => strip.to - strip.from - strip.keep >= PlaneStrips.MIN_GAIN);
  }

  occupied(axis: Axis, region: Box, occupancy: Occupancy): Array<[number, number]> {
    const along = BoxAxis.of(axis);
    const low = along.near(region);
    const high = along.far(region);
    const band = along.bandOf(region);
    const spans: Array<[number, number]> = [];
    const take = (box: Box, margin = 0): void => {
      if (along.overlapsBand(box, band) && along.far(box) + margin >= low && along.near(box) - margin <= high) {
        spans.push([along.near(box) - margin, along.far(box) + margin]);
      }
    };
    this.takeShapes(axis, occupancy, take);
    for (const edge of this.plane.edges.values()) {
      if (!occupancy.loose?.has(edge.id)) {
        PlaneStrips.takeEdge(axis, edge, take);
      }
    }
    return PlaneStrips.merged(spans, low, high);
  }

  private takeShapes(axis: Axis, { skip, solid = PlaneStrips.isExpanded }: Occupancy, take: (box: Box, margin?: number) => void): void {
    const along = BoxAxis.of(axis);
    for (const shape of this.plane.shapes.values()) {
      if (skip.has(shape.id)) {
        continue;
      }
      if (shape.isLeaf || solid(shape)) {
        take(shape.bounds);
      } else if (shape.kind === 'group') {
        take(PlaneStrips.groupBorder(axis, shape.bounds, along.near(shape.bounds)), PlaneStrips.GROUP_BORDER);
        take(PlaneStrips.groupBorder(axis, shape.bounds, along.far(shape.bounds)), PlaneStrips.GROUP_BORDER);
      }
      if (shape.label) {
        take(shape.label);
      }
    }
  }
}
