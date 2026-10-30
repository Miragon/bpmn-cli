import { borderPoint, bottom, center, clamp, cx, right, dedupe, hitCount, toSegments, type Segment } from '../../utils/geom.js';
import type { Box, GNode, Point, ScopeLayout } from '../../di/types.js';
import { ChannelRouter } from './ChannelRouter.js';
import { obstacles, routedArtifacts, routedSegments } from '../../utils/scope.js';
import { isAnnotationLine } from '../../utils/annotations.js';
import { simplify } from '../../utils/routing.js';

/** per px of a link's length */
const LENGTH = 0.002;
/** an annotation line crosses a line rather than take a detour of more than 200 px */
const NOTE_CROSSING = 200 * LENGTH;
/** lines this near (px) read as one */
const NEAR = 6;
/** a run this near (px) a border reads as drawn along it */
const HUG = 5;
/** spare runs lie this far (px) beyond a standard one, once and twice */
const STEP = 10;
/** an annotation line whose two ends lie in one lane leaves it only to save more than 500 px */
const LEAVE = 500 * LENGTH;

/**
 * The lines a link meets: it crosses `crossed`, keeps off `kept` (a spare way off `spareKept` too)
 * and may lie on `joined` but not run just beside it.
 */
interface Lines {
  crossed: Segment[];
  kept: Segment[];
  spareKept: Segment[];
  joined: Segment[];
}

/** the length of a path along its legs */
function pathLength(pts: Point[]): number {
  let len = 0;
  for (const [segmentStart, segmentEnd] of toSegments(pts)) {
    len += Math.abs(segmentEnd.x - segmentStart.x) + Math.abs(segmentEnd.y - segmentStart.y);
  }
  return len;
}

/** how far two parallel legs `from` to NEAR px apart run side by side */
function sideBySide([start, stop]: Segment, [lineStart, lineStop]: Segment, from: number): number {
  const apart = (first: number, second: number): boolean => Math.abs(first - second) >= from && Math.abs(first - second) <= NEAR;
  if (start.y === stop.y && lineStart.y === lineStop.y && apart(start.y, lineStart.y)) {
    return Math.min(Math.max(start.x, stop.x), Math.max(lineStart.x, lineStop.x)) - Math.max(Math.min(start.x, stop.x), Math.min(lineStart.x, lineStop.x));
  }
  if (start.x === stop.x && lineStart.x === lineStop.x && apart(start.x, lineStart.x)) {
    return Math.min(Math.max(start.y, stop.y), Math.max(lineStart.y, lineStop.y)) - Math.max(Math.min(start.y, stop.y), Math.min(lineStart.y, lineStop.y));
  }
  return 0;
}

/** a path lying on a line or running beside it, `from` to NEAR px off it: both read as one line */
function alongLines(pts: Point[], lines: Segment[], from = 0): boolean {
  return toSegments(pts).some((segment) => lines.some((line) => sideBySide(segment, line, from) > 0));
}

/**
 * A path running along the border of a shape or level along a lane border (`borders`), HUG px off
 * it or less; its first leg leaves `from` and its last one enters `to`, so those two count for them.
 */
function onBorder(pts: Point[], shapes: Box[], from: Box, to: Box, borders: number[]): boolean {
  const legs = toSegments(pts);
  return legs.some(([start, stop], index) => {
    if (start.y === stop.y && borders.some((y) => Math.abs(start.y - y) <= HUG)) {
      return true;
    }
    return shapes.some((box) => {
      if ((box === from && index === 0) || (box === to && index === legs.length - 1)) {
        return false;
      }
      if (start.y === stop.y) {
        return (Math.abs(start.y - box.y) <= HUG || Math.abs(start.y - bottom(box)) <= HUG) && Math.min(start.x, stop.x) < right(box) && Math.max(start.x, stop.x) > box.x;
      }
      return start.x === stop.x && (Math.abs(start.x - box.x) <= HUG || Math.abs(start.x - right(box)) <= HUG) && Math.min(start.y, stop.y) < bottom(box) && Math.max(start.y, stop.y) > box.y;
    });
  });
}

