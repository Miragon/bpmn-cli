import { is, type El } from '../../document/utils/moddle.js';
import type { Box, Point } from './types.js';
import { cx, cy, segmentsCross } from '../utils/geom.js';
import { collinear, cuts, drawnEnds, glyph, hits, joinTail, ptIn, readDrawnPlane, segs, subTitleOf, type Edge, type Seg, type Shape } from '../utils/harness.js';
import { idOf, raw, rawList } from '../utils/raw.js';
import type { LayoutProblem } from '../utils/problems.js';

interface LocPlane {
  root: string;
  shapes: Map<string, Shape>;
  edges: Map<string, Edge>;
}

/**
 * Finds where each layout problem shows, for `bpmn render --problems` badges. A separate pass,
 * so the measurement every mutation runs never carries coordinates.
 */
export class ProblemLocator {
  private readonly planes: LocPlane[] = [];

  constructor(private readonly defs: El) {
    for (const diagram of rawList(defs, 'diagrams')) {
      const plane = raw(diagram, 'plane');
      const root = this.planeRoot(plane);
      if (!root) continue;
      const { shapes, edges } = readDrawnPlane(plane, new Set());
      this.planes.push({ root, shapes: new Map(shapes.map((shape) => [shape.id, shape])), edges: new Map(edges.map((edge) => [edge.id, edge])) });
    }
  }

  /** Adds `at`; the problems themselves are not changed. */
  locate(problems: readonly LayoutProblem[]): LayoutProblem[] {
    return problems.map((problem) => {
      const first = problem.ids[0];
      const pl = first === undefined ? undefined : this.planes.find((plane) => plane.shapes.has(first) || plane.edges.has(first));
      const at = pl ? this.at(problem, pl) : undefined;
      const round = (coordinate: number): number => Math.round(coordinate * 100) / 100 || 0;
      return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { ...problem, at: { plane: pl!.root, x: round(at.x), y: round(at.y) } } : { ...problem };
    });
  }

  private midpoint(from: Point, to: Point): Point {
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }

  private centreOf(box: Box): Point {
    return { x: cx(box), y: cy(box) };
  }

  /** the first box's centre when they do not meet */
  private meetCentre(first: Box, second: Box): Point {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const width = Math.min(first.x + first.width, second.x + second.width) - left;
    const height = Math.min(first.y + first.height, second.y + second.height) - top;
    return width >= 0 && height >= 0 ? { x: left + width / 2, y: top + height / 2 } : this.centreOf(first);
  }

  private crossPoint([firstStart, firstEnd]: Seg, [secondStart, secondEnd]: Seg): Point {
    const den = (firstEnd.x - firstStart.x) * (secondEnd.y - secondStart.y) - (firstEnd.y - firstStart.y) * (secondEnd.x - secondStart.x);
    const progress = den ? ((secondStart.x - firstStart.x) * (secondEnd.y - secondStart.y) - (secondStart.y - firstStart.y) * (secondEnd.x - secondStart.x)) / den : 0.5;
    return { x: firstStart.x + progress * (firstEnd.x - firstStart.x), y: firstStart.y + progress * (firstEnd.y - firstStart.y) };
  }

