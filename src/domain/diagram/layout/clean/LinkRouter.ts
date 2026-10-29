import { borderPoint, bottom, center, cx, right, dedupe, hitCount, toSegments, type Segment } from '../../utils/geom.js';
import type { Box, GNode, Point, ScopeLayout } from '../../di/types.js';
import { ChannelRouter } from './ChannelRouter.js';
import { obstacles, routedSegments } from '../../utils/scope.js';

/** Compensation links, associations and data associations. */
export class LinkRouter {
  constructor(private readonly layout: ScopeLayout) {}

  route(): void {
    const { layout } = this;
    const boxes = obstacles(layout);
    const flows = routedSegments(layout);
    for (const compensation of layout.compensations) {
      const eb = compensation.event.box, hb = compensation.handler.box;
      const ex = cx(eb);
      if (ex >= hb.x && ex <= hb.x + hb.width) {
        compensation.points = [{ x: ex, y: bottom(eb) }, { x: ex, y: hb.y }];
      } else {
        const midY = (bottom(eb) + hb.y) / 2;
        const hx = cx(hb);
        compensation.points = [{ x: ex, y: bottom(eb) }, { x: ex, y: midY }, { x: hx, y: midY }, { x: hx, y: hb.y }];
      }
      compensation.points = compensation.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
    }
    const drawn: Segment[] = [];
    for (const artifact of layout.artifacts) {
      for (const link of artifact.links) {
        const other = link.from === artifact ? link.to : link.from;
        const node = other.flow ? undefined : layout.nodes.find((candidate) => candidate.box === other.box) ?? layout.nodes.flatMap((candidate) => candidate.boundary).find((candidate) => candidate.box === other.box);
        const path = this.linkPath(artifact.box, other.box, node, boxes, [...flows, ...drawn], other.flow ? 'flow' : 'shape');
        const pts = link.from === artifact ? path : [...path].reverse();
        link.points = pts.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
        drawn.push(...toSegments(link.points));
      }
    }
  }

  /**
   * The candidate path that cuts no shape, crosses the fewest lines and is shortest wins.
   * The plain diagonal BPMN draws by default is a candidate too.
   */
  private linkPath(artifactBox: Box, targetBox: Box, node: GNode | undefined, boxes: Box[], lines: Segment[], end: 'shape' | 'flow'): Point[] {
    const ac = center(artifactBox), nc = center(targetBox);
    const ignore = [artifactBox, targetBox];
    const cands: Point[][] = [];
    const push = (...pts: Point[]): void => {
      const path = dedupe(pts);
      if (path.length >= 2) cands.push(path);
    };
    const xLo = Math.max(artifactBox.x + 4, targetBox.x + 8), xHi = Math.min(right(artifactBox) - 4, right(targetBox) - 8);
    if (xLo <= xHi) {
      const crossX = Math.min(Math.max(ac.x, xLo), xHi);
      if (artifactBox.y >= bottom(targetBox)) {
        push({ x: crossX, y: artifactBox.y }, { x: crossX, y: bottom(targetBox) });
      } else if (bottom(artifactBox) <= targetBox.y) {
        push({ x: crossX, y: bottom(artifactBox) }, { x: crossX, y: targetBox.y });
      }
    }
    const yLo = Math.max(artifactBox.y + 4, targetBox.y + 8), yHi = Math.min(bottom(artifactBox) - 4, bottom(targetBox) - 8);
    if (yLo <= yHi) {
      const crossY = Math.min(Math.max(ac.y, yLo), yHi);
      if (artifactBox.x >= right(targetBox)) {
        push({ x: artifactBox.x, y: crossY }, { x: right(targetBox), y: crossY });
      } else if (right(artifactBox) <= targetBox.x) {
        push({ x: right(artifactBox), y: crossY }, { x: targetBox.x, y: crossY });
      }
    }
    const nx = node ? ChannelRouter.dataX(node) : nc.x;
    const ny = ac.y > nc.y ? bottom(targetBox) : targetBox.y;
    const side = ac.x < nc.x ? right(artifactBox) : artifactBox.x;
    if (end === 'shape') {
      push({ x: side, y: ac.y }, { x: nx, y: ac.y }, { x: nx, y: ny });
      const ay = ac.y > nc.y ? artifactBox.y : bottom(artifactBox);
      const nSide = ac.x < nc.x ? targetBox.x : right(targetBox);
      push({ x: ac.x, y: ay }, { x: ac.x, y: nc.y }, { x: nSide, y: nc.y });
    } else {
      push({ x: nc.x, y: ac.y > nc.y ? artifactBox.y : bottom(artifactBox) }, { x: nc.x, y: nc.y });
      push({ x: side, y: ac.y }, { x: nc.x, y: ac.y }, { x: nc.x, y: nc.y });
    }
    if (end === 'shape') {
      const lo = Math.min(ac.x, nc.x), hi = Math.max(ac.x, nc.x);
      let under = Math.max(bottom(artifactBox), bottom(targetBox));
      for (const box of boxes) {
        if (box !== artifactBox && box !== targetBox && box.x <= hi && right(box) >= lo) {
          under = Math.max(under, bottom(box));
        }
      }
      under += 20;
      const approachX = ac.x < nc.x ? targetBox.x - 20 : right(targetBox) + 20;
      const nSideX = ac.x < nc.x ? targetBox.x : right(targetBox);
      const runs = [ac.y, bottom(artifactBox) + 15, artifactBox.y - 15, under];
      for (const runY of runs) {
        const exit: Point[] = runY > bottom(artifactBox) ? [{ x: ac.x, y: bottom(artifactBox) }, { x: ac.x, y: runY }] : runY < artifactBox.y ? [{ x: ac.x, y: artifactBox.y }, { x: ac.x, y: runY }] : [{ x: side, y: runY }];
        push(...exit, { x: nx, y: runY }, { x: nx, y: runY > nc.y ? bottom(targetBox) : targetBox.y });
        push(...exit, { x: approachX, y: runY }, { x: approachX, y: nc.y }, { x: nSideX, y: nc.y });
      }
    }
    cands.push([borderPoint(artifactBox, nc), end === 'flow' ? nc : borderPoint(targetBox, ac)]);
    const length = (pts: Point[]): number => {
      let len = 0;
      for (const [segmentStart, segmentEnd] of toSegments(pts)) {
        len += Math.abs(segmentEnd.x - segmentStart.x) + Math.abs(segmentEnd.y - segmentStart.y);
      }
      return len;
    };
    let best: { pts: Point[]; score: number } | undefined;
    cands.forEach((pts, index) => {
      const score = hitCount(pts, boxes, ignore) * 1000 + ChannelRouter.countCrossings(pts, lines) * 8 + length(pts) * 0.002 + index * 0.01;
      if (!best || score < best.score) best = { pts, score };
    });
    return best!.pts;
  }
}
