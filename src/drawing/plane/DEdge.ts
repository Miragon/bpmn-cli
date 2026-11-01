import { Box, Point, Polyline, type BpmnElement } from '../../model/index.js';
import type { EdgeDrawing } from '../../scoring/index.js';
import { DShape, type LabelSide } from './DShape.js';

export type EdgeKind = 'sequenceFlow' | 'messageFlow' | 'association' | 'dataAssociation' | 'other';

type Run = { start: Point; end: Point; horizontal: boolean };

export class DEdge {
  private static readonly ABOVE_GAP = 4;
  private static readonly BESIDE_GAP = 6;
  private static readonly STRAIGHT = 0.5;

  di?: BpmnElement | undefined;
  sourceId?: string | undefined;
  targetId?: string | undefined;
  label?: Box | undefined;

  constructor(
    readonly id: string,
    readonly el: BpmnElement,
    public kind: EdgeKind,
    public points: Point[] = [],
  ) {}

  static waypointsOf(di: BpmnElement | undefined): Point[] {
    return (di?.list('waypoint') ?? []).map((waypoint) => new Point(waypoint.peek<number>('x') ?? Number.NaN, waypoint.peek<number>('y') ?? Number.NaN));
  }

  static writablePoints(points: readonly Point[]): Point[] {
    const rounded = new Polyline(points).rounded();
    if (rounded.length >= 2 || points.length < 2) {
      return rounded;
    }
    const last = points.at(-1)!;
    return [rounded[0]!, new Point(Math.round(last.x), Math.round(last.y))];
  }

  private static distanceAndSide({ start, end, horizontal }: Run, middle: Point): { distance: number; side: LabelSide } {
    const low = horizontal ? Math.min(start.x, end.x) : Math.min(start.y, end.y);
    const high = horizontal ? Math.max(start.x, end.x) : Math.max(start.y, end.y);
    const along = horizontal ? middle.x : middle.y;
    const beyond = Math.max(0, low - along, along - high);
    const across = horizontal ? middle.y - start.y : middle.x - start.x;
    const sides: [LabelSide, LabelSide] = horizontal ? ['above', 'below'] : ['left', 'right'];
    return { distance: Math.hypot(beyond, across), side: across < 0 ? sides[0] : sides[1] };
  }

  drawing(): EdgeDrawing {
    const { id, el, di, points, label } = this;
    const current = DEdge.waypointsOf(di);
    return { id, el, points: new Polyline(current).same(new Polyline(points)) ? current : DEdge.writablePoints(points), label: DShape.storedLabel(di, label) };
  }

  translate(dx: number, dy: number): void {
    new Polyline(this.points).translate(dx, dy);
    this.label?.translate(dx, dy);
  }

  labelSide(): LabelSide | undefined {
    const { label, points } = this;
    if (!label || points.length < 2) {
      return undefined;
    }
    let best: LabelSide | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const run of this.runs()) {
      const { distance, side } = DEdge.distanceAndSide(run, label.center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = side;
      }
    }
    return best;
  }

  labelAt({ width, height }: Pick<Box, 'width' | 'height'>, side: LabelSide): Box | undefined {
    const horizontal = side === 'above' || side === 'below';
    const longest = this.longestStraightRun(horizontal);
    if (!longest) {
      return undefined;
    }
    const { start, end } = longest;
    if (horizontal) {
      return new Box(Math.round((start.x + end.x) / 2 - width / 2), Math.round(side === 'above' ? start.y - height - DEdge.ABOVE_GAP : start.y + DEdge.ABOVE_GAP), width, height);
    }
    return new Box(Math.round(side === 'left' ? start.x - width - DEdge.BESIDE_GAP : start.x + DEdge.BESIDE_GAP), Math.round((start.y + end.y) / 2 - height / 2), width, height);
  }

  private runs(): Run[] {
    return new Polyline(this.points).segments().map(({ start, end }) => ({ start, end, horizontal: Math.abs(start.y - end.y) <= Math.abs(start.x - end.x) }));
  }

  private longestStraightRun(horizontal: boolean): Run | undefined {
    let longest: Run | undefined;
    let length = 0;
    for (const { start, end } of new Polyline(this.points).segments()) {
      const [across, along] = horizontal ? [start.y - end.y, start.x - end.x] : [start.x - end.x, start.y - end.y];
      const runLength = Math.abs(across) < DEdge.STRAIGHT ? Math.abs(along) : 0;
      if (runLength > length) {
        length = runLength;
        longest = { start, end, horizontal };
      }
    }
    return longest;
  }
}
