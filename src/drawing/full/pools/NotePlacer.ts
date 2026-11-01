import { Box, type Segment } from '../../../model/index.js';

export interface NoteJob {
  width: number;
  height: number;
  anchor?: Box;
  pool?: Box;
}

export interface NoteWorld {
  obstacles: Box[];
  lines: Segment[];
  pools: Box[];
}

export class NotePlacer {
  private static readonly GAP = 16;
  private static readonly MARGIN = 6;
  private static readonly SIDE_ROOM = 20;
  private static readonly ANCHOR_LABEL_LINE = 14;
  private static readonly RIGHT_OF_ALL = 40;
  private static readonly ABOVE_FALLBACK = 8;
  private static readonly STACK_GAP = 20;
  private static readonly STEPS = 6;

  private readonly taken: Box[] = [];

  constructor(private readonly world: NoteWorld) {}

  private static isInside(inner: Box, outer: Box): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.right <= outer.right && inner.bottom <= outer.bottom;
  }

  private static candidates({ width, height }: NoteJob, anchor: Box): Box[] {
    const { GAP, SIDE_ROOM, ANCHOR_LABEL_LINE, STEPS } = NotePlacer;
    const { center } = anchor;
    const above = anchor.y - GAP - height;
    const below = anchor.bottom + GAP + ANCHOR_LABEL_LINE;
    const at = (top: number, step: number): Box => new Box(Math.round(center.x - width / 2 + step * (width / 2 + SIDE_ROOM)), Math.round(top), width, height);
    const beside = (left: number): Box => new Box(Math.round(left), Math.round(center.y - height / 2), width, height);
    const spots = [at(above, 0), beside(anchor.right + GAP + SIDE_ROOM), beside(anchor.x - GAP - SIDE_ROOM - width), at(below, 0)];
    for (const top of [above, below]) {
      for (let step = 1; step <= STEPS; step++) {
        spots.push(at(top, step), at(top, -step));
      }
    }
    return spots;
  }

  place(jobs: readonly NoteJob[]): Box[] {
    const { world } = this;
    const right = Math.max(0, ...world.pools.map((pool) => pool.right), ...world.obstacles.map((obstacle) => obstacle.right)) + NotePlacer.RIGHT_OF_ALL;
    let fallbackY = Math.max(0, Math.min(...world.pools.map((pool) => pool.y), ...world.obstacles.map((obstacle) => obstacle.y)));
    return jobs.map((job) => {
      const spot = job.anchor && NotePlacer.candidates(job, job.anchor).find((candidate) => this.isFree(job, candidate));
      if (spot) {
        this.taken.push(spot);
        return spot;
      }
      const top = Math.max(fallbackY, job.anchor ? Math.round(job.anchor.y - job.height - NotePlacer.ABOVE_FALLBACK) : fallbackY);
      fallbackY = top + job.height + NotePlacer.STACK_GAP;
      const box = new Box(right, top, job.width, job.height);
      this.taken.push(box);
      return box;
    });
  }

  private isFree(job: NoteJob, box: Box): boolean {
    const { world } = this;
    if (box.x < 0 || box.y < 0) {
      return false;
    }
    if (job.pool ? !NotePlacer.isInside(box, job.pool) : world.pools.some((pool) => box.overlaps(pool, 0))) {
      return false;
    }
    return ![...world.obstacles, ...this.taken].some((obstacle) => box.overlaps(obstacle, NotePlacer.MARGIN)) && !world.lines.some((line) => line.hitsBounds(box, -2));
  }
}