/** a single slanted leg */
const isDiagonal = (pts: Point[]): boolean => pts.length === 2 && pts[0]!.x !== pts[1]!.x && pts[0]!.y !== pts[1]!.y;

/** adds a path without repeated points, when it has two at least */
function addPath(paths: Point[][], ...pts: Point[]): void {
  const path = dedupe(pts);
  if (path.length >= 2) paths.push(path);
}

/** Compensation links, associations and data associations; only an annotation line pays for crossing one. */
export class LinkRouter {
  /** `notesPlaced`: ScopeArtifactPlacer placed the scope's notes, so a link keeps off them too */
  constructor(
    private readonly layout: ScopeLayout,
    private readonly notesPlaced = false,
  ) {}

  /** Down from a compensation event to its handler, straight or with a step halfway. */
  static compensationPath(eventBox: Box, handlerBox: Box): Point[] {
    const ex = cx(eventBox);
    let points: Point[];
    if (ex >= handlerBox.x && ex <= handlerBox.x + handlerBox.width) {
      points = [{ x: ex, y: bottom(eventBox) }, { x: ex, y: handlerBox.y }];
    } else {
      const midY = (bottom(eventBox) + handlerBox.y) / 2;
      const hx = cx(handlerBox);
      points = [{ x: ex, y: bottom(eventBox) }, { x: ex, y: midY }, { x: hx, y: midY }, { x: hx, y: handlerBox.y }];
    }
    return points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  }

  route(): void {
    const { layout } = this;
    const placed = this.notesPlaced ? layout.artifacts : routedArtifacts(layout);
    const boxes = obstacles(layout, placed.filter((artifact) => artifact.kind !== 'annotation'));
    const noteBoxes = placed.filter((artifact) => artifact.kind === 'annotation').map((artifact) => artifact.box);
    const flows = routedSegments(layout);
    for (const compensation of layout.compensations) {
      compensation.points = LinkRouter.compensationPath(compensation.event.box, compensation.handler.box);
    }
    const drawn: Segment[] = [];
    /** annotation lines by their target */
    const notes = new Map<Box, Segment[]>();
    for (const artifact of layout.artifacts) {
      for (const link of artifact.links) {
        const other = link.from === artifact ? link.to : link.from;
        const node = other.flow ? undefined : layout.nodes.find((candidate) => candidate.box === other.box) ?? layout.nodes.flatMap((candidate) => candidate.boundary).find((candidate) => candidate.box === other.box);
        const note = isAnnotationLine(link.el);
        const lines = LinkRouter.lines(note, !!other.flow, flows, drawn, notes, other.box);
        const path = this.linkPath(artifact.box, other.box, node, boxes, noteBoxes, lines, other.flow ? 'flow' : 'shape', note);
        const pts = link.from === artifact ? path : [...path].reverse();
        link.points = pts.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
        if (note) {
          notes.set(other.box, [...(notes.get(other.box) ?? []), ...toSegments(link.points)]);
        } else {
          drawn.push(...toSegments(link.points));
        }
      }
    }
  }

  /**
   * An annotation line pays for crossing any line and keeps off them all, but may join the
   * annotation lines into its own target. A line to a flow keeps off the flows and the other links;
   * a data association keeps from running just beside a line, an annotation line too, and its spare
   * ways keep off the flows (lying in a flow hides it).
   */
  private static lines(note: boolean, toFlow: boolean, flows: Segment[], drawn: Segment[], notes: Map<Box, Segment[]>, target: Box): Lines {
    const others = [...flows, ...drawn];
    if (note) {
      const joined = notes.get(target) ?? [];
      const apart = [...notes].flatMap(([box, segments]) => (box === target ? [] : segments));
      return { crossed: [...others, ...apart, ...joined], kept: [...others, ...apart], spareKept: [], joined };
    }
    if (toFlow) return { crossed: others, kept: others, spareKept: [], joined: [] };
    return { crossed: others, kept: [], spareKept: flows, joined: [...others, ...[...notes.values()].flat()] };
  }

