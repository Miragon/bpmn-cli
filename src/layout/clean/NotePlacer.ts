import type { Box } from '../../drawing/types.js';
import type { Segment } from './utils/geometry.js';

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

  place(jobs: NoteJob[]): Box[] {
    const { world } = this;
    const taken: Box[] = [];
    const right = Math.max(0, ...world.pools.map((p) => p.x + p.width), ...world.obstacles.map((o) => o.x + o.width)) + 40;
    const top = Math.max(0, Math.min(...world.pools.map((p) => p.y), ...world.obstacles.map((o) => o.y)));
    let fallbackY = top;
    const free = (job: NoteJob, b: Box): boolean => {
      if (b.x < 0 || b.y < 0) return false;
      if (job.pool ? !this.inside(b, job.pool) : world.pools.some((p) => this.overlaps(b, p, 0))) return false;
      if ([...world.obstacles, ...taken].some((o) => this.overlaps(b, o, MARGIN))) return false;
      return !world.lines.some((s) => this.lineThrough(s, b));
    };
    return jobs.map((job) => {
      const spot = job.anchor ? this.candidates(job, job.anchor).find((b) => free(job, b)) : undefined;
      let box = spot;
      if (!box) {
        // above the anchor's height, so the association does not run along the anchor's own flows
        const y = Math.max(fallbackY, job.anchor ? Math.round(job.anchor.y - job.height - 8) : fallbackY);
        box = { x: right, y, width: job.width, height: job.height };
        fallbackY = y + job.height + 20;
      }
      taken.push(box);
      return box;
    });
  }

  private overlaps(a: Box, b: Box, margin: number): boolean {
    return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
  }

  private inside(inner: Box, outer: Box): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  }

  private lineThrough([p, q]: Segment, b: Box): boolean {
    return Math.min(p.x, q.x) < b.x + b.width + 2 && Math.max(p.x, q.x) > b.x - 2 && Math.min(p.y, q.y) < b.y + b.height + 2 && Math.max(p.y, q.y) > b.y - 2;
  }

  private candidates(job: NoteJob, a: Box): Box[] {
    const { width, height } = job;
    const cx = a.x + a.width / 2, cy = a.y + a.height / 2;
    const above = a.y - GAP - height;
    const below = a.y + a.height + GAP + 14; // below the anchor's own label line
    const at = (y: number, step: number): Box => ({ x: Math.round(cx - width / 2 + step * (width / 2 + 20)), y: Math.round(y), width, height });
    const out: Box[] = [at(above, 0)];
    out.push({ x: Math.round(a.x + a.width + GAP + 20), y: Math.round(cy - height / 2), width, height });
    out.push({ x: Math.round(a.x - GAP - 20 - width), y: Math.round(cy - height / 2), width, height });
    out.push(at(below, 0));
    for (const y of [above, below]) for (let step = 1; step <= 6; step++) out.push(at(y, step), at(y, -step));
    return out;
  }
}
