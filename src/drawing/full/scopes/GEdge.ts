import { Point, type Box, type BpmnElement } from '../../../model/index.js';
import type { GNode } from './GNode.js';

export class GEdge {
  static readonly RUN_CLEAR = 15;

  back = false;
  bandRow?: number | undefined;
  bandY?: number | undefined;
  points: Point[] = [];
  label?: Box | undefined;
  runsBelow?: boolean | undefined;
  runsAbove?: boolean | undefined;

  constructor(
    readonly el: BpmnElement,
    readonly id: string,
    readonly source: GNode,
    readonly target: GNode,
  ) {}

  get name(): string | undefined {
    return this.el.name;
  }

  straightLine(): Point[] {
    const lineY = Math.round((this.source.box.center.y + this.target.box.center.y) / 2);
    return [new Point(this.source.box.right, lineY), new Point(this.target.box.x, lineY)];
  }

  riseFrom(): number {
    return this.bandY ?? (this.source.host ? this.source.box.bottom + GEdge.RUN_CLEAR : this.source.box.center.y);
  }
}