  /** the middle of the part of a segment inside the box shrunk by `shrink` */
  private clipMiddle(seg: Seg, box: Box, shrink: number): Point {
    const [segmentStart, segmentEnd] = seg;
    const dx = segmentEnd.x - segmentStart.x;
    const dy = segmentEnd.y - segmentStart.y;
    let lo = 0;
    let hi = 1;
    for (const [delta, start, min, max] of [
      [dx, segmentStart.x, box.x + shrink, box.x + box.width - shrink],
      [dy, segmentStart.y, box.y + shrink, box.y + box.height - shrink],
    ] as const) {
      if (delta === 0) {
        if (start < min || start > max) hi = -1;
        continue;
      }
      const t0 = (min - start) / delta;
      const t1 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
    if (lo <= hi) return { x: segmentStart.x + ((lo + hi) / 2) * dx, y: segmentStart.y + ((lo + hi) / 2) * dy };
    return this.meetCentre({ x: Math.min(segmentStart.x, segmentEnd.x), y: Math.min(segmentStart.y, segmentEnd.y), width: Math.abs(dx), height: Math.abs(dy) }, box);
  }

  /** the first run two edges share on one line, skipping the segment pairs in `skip` */
  private sharedAt(first: Edge, second: Edge, skip = new Set<string>()): Point | undefined {
    for (const [firstIndex, [firstStart, firstEnd]] of first.segs.entries()) {
      for (const [secondIndex, [secondStart, secondEnd]] of second.segs.entries()) {
        if (skip.has(`${firstIndex},${secondIndex}`) || collinear([firstStart, firstEnd], [secondStart, secondEnd]) <= 0) continue;
        if (firstStart.x === firstEnd.x) return { x: firstStart.x, y: (Math.max(Math.min(firstStart.y, firstEnd.y), Math.min(secondStart.y, secondEnd.y)) + Math.min(Math.max(firstStart.y, firstEnd.y), Math.max(secondStart.y, secondEnd.y))) / 2 };
        return { x: (Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x)) + Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x))) / 2, y: firstStart.y };
      }
    }
    return undefined;
  }

  private halfway(pts: Point[]): Point | undefined {
    const parts = segs(pts);
    let rest = parts.reduce((sum, [start, end]) => sum + Math.hypot(end.x - start.x, end.y - start.y), 0) / 2;
    for (const [start, end] of parts) {
      const len = Math.hypot(end.x - start.x, end.y - start.y);
      if (len >= rest && len > 0) return { x: start.x + ((end.x - start.x) * rest) / len, y: start.y + ((end.y - start.y) * rest) / len };
      rest -= len;
    }
    return pts[0];
  }

  /**
   * On the defect itself, using the same tests as the checks.
   * For a segment overlap a join's common tail does not count, so the badge goes on the run that
   * does.
   */
  private at(problem: LayoutProblem, pl: LocPlane): Point | undefined {
    const [firstId, secondId] = problem.ids;
    const sa = firstId === undefined ? undefined : pl.shapes.get(firstId);
    const sb = secondId === undefined ? undefined : pl.shapes.get(secondId);
    const ea = firstId === undefined ? undefined : pl.edges.get(firstId);
    const eb = secondId === undefined ? undefined : pl.edges.get(secondId);
    const labelOf = (id: string | undefined): Box | undefined => (id === undefined ? undefined : (pl.shapes.get(id)?.label ?? pl.edges.get(id)?.label));
    switch (problem.kind) {
      case 'crossings':
        for (const firstSegment of ea?.segs ?? []) for (const secondSegment of eb?.segs ?? []) if (segmentsCross(...firstSegment, ...secondSegment)) return this.crossPoint(firstSegment, secondSegment);
        return undefined;
      case 'overlaps':
      case 'frameOverlap':
        return sa && sb ? this.meetCentre(sa.bounds, sb.bounds) : undefined;
      case 'frameIntrusion':
      case 'outsideLane':
      case 'outsidePool':
      case 'outsideSub':
        return sa ? this.centreOf(sa.bounds) : undefined;
      case 'through': {
        const seg = sb ? ea?.segs.find((segment) => cuts(segment, sb.bounds)) : undefined;
        return seg && sb ? this.clipMiddle(seg, sb.bounds, 2) : undefined;
      }
      case 'msgThroughPool': {
        const seg = sb ? ea?.segs.find((segment) => hits(segment, sb.bounds)) : undefined;
        return seg && sb ? this.clipMiddle(seg, sb.bounds, 2) : undefined;
      }
      case 'diagonal': {
        const seg = ea?.segs.find(([start, end]) => start.x !== end.x && start.y !== end.y);
        return seg ? this.midpoint(seg[0], seg[1]) : undefined;
      }
      case 'degenerateEdge':
        return ea?.pts[0];
      case 'detachedEdge': {
        if (!ea || ea.pts.length < 2) return undefined;
        return drawnEnds(ea.el)[0] === secondId ? ea.pts[0] : ea.pts[ea.pts.length - 1];
      }
      case 'labelClash': {
        const own = labelOf(firstId);
        const other = problem.detail === 'label on label' ? labelOf(secondId) : sb?.bounds;
        return own && other ? this.meetCentre(own, other) : undefined;
      }
      case 'labelOnLine': {
        const own = labelOf(firstId);
        const owner = sa ?? ea;
        if (!own || !owner) return undefined;
        const text = glyph(own, raw<string>(owner.el, 'name') || '');
        const seg = eb?.segs.find((segment) => hits(segment, text, 0));
        return seg ? this.clipMiddle(seg, text, 0) : undefined;
      }
      case 'inOut':
      case 'parallelRun':
        return ea && eb ? this.sharedAt(ea, eb) : undefined;
      case 'segmentOverlap':
        return ea && eb ? this.sharedAt(ea, eb, joinTail(ea, eb, pl.shapes.get(problem.ids[2] ?? ''))) : undefined;
      case 'edgeLeavesLane':
      case 'edgeOutside':
        return sb ? ea?.pts.find((point) => !ptIn(point, sb.bounds)) : undefined;
      case 'laneGap':
        if (!sa || !sb) return undefined;
        return problem.detail === 'bottom' ? { x: cx(sa.bounds), y: (sa.bounds.y + sa.bounds.height + sb.bounds.y + sb.bounds.height) / 2 } : { x: cx(sa.bounds), y: (sa.bounds.y + sb.bounds.y) / 2 };
      case 'backwardFlow':
        return ea ? this.halfway(ea.pts) : undefined;
      case 'labelOutsideFrame':
      case 'messageLabelFar': {
        const own = labelOf(firstId);
        return own ? this.centreOf(own) : undefined;
      }
      case 'labelOnTitle': {
        const own = labelOf(firstId);
        const title = sb ? subTitleOf(sb) : undefined;
        return own && title ? this.meetCentre(own, title) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** A plane without bpmnElement shows the first process or collaboration, as in bpmn-js. */
  private planeRoot(plane: unknown): string | undefined {
    return idOf(raw(plane, 'bpmnElement')) ?? idOf(rawList(this.defs, 'rootElements').find((root) => is(root, 'bpmn:Process') || is(root, 'bpmn:Collaboration')));
  }
}
