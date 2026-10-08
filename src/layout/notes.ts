/**
 * Text annotations owned by a collaboration (not by a process) in the clean
 * engine: they are placed after everything else, next to the element they
 * are associated with. Pure geometry on absolute boxes.
 *
 * Contract of `placeCollaborationNotes(jobs, world)`:
 *  - returns one box per job, in job order; deterministic
 *  - a note anchored to an element inside a pool stays inside `pool` (the
 *    caller passes the pool's content area, or the element's lane in it); a
 *    note anchored to a pool (or to a message flow, or to nothing) stays
 *    outside every pool
 *  - candidates, first free wins: above the anchor, right of it, left of
 *    it, below it, then stepping sideways above and below; free = no overlap
 *    with a shape, a label or an earlier note (6 px margin) and no drawn line
 *    through it
 *  - no free spot: right of the whole drawing, just above the anchor's
 *    height, below the notes already there (nothing is ever dropped)
 */
import type { Seg } from './messages.js';
import type { Box } from './types.js';

export interface NoteJob {
  width: number;
  height: number;
  /** the associated element (a zero-size box for a point on a flow); none: unanchored */
  anchor?: Box;
  /** the pool the anchor lies in (undefined: the anchor is a pool, a message flow or nothing) */
  pool?: Box;
}

export interface NoteWorld {
  /** shapes and labels a note must not cover */
  obstacles: Box[];
  /** drawn edges */
  lines: Seg[];
  /** every pool */
  pools: Box[];
}

const GAP = 16;
const MARGIN = 6;

function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}

function inside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function lineThrough([p, q]: Seg, b: Box): boolean {
  return Math.min(p.x, q.x) < b.x + b.width + 2 && Math.max(p.x, q.x) > b.x - 2 && Math.min(p.y, q.y) < b.y + b.height + 2 && Math.max(p.y, q.y) > b.y - 2;
}

/** Candidate boxes around an anchor, in preference order: above, beside, below, then stepping sideways above and below. */
function candidates(job: NoteJob, a: Box): Box[] {
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

/** Places every note (see the module contract). */
export function placeCollaborationNotes(jobs: NoteJob[], world: NoteWorld): Box[] {
  const taken: Box[] = [];
  const right = Math.max(0, ...world.pools.map((p) => p.x + p.width), ...world.obstacles.map((o) => o.x + o.width)) + 40;
  const top = Math.max(0, Math.min(...world.pools.map((p) => p.y), ...world.obstacles.map((o) => o.y)));
  let fallbackY = top;
  const free = (job: NoteJob, b: Box): boolean => {
    if (b.x < 0 || b.y < 0) return false;
    if (job.pool ? !inside(b, job.pool) : world.pools.some((p) => overlaps(b, p, 0))) return false;
    if ([...world.obstacles, ...taken].some((o) => overlaps(b, o, MARGIN))) return false;
    return !world.lines.some((s) => lineThrough(s, b));
  };
  return jobs.map((job) => {
    const spot = job.anchor ? candidates(job, job.anchor).find((b) => free(job, b)) : undefined;
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
