import { Box, Point, Polyline, Segment } from '../../../model/index.js';
import type { DShape, ShapeKind } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import { Semantics } from '../../plane/Semantics.js';
import { ShapeSides } from '../../plane/ShapeSides.js';
import type { ShapeSize } from '../../plane/ShapeSizes.js';
import { OrthogonalRouter } from '../routing/OrthogonalRouter.js';
import type { PlacementState } from './PlacementState.js';

export interface Shift {
  line: number;
  delta: number;
  within?: Box;
  frame?: string;
}

export interface Cand {
  x: number;
  centre: number;
  size: ShapeSize;
  penalty: number;
  extent?: number;
  insert?: Shift;
  grow?: Shift;
  top?: Box;
}

type RowSource = Pick<DShape, 'id' | 'hostId' | 'kind' | 'parentId' | 'bounds'>;

interface PricedLine {
  segments: Segment[];
  cost: number;
}

interface ChainSpan {
  run: Segment | undefined;
  rest: Box | undefined;
  nodes: Box | undefined;
  head: Box | undefined;
}

export class RowCosts {
  private static readonly CROSSING = 300;
  private static readonly ANNOTATION_CROSSING = 25;
  private static readonly LINE_HIT = 400;
  private static readonly LABEL_HIT = 100;
  private static readonly SHAPE_HIT = 2000;
  private static readonly BEND = 30;
  private static readonly LINE_CLEARANCE = 2;

  constructor(private readonly state: PlacementState) {}

  static shiftedBox(box: Box, shift: Shift | undefined): Box {
    return shift && box.y >= shift.line ? new Box(box.x, box.y + shift.delta, box.width, box.height) : box;
  }

  private static shiftedLine(points: Point[], shift: Shift | undefined): Point[] {
    return shift ? points.map((point) => (point.y >= shift.line ? new Point(point.x, point.y + shift.delta) : point)) : points;
  }

  private static crossingsOf(segments: readonly Segment[], line: readonly Segment[]): number {
    return segments.reduce((count, segment) => count + line.filter((other) => segment.crosses(other)).length, 0);
  }

  private static routeLength(segments: readonly Segment[]): number {
    return segments.reduce((length, { start, end }) => length + Math.abs(end.x - start.x) + Math.abs(end.y - start.y), 0);
  }

  ofCandidate(plane: Plane, from: DShape, kind: ShapeKind, cand: Cand): number {
    const box = new Box(cand.x, cand.centre - cand.size.height / 2, cand.size.width, cand.size.height);
    const shift = cand.insert ?? cand.grow;
    const { hostId, parentId } = from;
    const source: RowSource = { id: from.id, hostId, kind: from.kind, parentId, bounds: cand.top ?? RowCosts.shiftedBox(from.bounds, shift) };
    return this.connectionCost(plane, source, box, kind, shift) + this.chainCost(plane, box, cand) + cand.penalty;
  }

  private connectionCost(plane: Plane, from: RowSource, to: Box, toKind: ShapeKind, shift: Shift | undefined): number {
    const host = from.hostId ? plane.shapes.get(from.hostId) : undefined;
    const hostBox = host ? RowCosts.shiftedBox(host.bounds, shift) : undefined;
    const obstacles = this.obstaclesFor(plane, from, shift);
    const points = this.trialRoute(plane, from, to, toKind, { obstacles, hostBox, shift });
    const route = new Polyline(points);
    const segments = route.segments();
    const lengthAndBends = RowCosts.routeLength(segments) * 0.5 + (points.length - 2) * RowCosts.BEND;
    const cut = obstacles.filter((obstacle) => obstacle !== hostBox && route.hits(obstacle)).length * RowCosts.SHAPE_HIT;
    return lengthAndBends + cut + this.crossedLinesCost(plane, segments, shift) + this.labelsHitCost(plane, segments, shift);
  }

  private obstaclesFor(plane: Plane, from: RowSource, shift: Shift | undefined): Box[] {
    const obstacles: Box[] = [];
    for (const other of plane.shapes.values()) {
      const solid = other.isLeaf || (other.kind === 'subProcess' && other.container && other.id !== from.parentId);
      if (other.id !== from.id && other.kind !== 'group' && solid) {
        obstacles.push(RowCosts.shiftedBox(other.bounds, shift));
      }
    }
    return obstacles;
  }

