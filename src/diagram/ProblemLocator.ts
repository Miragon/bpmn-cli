import { is, type El } from '../model/utils/moddle.js';
import type { Box, Point } from './types.js';
import { segmentsCross } from './utils/geom.js';
import { collinear, cuts, drawnEnds, glyph, hits, joinTail, ptIn, readDrawnPlane, segs, subTitleOf, type Edge, type Seg, type Shape } from './utils/harness.js';
import { idOf, raw, rawList } from './utils/plane.js';
import type { LayoutProblem } from './utils/problems.js';

interface LocPlane {
  root: string;
  shapes: Map<string, Shape>;
  edges: Map<string, Edge>;
}

export class ProblemLocator {
  private readonly planes: LocPlane[] = [];

  constructor(private readonly defs: El) {
    for (const diagram of rawList(defs, 'diagrams')) {
      const plane = raw(diagram, 'plane');
      const root = this.planeRoot(plane);
      if (!root) continue;
      const { shapes, edges } = readDrawnPlane(plane, new Set());
      this.planes.push({ root, shapes: new Map(shapes.map((x) => [x.id, x])), edges: new Map(edges.map((x) => [x.id, x])) });
    }
  }

  /** The problems with where each shows (`at`; see contract); the problems themselves are not changed. */
  locate(problems: readonly LayoutProblem[]): LayoutProblem[] {
    return problems.map((p) => {
      const first = p.ids[0];
      const pl = first === undefined ? undefined : this.planes.find((x) => x.shapes.has(first) || x.edges.has(first));
      const at = pl ? this.at(p, pl) : undefined;
      const round = (v: number): number => Math.round(v * 100) / 100 || 0;
      return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { ...p, at: { plane: pl!.root, x: round(at.x), y: round(at.y) } } : { ...p };
    });
  }

  private midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private centreOf(b: Box): Point {
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /** the centre of the common part of two boxes (of the first box when they do not meet) */
  private meetCentre(a: Box, b: Box): Point {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.width, b.x + b.width) - x;
    const h = Math.min(a.y + a.height, b.y + b.height) - y;
    return w >= 0 && h >= 0 ? { x: x + w / 2, y: y + h / 2 } : this.centreOf(a);
  }

  /** the crossing point of two properly crossing segments */
  private crossPoint([a, b]: Seg, [c, d]: Seg): Point {
    const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    const t = den ? ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den : 0.5;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }

  /** the middle of the part of a segment inside the box shrunk by `shrink` (a bounding-box hit: the centre of the segment's box inside it) */
  private clipMiddle(seg: Seg, b: Box, shrink: number): Point {
    const [p, q] = seg;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    let lo = 0;
    let hi = 1;
    for (const [d, start, min, max] of [
      [dx, p.x, b.x + shrink, b.x + b.width - shrink],
      [dy, p.y, b.y + shrink, b.y + b.height - shrink],
    ] as const) {
      if (d === 0) {
        if (start < min || start > max) hi = -1;
        continue;
      }
      const t0 = (min - start) / d;
      const t1 = (max - start) / d;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
    if (lo <= hi) return { x: p.x + ((lo + hi) / 2) * dx, y: p.y + ((lo + hi) / 2) * dy };
    return this.meetCentre({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(dx), height: Math.abs(dy) }, b);
  }

  /** the middle of the first run two edges share on one line, skipping the segment pairs in `skip` (`i,j`) */
  private sharedAt(a: Edge, b: Edge, skip = new Set<string>()): Point | undefined {
    for (const [i, [p, q]] of a.segs.entries()) {
      for (const [j, [r, t]] of b.segs.entries()) {
        if (skip.has(`${i},${j}`) || collinear([p, q], [r, t]) <= 0) continue;
        if (p.x === q.x) return { x: p.x, y: (Math.max(Math.min(p.y, q.y), Math.min(r.y, t.y)) + Math.min(Math.max(p.y, q.y), Math.max(r.y, t.y))) / 2 };
        return { x: (Math.max(Math.min(p.x, q.x), Math.min(r.x, t.x)) + Math.min(Math.max(p.x, q.x), Math.max(r.x, t.x))) / 2, y: p.y };
      }
    }
    return undefined;
  }

  /** the point half-way along a polyline */
  private halfway(pts: Point[]): Point | undefined {
    const parts = segs(pts);
    let rest = parts.reduce((sum, [p, q]) => sum + Math.hypot(q.x - p.x, q.y - p.y), 0) / 2;
    for (const [p, q] of parts) {
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len >= rest && len > 0) return { x: p.x + ((q.x - p.x) * rest) / len, y: p.y + ((q.y - p.y) * rest) / len };
      rest -= len;
    }
    return pts[0];
  }

