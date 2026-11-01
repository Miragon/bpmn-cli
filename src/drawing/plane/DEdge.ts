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

  drawing(): EdgeDrawing {
    const { id, el, di, points, label } = this;
    const current = DEdge.waypointsOf(di);
    return { id, el, points: new Polyline(current).same(new Polyline(points)) ? current : DEdge.writablePoints(points), label: DShape.storedLabel(di, label) };
  }

  translate(dx: number, dy: number): void {
    new Polyline(this.points).translate(dx, dy);
    this.label?.translate(dx, dy);
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
