import type { Box } from '../../di/types.js';
import { overlaps, segmentHitsBox, type Segment } from '../../utils/geom.js';

export interface NoteJob {
  width: number;
  height: number;
  /** a zero-size box for a point on a flow */
  anchor?: Box;
  /** undefined when the anchor is a pool, a message flow or nothing */
  pool?: Box;
}

export interface NoteWorld {
  obstacles: Box[];
  lines: Segment[];
  pools: Box[];
}

const GAP = 16;
const MARGIN = 6;

/**
 * Places collaboration-owned text annotations next to their element after everything else:
 * above, beside, then below; a note inside a pool stays in it, others stay outside every pool.
 * With no free spot a note goes right of the whole drawing, so none is ever dropped.
 */
export class NotePlacer {
  constructor(private readonly world: NoteWorld) {}

  /**
   * A note without a free spot goes right of everything, above its anchor's height, so the
   * association does not run along the anchor's own flows.
   */
  place(jobs: NoteJob[]): Box[] {
    const { world } = this;
    const taken: Box[] = [];
    const right = Math.max(0, ...world.pools.map((pool) => pool.x + pool.width), ...world.obstacles.map((obstacle) => obstacle.x + obstacle.width)) + 40;
    const top = Math.max(0, Math.min(...world.pools.map((pool) => pool.y), ...world.obstacles.map((obstacle) => obstacle.y)));
    let fallbackY = top;
    const free = (job: NoteJob, box: Box): boolean => {
      if (box.x < 0 || box.y < 0) return false;
      if (job.pool ? !this.inside(box, job.pool) : world.pools.some((pool) => overlaps(box, pool, 0))) return false;
      if ([...world.obstacles, ...taken].some((obstacle) => overlaps(box, obstacle, MARGIN))) return false;
      return !world.lines.some(([start, end]) => segmentHitsBox(start, end, box, -2));
    };
    return jobs.map((job) => {
      const spot = job.anchor ? this.candidates(job, job.anchor).find((candidate) => free(job, candidate)) : undefined;
      let box = spot;
      if (!box) {
        const fallbackTop = Math.max(fallbackY, job.anchor ? Math.round(job.anchor.y - job.height - 8) : fallbackY);
        box = { x: right, y: fallbackTop, width: job.width, height: job.height };
        fallbackY = fallbackTop + job.height + 20;
      }
      taken.push(box);
      return box;
    });
  }

  private inside(inner: Box, outer: Box): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  }

  private candidates(job: NoteJob, anchor: Box): Box[] {
    const { width, height } = job;
    const cx = anchor.x + anchor.width / 2, cy = anchor.y + anchor.height / 2;
    const above = anchor.y - GAP - height;
    const anchorLabelLine = 14;
    const below = anchor.y + anchor.height + GAP + anchorLabelLine;
    const at = (top: number, step: number): Box => ({ x: Math.round(cx - width / 2 + step * (width / 2 + 20)), y: Math.round(top), width, height });
    const out: Box[] = [at(above, 0)];
    out.push({ x: Math.round(anchor.x + anchor.width + GAP + 20), y: Math.round(cy - height / 2), width, height });
    out.push({ x: Math.round(anchor.x - GAP - 20 - width), y: Math.round(cy - height / 2), width, height });
    out.push(at(below, 0));
    for (const top of [above, below]) for (let step = 1; step <= 6; step++) out.push(at(top, step), at(top, -step));
    return out;
  }
}
