import { center, borderPoint } from '../../drawing/utils/geom.js';
import type { Box, GNode, Point, ScopeLayout } from '../../drawing/types.js';
import { ChannelRouter } from './ChannelRouter.js';
import { bottom, dedupe, hitCount, right, toSegments, type Segment } from './utils/geometry.js';
import { obstacles, routedSegments } from './utils/scope.js';

/** Compensation links, associations and data associations. */
export class LinkRouter {
  constructor(private readonly layout: ScopeLayout) {}

  route(): void {
    const { layout } = this;
    const boxes = obstacles(layout);
    const flows = routedSegments(layout);
    for (const c of layout.compensations) {
      const eb = c.event.box, hb = c.handler.box;
      const ex = eb.x + eb.width / 2;
      if (ex >= hb.x && ex <= hb.x + hb.width) c.points = [{ x: ex, y: bottom(eb) }, { x: ex, y: hb.y }];
      else {
        const midY = (bottom(eb) + hb.y) / 2;
        const hx = hb.x + hb.width / 2;
        c.points = [{ x: ex, y: bottom(eb) }, { x: ex, y: midY }, { x: hx, y: midY }, { x: hx, y: hb.y }];
      }
      c.points = c.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    }
    const drawn: Segment[] = [];
    for (const a of layout.artifacts) {
      for (const link of a.links) {
        const other = link.from === a ? link.to : link.from;
        const node = other.flow ? undefined : layout.nodes.find((x) => x.box === other.box) ?? layout.nodes.flatMap((x) => x.boundary).find((x) => x.box === other.box);
        const path = this.linkPath(a.box, other.box, node, boxes, [...flows, ...drawn], other.flow ? 'flow' : 'shape');
        const pts = link.from === a ? path : [...path].reverse();
        link.points = pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
        drawn.push(...toSegments(link.points));
      }
    }
  }

  /** The candidate path that cuts no shape, crosses the fewest lines and is shortest wins. */
  private linkPath(a: Box, n: Box, node: GNode | undefined, boxes: Box[], lines: Segment[], end: 'shape' | 'flow'): Point[] {
    const ac = center(a), nc = center(n);
    const ignore = [a, n];
    const cands: Point[][] = [];
    const push = (...pts: Point[]): void => {
      const path = dedupe(pts);
      if (path.length >= 2) cands.push(path);
    };
    const xLo = Math.max(a.x + 4, n.x + 8), xHi = Math.min(right(a) - 4, right(n) - 8);
    if (xLo <= xHi) {
      const x = Math.min(Math.max(ac.x, xLo), xHi);
      if (a.y >= bottom(n)) push({ x, y: a.y }, { x, y: bottom(n) });
      else if (bottom(a) <= n.y) push({ x, y: bottom(a) }, { x, y: n.y });
    }
    const yLo = Math.max(a.y + 4, n.y + 8), yHi = Math.min(bottom(a) - 4, bottom(n) - 8);
    if (yLo <= yHi) {
      const y = Math.min(Math.max(ac.y, yLo), yHi);
      if (a.x >= right(n)) push({ x: a.x, y }, { x: right(n), y });
      else if (right(a) <= n.x) push({ x: right(a), y }, { x: n.x, y });
    }
    const nx = node ? ChannelRouter.dataX(node) : nc.x;
    const ny = ac.y > nc.y ? bottom(n) : n.y;
    const side = ac.x < nc.x ? right(a) : a.x;
    if (end === 'shape') {
      push({ x: side, y: ac.y }, { x: nx, y: ac.y }, { x: nx, y: ny });
      const ay = ac.y > nc.y ? a.y : bottom(a);
      const nSide = ac.x < nc.x ? n.x : right(n);
      push({ x: ac.x, y: ay }, { x: ac.x, y: nc.y }, { x: nSide, y: nc.y });
    } else {
      push({ x: nc.x, y: ac.y > nc.y ? a.y : bottom(a) }, { x: nc.x, y: nc.y });
      push({ x: side, y: ac.y }, { x: nc.x, y: ac.y }, { x: nc.x, y: nc.y });
    }
    if (end === 'shape') {
      const lo = Math.min(ac.x, nc.x), hi = Math.max(ac.x, nc.x);
      let under = Math.max(bottom(a), bottom(n));
      for (const box of boxes) if (box !== a && box !== n && box.x <= hi && right(box) >= lo) under = Math.max(under, bottom(box));
      under += 20;
      const approachX = ac.x < nc.x ? n.x - 20 : right(n) + 20;
      const nSideX = ac.x < nc.x ? n.x : right(n);
      const runs = [ac.y, bottom(a) + 15, a.y - 15, under];
      for (const y of runs) {
        const exit: Point[] = y > bottom(a) ? [{ x: ac.x, y: bottom(a) }, { x: ac.x, y }] : y < a.y ? [{ x: ac.x, y: a.y }, { x: ac.x, y }] : [{ x: side, y }];
        push(...exit, { x: nx, y }, { x: nx, y: y > nc.y ? bottom(n) : n.y });
        push(...exit, { x: approachX, y }, { x: approachX, y: nc.y }, { x: nSideX, y: nc.y });
      }
    }
    // the plain diagonal BPMN draws by default
    cands.push([borderPoint(a, nc), end === 'flow' ? nc : borderPoint(n, ac)]);
    const length = (pts: Point[]): number => {
      let len = 0;
      for (const [p, q] of toSegments(pts)) len += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      return len;
    };
    let best: { pts: Point[]; score: number } | undefined;
    cands.forEach((pts, i) => {
      const score = hitCount(pts, boxes, ignore) * 1000 + ChannelRouter.countCrossings(pts, lines) * 8 + length(pts) * 0.002 + i * 0.01;
      if (!best || score < best.score) best = { pts, score };
    });
    return best!.pts;
  }
}
