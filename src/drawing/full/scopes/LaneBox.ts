import type { Box, BpmnElement } from '../../../model/index.js';

export class LaneBox {
  readonly children: LaneBox[] = [];

  constructor(
    readonly el: BpmnElement,
    readonly id: string,
    public box: Box,
  ) {}

  static depthOf(lanes: readonly LaneBox[]): number {
    return lanes.length ? 1 + Math.max(...lanes.map((lane) => LaneBox.depthOf(lane.children))) : 0;
  }

  stretch(width: number): void {
    this.box.width = width - this.box.x;
    for (const child of this.children) {
      child.stretch(width);
    }
  }
}
