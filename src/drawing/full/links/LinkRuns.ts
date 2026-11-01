import type { Box } from '../../../model/index.js';
import type { LaneBandInfo } from '../scopes/GNode.js';
import { LinkPath } from './LinkPath.js';

export type LinkEndKind = 'shape' | 'flow';

export interface LinkEnds {
  artifactBox: Box;
  targetBox: Box;
  end: LinkEndKind;
  note: boolean;
  shapes: readonly Box[];
}

export interface Runs {
  standard: number[];
  gaps: number[];
  spare: number[];
}

interface Reach {
  under: number;
  over: number;
  below: number;
  above: number;
}

export class LinkRuns {
  static readonly STEP = 10;

  private static readonly STANDARD_OFFSET = 15;
  private static readonly UNDER_ALL = 20;
  private static readonly GAP_WIDE = 30;
  private static readonly NOTE_MIN_GAP = 12;
  private static readonly DATA_MIN_GAP = 4;

  constructor(
    private readonly ends: LinkEnds,
    private readonly bands: readonly LaneBandInfo[] | undefined,
  ) {}

  private static spareRuns(artifactBox: Box, under: number, roomAbove: boolean): number[] {
    const { STEP, STANDARD_OFFSET } = LinkRuns;
    const spare: number[] = [under - STEP];
    for (const step of [STEP, 2 * STEP]) {
      spare.push(artifactBox.bottom + STANDARD_OFFSET + step, under + step);
      if (roomAbove && artifactBox.y >= STANDARD_OFFSET + step) {
        spare.push(artifactBox.y - STANDARD_OFFSET - step);
      }
    }
    if (STEP < artifactBox.height / 2 - 4) {
      spare.push(artifactBox.center.y - STEP, artifactBox.center.y + STEP);
    }
    return spare;
  }

  of(exitX: number, exitY: number): Runs {
    const { artifactBox, targetBox, end, note } = this.ends;
    const middle = targetBox.center;
    const low = Math.min(exitX, middle.x);
    const high = Math.max(exitX, middle.x);
    const reach = this.reachBetween(low, high);
    const roomAbove = artifactBox.y >= LinkRuns.STANDARD_OFFSET || !this.bands;
    const standard = [artifactBox.center.y, ...(end === 'flow' ? [middle.y, (exitY + middle.y) / 2] : []), artifactBox.bottom + LinkRuns.STANDARD_OFFSET, ...(roomAbove ? [artifactBox.y - LinkRuns.STANDARD_OFFSET] : []), reach.under];
    const gaps: number[] = [];
    const spare: number[] = [];
    this.gapRun(reach.below - artifactBox.bottom, Math.round((reach.below + artifactBox.bottom) / 2), gaps, spare);
    if (roomAbove) {
      this.gapRun(artifactBox.y - reach.above, Math.round((reach.above + artifactBox.y) / 2), gaps, spare);
    }
    spare.push(...LinkRuns.spareRuns(artifactBox, reach.under, roomAbove));
    if (artifactBox.bottom < targetBox.y && reach.over > artifactBox.bottom) {
      standard.push(reach.over + LinkRuns.STANDARD_OFFSET);
      spare.push(reach.over + LinkRuns.STANDARD_OFFSET + LinkRuns.STEP, reach.over + LinkRuns.STANDARD_OFFSET + 2 * LinkRuns.STEP);
    }
    spare.push(...this.freeMiddles(standard, low, high, note ? LinkRuns.NOTE_MIN_GAP : LinkRuns.DATA_MIN_GAP));
    return { standard, gaps, spare: spare.filter((runY) => this.isInside(runY)) };
  }

  private reachBetween(low: number, high: number): Reach {
    const { artifactBox, targetBox, shapes } = this.ends;
    const reach: Reach = { under: Math.max(artifactBox.bottom, targetBox.bottom), over: artifactBox.bottom, below: Number.POSITIVE_INFINITY, above: Number.NEGATIVE_INFINITY };
    for (const box of shapes) {
      if (box !== artifactBox && box.x <= high && box.right >= low) {
        this.widen(reach, box);
      }
    }
    reach.under += LinkRuns.UNDER_ALL;
    return reach;
  }

  private widen(reach: Reach, box: Box): void {
    const { artifactBox, targetBox } = this.ends;
    if (box.y >= artifactBox.bottom) {
      reach.below = Math.min(reach.below, box.y);
    }
    if (box.bottom <= artifactBox.y) {
      reach.above = Math.max(reach.above, box.bottom);
    }
    if (box !== targetBox) {
      reach.under = Math.max(reach.under, box.bottom);
      if (box.bottom < targetBox.y) {
        reach.over = Math.max(reach.over, box.bottom);
      }
    }
  }

  private gapRun(gap: number, middle: number, gaps: number[], spare: number[]): void {
    const minGap = this.ends.note ? LinkRuns.NOTE_MIN_GAP : LinkRuns.DATA_MIN_GAP;
    if (Number.isFinite(gap) && gap >= minGap) {
      (gap < LinkRuns.GAP_WIDE ? gaps : spare).push(middle);
    }
  }

  private isInside(runY: number): boolean {
    const { bands } = this;
    return !bands?.length || (runY > bands[0]!.top && runY < bands.at(-1)!.bottom);
  }

  private freeMiddles(runs: readonly number[], low: number, high: number, minGap: number): number[] {
    const middles: number[] = [];
    for (const runY of runs) {
      const { ceiling, floor } = this.gapAround(runY, low, high);
      const hugged = runY - ceiling <= LinkPath.HUG || floor - runY <= LinkPath.HUG;
      if (hugged && floor - ceiling >= minGap) {
        middles.push(LinkRuns.middleOf(ceiling, floor));
      }
    }
    return middles;
  }

  private gapAround(runY: number, low: number, high: number): { ceiling: number; floor: number } {
    const { artifactBox, targetBox, shapes } = this.ends;
    let ceiling = Number.NEGATIVE_INFINITY;
    let floor = Number.POSITIVE_INFINITY;
    for (const box of shapes) {
      if (box !== artifactBox && box !== targetBox && box.x <= high && box.right >= low) {
        if (box.y < runY && box.bottom <= runY + LinkPath.HUG) {
          ceiling = Math.max(ceiling, box.bottom);
        }
        if (box.bottom > runY && box.y >= runY - LinkPath.HUG) {
          floor = Math.min(floor, box.y);
        }
      }
    }
    return { ceiling, floor };
  }

  private static middleOf(ceiling: number, floor: number): number {
    if (!Number.isFinite(floor)) {
      return Math.round(ceiling + 2 * LinkPath.HUG);
    }
    return Number.isFinite(ceiling) ? Math.round((ceiling + floor) / 2) : Math.round(floor - 2 * LinkPath.HUG);
  }
}
