import type { Point } from '../../../model/index.js';
import type { GEdge, ScopeLayout } from '../scopes/GNode.js';
import type { LaneBand } from './LaneTree.js';

export class LaneStrips {
  private static readonly CROSSING_KEEP = 20;

  constructor(
    private readonly scope: ScopeLayout,
    private readonly leaves: readonly LaneBand[],
  ) {}

  open(cut: number, dy: number, keep: ReadonlySet<GEdge> = new Set()): void {
    const { scope, leaves } = this;
    this.moveShapes(cut, dy);
    this.moveLines(cut, dy, keep);
    for (const lane of leaves) {
      if (lane.y >= cut) {
        lane.y += dy;
      }
    }
    scope.height += dy;
  }

  freeX(cut: number, width: number): number {
    const keep = LaneStrips.CROSSING_KEEP;
    const crossing = this.scope.edges.flatMap((edge) => this.crossingsOf(edge, cut));
    const candidates = [0, ...crossing.map((left) => left + keep)].sort((first, second) => first - second);
    return candidates.find((left) => !crossing.some((x) => x > left - keep && x < left + width + keep)) ?? 0;
  }

  private moveShapes(cut: number, dy: number): void {
    const { scope } = this;
    for (const node of [...scope.nodes, ...scope.eventSubs]) {
      if (node.box.y >= cut) {
        node.shift(0, dy);
      }
    }
    for (const artifact of scope.artifacts) {
      if (artifact.box.y >= cut) {
        artifact.box.y += dy;
      }
    }
  }

  private moveLines(cut: number, dy: number, keep: ReadonlySet<GEdge>): void {
    const { artifacts, edges, compensations } = this.scope;
    const move = (point: Point): void => {
      if (point.y >= cut) {
        point.y += dy;
      }
    };
    artifacts.flatMap((artifact) => artifact.links).forEach((link) => link.points.forEach(move));
    for (const edge of edges) {
      if (!keep.has(edge)) {
        edge.points.forEach(move);
        if (edge.label && edge.label.y >= cut) {
          edge.label.y += dy;
        }
      }
    }
    compensations.forEach((compensation) => compensation.points.forEach(move));
  }

  private crossingsOf({ points }: GEdge, cut: number): number[] {
    return points.slice(1).flatMap((end, index) => {
      const start = points[index]!;
      return start.x === end.x && Math.min(start.y, end.y) < cut && Math.max(start.y, end.y) > cut ? [start.x] : [];
    });
  }
}
