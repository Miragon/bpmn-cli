import type { Box } from '../../../model/index.js';
import { GEdge } from '../scopes/GEdge.js';

export class RunHeights {
  private readonly left: number;
  private readonly right: number;

  constructor(x1: number, x2: number, private readonly area: readonly Box[]) {
    this.left = Math.min(x1, x2);
    this.right = Math.max(x1, x2);
  }

  below(from: number): number {
    const near = this.near();
    let runY = from + GEdge.RUN_CLEAR;
    for (let moved = true; moved; ) {
      moved = false;
      for (const box of near) {
        if (RunHeights.isTooClose(box, runY)) {
          runY = box.bottom + GEdge.RUN_CLEAR;
          moved = true;
        }
      }
    }
    return runY;
  }

  above(from: number): number {
    const near = this.near();
    let runY = from - GEdge.RUN_CLEAR;
    for (let moved = true; moved; ) {
      moved = false;
      for (const box of near) {
        if (RunHeights.isTooClose(box, runY)) {
          runY = box.y - GEdge.RUN_CLEAR;
          moved = true;
        }
      }
    }
    return runY;
  }

  private static isTooClose(box: Box, runY: number): boolean {
    return box.y < runY + GEdge.RUN_CLEAR && box.bottom + GEdge.RUN_CLEAR > runY;
  }

  private near(): Box[] {
    return this.area.filter((box) => box.x < this.right && box.right > this.left);
  }
}