  private trialRoute(plane: Plane, from: RowSource, to: Box, toKind: ShapeKind, { obstacles, hostBox, shift }: { obstacles: Box[]; hostBox: Box | undefined; shift: Shift | undefined }): Point[] {
    const notes = new Set([...plane.edges.values()].filter((edge) => Semantics.isAnnotationLine(edge.el)).map((edge) => edge.points));
    const freeLines = new Set<readonly Point[]>();
    const lines = this.state.drawing(plane).routes.routingLines().map((line) => {
      const shifted = RowCosts.shiftedLine(line, shift);
      if (notes.has(line)) {
        freeLines.add(shifted);
      }
      return shifted;
    });
    const sourceSides = from.kind === 'boundary' && hostBox ? [ShapeSides.attached(from.bounds, hostBox)] : ShapeSides.of(from.kind, 'source');
    return OrthogonalRouter.route({ source: from.bounds, target: to, sourceSides, targetSides: ShapeSides.of(toKind, 'target'), obstacles, lines, freeLines });
  }

  private crossedLinesCost(plane: Plane, segments: readonly Segment[], shift: Shift | undefined): number {
    const priced: PricedLine[] = [...plane.edges.values()]
      .map((edge) => ({ points: RowCosts.shiftedLine(edge.points, shift), cost: Semantics.isAnnotationLine(edge.el) ? RowCosts.ANNOTATION_CROSSING : RowCosts.CROSSING }))
      .filter(({ points }) => points.length >= 2)
      .map(({ points, cost }) => ({ segments: new Polyline(points).segments(), cost }));
    return priced.reduce((total, line) => total + RowCosts.crossingsOf(segments, line.segments) * line.cost, 0);
  }

  private labelsHitCost(plane: Plane, segments: readonly Segment[], shift: Shift | undefined): number {
    const labels = [...plane.shapes.values(), ...plane.edges.values()].flatMap((owner) => owner.label ?? []);
    const hits = labels.reduce((count, label) => {
      const shifted = RowCosts.shiftedBox(label, shift);
      return count + segments.filter((segment) => segment.hits(shifted, 0)).length;
    }, 0);
    return hits * RowCosts.LABEL_HIT;
  }

  private chainSpan(plane: Plane, box: Box, cand: Cand): ChainSpan {
    const extent = cand.extent ?? 0;
    const { gap } = this.state.spacingFor(plane);
    const { right, y, height } = box;
    const middle = box.center.y;
    return {
      run: extent > 0 ? new Segment(new Point(right, middle), new Point(right + extent, middle)) : undefined,
      rest: extent > 0 ? new Box(right, y, extent, height) : undefined,
      nodes: extent > gap ? new Box(right + gap, y, extent - gap, height) : undefined,
      head: cand.insert || cand.top ? box : undefined,
    };
  }

  private chainCost(plane: Plane, box: Box, cand: Cand): number {
    const shift = cand.insert ?? cand.grow;
    const span = this.chainSpan(plane, box, cand);
    let cost = 0;
    for (const edge of plane.edges.values()) {
      const line = new Polyline(RowCosts.shiftedLine(edge.points, shift)).segments();
      const note = Semantics.isAnnotationLine(edge.el);
      cost += line.reduce((sum, segment) => sum + RowCosts.segmentCost(segment, span, note), 0);
    }
    return cost;
  }

  private static segmentCost(segment: Segment, { run, rest, nodes, head }: ChainSpan, note: boolean): number {
    if (run?.crosses(segment)) {
      const hitsChainNodes = note && !!nodes && segment.hits(nodes, RowCosts.LINE_CLEARANCE);
      return (note ? RowCosts.ANNOTATION_CROSSING : RowCosts.CROSSING) + (hitsChainNodes ? RowCosts.LINE_HIT : 0);
    }
    const hitsRoom = (!!rest && segment.hits(rest, RowCosts.LINE_CLEARANCE)) || (!!head && segment.hits(head, RowCosts.LINE_CLEARANCE));
    return hitsRoom ? RowCosts.LINE_HIT : 0;
  }
}