  /** Where one problem shows on its plane (see contract). */
  private at(p: LayoutProblem, pl: LocPlane): Point | undefined {
    const [a, b] = p.ids;
    const sa = a === undefined ? undefined : pl.shapes.get(a);
    const sb = b === undefined ? undefined : pl.shapes.get(b);
    const ea = a === undefined ? undefined : pl.edges.get(a);
    const eb = b === undefined ? undefined : pl.edges.get(b);
    const labelOf = (id: string | undefined): Box | undefined => (id === undefined ? undefined : (pl.shapes.get(id)?.label ?? pl.edges.get(id)?.label));
    switch (p.kind) {
      case 'crossings':
        for (const x of ea?.segs ?? []) for (const y of eb?.segs ?? []) if (segmentsCross(...x, ...y)) return this.crossPoint(x, y);
        return undefined;
      case 'overlaps':
      case 'frameOverlap':
        return sa && sb ? this.meetCentre(sa.b, sb.b) : undefined;
      case 'frameIntrusion':
      case 'outsideLane':
      case 'outsidePool':
      case 'outsideSub':
        return sa ? this.centreOf(sa.b) : undefined;
      case 'through': {
        const seg = sb ? ea?.segs.find((s) => cuts(s, sb.b)) : undefined;
        return seg && sb ? this.clipMiddle(seg, sb.b, 2) : undefined;
      }
      case 'msgThroughPool': {
        const seg = sb ? ea?.segs.find((s) => hits(s, sb.b)) : undefined;
        return seg && sb ? this.clipMiddle(seg, sb.b, 2) : undefined;
      }
      case 'diagonal': {
        const seg = ea?.segs.find(([q, r]) => q.x !== r.x && q.y !== r.y);
        return seg ? this.midpoint(seg[0], seg[1]) : undefined;
      }
      case 'degenerateEdge':
        return ea?.pts[0];
      case 'detachedEdge': {
        // the first end it does not reach: the source's when that is it, else the target's
        if (!ea || ea.pts.length < 2) return undefined;
        return drawnEnds(ea.el)[0] === b ? ea.pts[0] : ea.pts[ea.pts.length - 1];
      }
      case 'labelClash': {
        const own = labelOf(a);
        const other = p.detail === 'label on label' ? labelOf(b) : sb?.b;
        return own && other ? this.meetCentre(own, other) : undefined;
      }
      case 'labelOnLine': {
        const own = labelOf(a);
        const owner = sa ?? ea;
        if (!own || !owner) return undefined;
        const text = glyph(own, raw<string>(owner.el, 'name') || '');
        const seg = eb?.segs.find((s) => hits(s, text, 0));
        return seg ? this.clipMiddle(seg, text, 0) : undefined;
      }
      case 'inOut':
      case 'parallelRun':
        return ea && eb ? this.sharedAt(ea, eb) : undefined;
      case 'segmentOverlap':
        // a join's common tail into the gateway's vertex is not counted: the badge goes on the run that is
        return ea && eb ? this.sharedAt(ea, eb, joinTail(ea, eb, pl.shapes.get(p.ids[2] ?? ''))) : undefined;
      case 'edgeLeavesLane':
      case 'edgeOutside':
        return sb ? ea?.pts.find((q) => !ptIn(q, sb.b)) : undefined;
      case 'laneGap':
        if (!sa || !sb) return undefined;
        return p.detail === 'bottom' ? { x: sa.b.x + sa.b.width / 2, y: (sa.b.y + sa.b.height + sb.b.y + sb.b.height) / 2 } : { x: sa.b.x + sa.b.width / 2, y: (sa.b.y + sb.b.y) / 2 };
      case 'backwardFlow':
        return ea ? this.halfway(ea.pts) : undefined;
      case 'labelOutsideFrame':
      case 'messageLabelFar': {
        const own = labelOf(a);
        return own ? this.centreOf(own) : undefined;
      }
      case 'labelOnTitle': {
        const own = labelOf(a);
        const title = sb ? subTitleOf(sb) : undefined;
        return own && title ? this.meetCentre(own, title) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** The element a BPMNPlane shows (bpmn-js: a plane without bpmnElement shows the first process or collaboration). */
  private planeRoot(plane: unknown): string | undefined {
    return idOf(raw(plane, 'bpmnElement')) ?? idOf(rawList(this.defs, 'rootElements').find((r) => is(r, 'bpmn:Process') || is(r, 'bpmn:Collaboration')));
  }
}