  /**
   * The candidate path that cuts the fewest shapes, crosses the fewest lines and is shortest wins;
   * a cut through a note costs half one through a node or a data object. A link keeps off the
   * lines (one lying on or running just beside another hides both). An annotation line also keeps
   * off the borders of shapes and lanes (a data association only on a spare way), crosses a line
   * rather than take a long detour, stays in the lane both its ends lie in and runs square rather
   * than slanted by a little; the order of its candidates only breaks ties. The artifact's own box
   * counts, so a link leaves it outward.
   */
  private linkPath(artifactBox: Box, targetBox: Box, node: GNode | undefined, boxes: Box[], noteBoxes: Box[], lines: Lines, end: 'shape' | 'flow', note: boolean): Point[] {
    const shapes = [...boxes, ...noteBoxes];
    const borders = this.layout.laneBands?.flatMap((band) => [band.top, band.bottom]) ?? [];
    /** an annotation line may join the level legs of the lines into its target */
    const joins = note ? lines.joined.filter(([start, stop]) => start.y === stop.y).map(([start]) => start.y) : [];
    const lane = note ? this.layout.laneBands?.find((band) => [artifactBox, targetBox].every((box) => box.y >= band.top && bottom(box) <= band.bottom)) : undefined;
    const { paths: ways, spare } = this.candidates(artifactBox, targetBox, node, shapes, end, note, joins);
    /** an annotation line has no bend in a straight leg, where it would hide a line it crosses */
    const paths = note ? ways.map(simplify) : ways;
    let best: { pts: Point[]; score: number } | undefined;
    paths.forEach((pts, index) => {
      let score = hitCount(pts, boxes, [targetBox]) * 1000 + hitCount(pts, noteBoxes, [targetBox]) * 500 + ChannelRouter.countCrossings(pts, lines.crossed) * (note ? NOTE_CROSSING : 8) + pathLength(pts) * LENGTH + index * (note ? 0.001 : 0.01);
      if (alongLines(pts, lines.kept) || (index >= spare && alongLines(pts, lines.spareKept)) || alongLines(pts, lines.joined, 1)) {
        score += 300;
      }
      if ((note || index >= spare) && onBorder(pts, shapes, artifactBox, targetBox, borders)) {
        score += note ? 100 : 8;
      }
      if (lane && pts.some((point) => point.y < lane.top || point.y > lane.bottom)) {
        score += LEAVE;
      }
      if (note && isDiagonal(pts)) score += 0.1;
      if (!best || score < best.score) best = { pts, score };
    });
    return best!.pts;
  }

  /**
   * Straight across where the two face each other, a leg level then one down into the target (or
   * the other way round), or straight down into a flow's point.
   */
  private static direct(artifactBox: Box, targetBox: Box, nx: number, end: 'shape' | 'flow'): Point[][] {
    const ac = center(artifactBox), nc = center(targetBox);
    const paths: Point[][] = [];
    const xLo = Math.max(artifactBox.x + 4, targetBox.x + 8), xHi = Math.min(right(artifactBox) - 4, right(targetBox) - 8);
    if (xLo <= xHi) {
      let crossX = Math.min(Math.max(ac.x, xLo), xHi);
      /** it enters where a way coming round does, so two lines into one target join */
      if (Math.abs(crossX - nx) <= 12 && nx >= xLo && nx <= xHi) crossX = nx;
      if (artifactBox.y >= bottom(targetBox)) {
        addPath(paths, { x: crossX, y: artifactBox.y }, { x: crossX, y: bottom(targetBox) });
      } else if (bottom(artifactBox) <= targetBox.y) {
        addPath(paths, { x: crossX, y: bottom(artifactBox) }, { x: crossX, y: targetBox.y });
      }
    }
    const yLo = Math.max(artifactBox.y + 4, targetBox.y + 8), yHi = Math.min(bottom(artifactBox) - 4, bottom(targetBox) - 8);
    if (yLo <= yHi) {
      const crossY = Math.min(Math.max(ac.y, yLo), yHi);
      if (artifactBox.x >= right(targetBox)) {
        addPath(paths, { x: artifactBox.x, y: crossY }, { x: right(targetBox), y: crossY });
      } else if (right(artifactBox) <= targetBox.x) {
        addPath(paths, { x: right(artifactBox), y: crossY }, { x: targetBox.x, y: crossY });
      }
    }
    const ny = ac.y > nc.y ? bottom(targetBox) : targetBox.y;
    const side = ac.x < nc.x ? right(artifactBox) : artifactBox.x;
    const ay = ac.y > nc.y ? artifactBox.y : bottom(artifactBox);
    if (end === 'shape') {
      addPath(paths, { x: side, y: ac.y }, { x: nx, y: ac.y }, { x: nx, y: ny });
      const nSide = ac.x < nc.x ? targetBox.x : right(targetBox);
      addPath(paths, { x: ac.x, y: ay }, { x: ac.x, y: nc.y }, { x: nSide, y: nc.y });
    } else if (nc.x >= artifactBox.x && nc.x <= right(artifactBox)) {
      addPath(paths, { x: nc.x, y: ay }, { x: nc.x, y: nc.y });
    }
    return paths;
  }

  /**
   * The direct ways, the ways that run at a height (see runsOf, and at the `joins` heights) and end
   * over or under the target or beside it, and the plain diagonal BPMN draws by default; the paths
   * from `spare` on run at a spare height or turn 10 px further beside the target.
   */
  private candidates(artifactBox: Box, targetBox: Box, node: GNode | undefined, shapes: Box[], end: 'shape' | 'flow', note: boolean, joins: number[]): { paths: Point[][]; spare: number } {
    const ac = center(artifactBox), nc = center(targetBox);
    const nx = node ? ChannelRouter.dataX(node) : nc.x;
    const cands = LinkRouter.direct(artifactBox, targetBox, nx, end);
    const side = ac.x < nc.x ? right(artifactBox) : artifactBox.x;
    const ay = ac.y > nc.y ? artifactBox.y : bottom(artifactBox);
    /** a line to a flow leaves its note at the flow's x, or as near to it as the note reaches */
    const ex = end === 'shape' ? ac.x : clamp(nc.x, artifactBox.x + 4, right(artifactBox) - 4);
    const runs = this.runsOf(artifactBox, targetBox, ex, ay, end, shapes, note);
    runs.standard.push(...joins);
    const exitTo = (runY: number): Point[] => {
      if (runY > bottom(artifactBox)) {
        return [{ x: ex, y: bottom(artifactBox) }, { x: ex, y: runY }];
      }
      if (runY < artifactBox.y) {
        return [{ x: ex, y: artifactBox.y }, { x: ex, y: runY }];
      }
      return [{ x: side, y: runY }];
    };
    /** the side of the target towards the artifact */
    const near = ex < nc.x ? -1 : 1;
    /** a run ends over or under the target, or on its near side when it runs at the target's height */
    const down = (runY: number): Point[] => {
      if (runY > targetBox.y && runY < bottom(targetBox)) {
        return [...exitTo(runY), { x: near < 0 ? targetBox.x : right(targetBox), y: runY }];
      }
      return [...exitTo(runY), { x: nx, y: runY }, { x: nx, y: runY > nc.y ? bottom(targetBox) : targetBox.y }];
    };
    /**
     * or it turns beside the target (see turnX) and enters it level; at the target's height only on
     * the near side. Into a flow's point it turns so only from a run 10 px or more off it, and on the
     * far side only from 20 px or more (a turn nearer to it jogs or hooks back across the flow).
     */
    const beside = (runY: number, turn = 20): Point[][] => {
      const way = (dir: number): Point[] => {
        let enterX = nc.x;
        if (end === 'shape') enterX = dir < 0 ? targetBox.x : right(targetBox);
        const turnX = LinkRouter.turnX(enterX, dir * turn, runY, nc.y, shapes, targetBox);
        return [...exitTo(runY), { x: turnX, y: runY }, { x: turnX, y: nc.y }, { x: enterX, y: nc.y }];
      };
      if (end === 'shape') {
        return runY < targetBox.y || runY > bottom(targetBox) ? [way(near), way(-near)] : [way(near)];
      }
      const off = Math.abs(runY - nc.y);
      if (off < 10) return [];
      return off < 20 ? [way(near)] : [way(near), way(-near)];
    };
    const later: Point[][] = [];
    const extra: Point[][] = [];
    for (const runY of runs.standard) {
      const [nearSide, farSide] = beside(runY);
      addPath(cands, ...down(runY));
      if (nearSide) addPath(cands, ...nearSide);
      if (farSide) later.push(farSide);
      extra.push(...beside(runY, 20 + STEP));
    }
    cands.push([borderPoint(artifactBox, nc), end === 'flow' ? nc : borderPoint(targetBox, ac)]);
    for (const runY of runs.gaps) {
      later.push(down(runY), ...beside(runY));
      extra.push(...beside(runY, 20 + STEP));
    }
    for (const runY of runs.spare) {
      extra.push(down(runY), ...beside(runY), ...beside(runY, 20 + STEP));
    }
    for (const path of later) {
      addPath(cands, ...path);
    }
    const spare = cands.length;
    for (const path of extra) {
      addPath(cands, ...path);
    }
    return { paths: cands, spare };
  }

  /**
   * `turn` px beside `enterX` (negative: left of it), or the middle of the gap to a shape the leg
   * from `runY` to `y` would pass HUG px off or nearer, so it does not run along that shape's border
   * (in a gap narrower than 8 px it would merge with both borders).
   */
  private static turnX(enterX: number, turn: number, runY: number, y: number, shapes: Box[], targetBox: Box): number {
    let gap = Math.abs(turn) + HUG;
    for (const box of shapes) {
      if (box === targetBox || box.y >= Math.max(runY, y) || bottom(box) <= Math.min(runY, y)) {
        continue;
      }
      const edge = turn < 0 ? enterX - right(box) : box.x - enterX;
      if (edge >= 0 && edge < gap) gap = edge;
    }
    return enterX + Math.sign(turn) * (gap >= 8 && gap < Math.abs(turn) + HUG ? Math.round(gap / 2) : Math.abs(turn));
  }

  /**
   * The heights a path runs at. Standard: level with the artifact (with a flow's point and halfway
   * to it too), just under and over it, under every box between the two ends and under the boxes
   * above the target. Gaps: the middle of a gap under or over the artifact narrower than 30 px,
   * which an annotation line takes only 12 px wide or wider, a data association 4 px. Spare: see
   * spareRuns, inside the lanes.
   */
  private runsOf(artifactBox: Box, targetBox: Box, ex: number, ay: number, end: 'shape' | 'flow', shapes: Box[], note: boolean): { standard: number[]; gaps: number[]; spare: number[] } {
    const nc = center(targetBox);
    const lo = Math.min(ex, nc.x), hi = Math.max(ex, nc.x);
    let under = Math.max(bottom(artifactBox), bottom(targetBox));
    /** the boxes above the target end here: a run under a taller note beside this one in the band */
    let over = bottom(artifactBox);
    /** the nearest boxes under and over the artifact */
    let below = Infinity, above = -Infinity;
    for (const box of shapes) {
      if (box === artifactBox || box.x > hi || right(box) < lo) continue;
      if (box.y >= bottom(artifactBox)) below = Math.min(below, box.y);
      if (bottom(box) <= artifactBox.y) above = Math.max(above, bottom(box));
      if (box !== targetBox) {
        under = Math.max(under, bottom(box));
        if (bottom(box) < targetBox.y) over = Math.max(over, bottom(box));
      }
    }
    under += 20;
    /** a laned scope's top is its first lane's top border; a pool without lanes or a sub-process has padding above it */
    const roomAbove = artifactBox.y >= 15 || !this.layout.laneBands;
    const standard = [center(artifactBox).y, ...(end === 'flow' ? [nc.y, (ay + nc.y) / 2] : []), bottom(artifactBox) + 15, ...(roomAbove ? [artifactBox.y - 15] : []), under];
    const minGap = note ? 12 : 4;
    const gaps: number[] = [];
    const spare: number[] = [];
    const gapRun = (gap: number, middle: number): void => {
      if (!Number.isFinite(gap) || gap < minGap) return;
      (gap < 30 ? gaps : spare).push(middle);
    };
    gapRun(below - bottom(artifactBox), Math.round((below + bottom(artifactBox)) / 2));
    if (roomAbove) {
      gapRun(artifactBox.y - above, Math.round((above + artifactBox.y) / 2));
    }
    spare.push(...LinkRouter.spareRuns(artifactBox, under, roomAbove));
    if (bottom(artifactBox) < targetBox.y && over > bottom(artifactBox)) {
      standard.push(over + 15);
      spare.push(over + 15 + STEP, over + 15 + 2 * STEP);
    }
    spare.push(...LinkRouter.freeMiddles(standard, artifactBox, targetBox, shapes, lo, hi, minGap));
    const bands = this.layout.laneBands;
    const inside = (runY: number): boolean => !bands?.length || (runY > bands[0]!.top && runY < bands[bands.length - 1]!.bottom);
    return { standard, gaps, spare: spare.filter(inside) };
  }

  /**
   * Spare heights, free when another line took a standard one: one and two steps further out than
   * the runs under and over the artifact and under everything, a step over that last one (inside a
   * lane whose bottom is near) and a step off its middle.
   */
  private static spareRuns(artifactBox: Box, under: number, roomAbove: boolean): number[] {
    const spare: number[] = [under - STEP];
    for (const step of [STEP, 2 * STEP]) {
      spare.push(bottom(artifactBox) + 15 + step, under + step);
      if (roomAbove && artifactBox.y >= 15 + step) {
        spare.push(artifactBox.y - 15 - step);
      }
    }
    if (STEP < artifactBox.height / 2 - 4) {
      spare.push(center(artifactBox).y - STEP, center(artifactBox).y + STEP);
    }
    return spare;
  }

  /**
   * Spare heights too: the middle of the gap a standard run lies in when that run is HUG px or less
   * off a box between `lo` and `hi` (and the gap at least `minGap` wide).
   */
  private static freeMiddles(runs: number[], artifactBox: Box, targetBox: Box, shapes: Box[], lo: number, hi: number, minGap: number): number[] {
    const middles: number[] = [];
    for (const runY of runs) {
      let ceiling = -Infinity, floor = Infinity;
      for (const box of shapes) {
        if (box === artifactBox || box === targetBox || box.x > hi || right(box) < lo) {
          continue;
        }
        if (box.y < runY && bottom(box) <= runY + HUG) {
          ceiling = Math.max(ceiling, bottom(box));
        }
        if (bottom(box) > runY && box.y >= runY - HUG) floor = Math.min(floor, box.y);
      }
      if ((runY - ceiling > HUG && floor - runY > HUG) || floor - ceiling < minGap) {
        continue;
      }
      if (!Number.isFinite(floor)) {
        middles.push(Math.round(ceiling + 2 * HUG));
      } else if (!Number.isFinite(ceiling)) {
        middles.push(Math.round(floor - 2 * HUG));
      } else {
        middles.push(Math.round((ceiling + floor) / 2));
      }
    }
    return middles;
  }
}
