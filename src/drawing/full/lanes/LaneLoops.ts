import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GEdge, LaneBandInfo, ScopeLayout } from '../scopes/GNode.js';
import { LaneStrips } from './LaneStrips.js';
import type { LaneBand } from './LaneTree.js';

export class LaneLoops {
  private static readonly CHANNEL_KEEP = ShapeSizes.GAPS.loopGap / 2;

  private readonly strips: LaneStrips;

  constructor(
    private readonly scope: ScopeLayout,
    private readonly leaves: readonly LaneBand[],
  ) {
    this.strips = new LaneStrips(scope, leaves);
  }

  private static runsOf(edge: GEdge): number[] {
    return edge.points.filter((point, index) => index > 0 && edge.points[index - 1]!.y === point.y).map((point) => point.y);
  }

  private static labelsOf(edges: readonly GEdge[]): number[] {
    return edges.flatMap((edge) => edge.label ?? []).flatMap((label) => [label.y, label.bottom]);
  }

  growFirstLane(shift: number, bandsMoved: boolean): void {
    const { scope, leaves } = this;
    if (!shift) {
      return;
    }
    for (const lane of leaves) {
      lane.y += shift;
    }
    leaves[0]!.y -= shift;
    leaves[0]!.height += shift;
    const bands = scope.laneBands ?? [];
    if (!bandsMoved) {
      for (const band of bands) {
        band.top += shift;
        band.bottom += shift;
      }
    }
    if (bands[0]) {
      bands[0].top -= shift;
    }
  }

  fit(): void {
    const { scope, leaves } = this;
    const bands = scope.laneBands ?? [];
    leaves.forEach((lane, laneIndex) => {
      const band = bands[laneIndex];
      if (band) {
        this.fitLane(lane, band, laneIndex === leaves.length - 1);
      }
    });
    bands.forEach((band, laneIndex) => {
      band.top = leaves[laneIndex]!.y;
      band.bottom = leaves[laneIndex]!.y + leaves[laneIndex]!.height;
    });
  }

  private fitLane(lane: LaneBand, band: LaneBandInfo, isLast: boolean): void {
    const { edges } = this.scope;
    const keep = LaneLoops.CHANNEL_KEEP;
    const inside = edges.filter((edge) => band.nodes.has(edge.source.host ?? edge.source) && band.nodes.has(edge.target));
    const loops = inside.filter((edge) => edge.back || edge.runsAbove);
    const runs = loops.flatMap(LaneLoops.runsOf);
    const ups = edges.filter((edge) => edge.runsBelow && band.nodes.has(edge.source.host ?? edge.source));
    const downs = ups.map((edge) => edge.points[1]!.y);
    if (!runs.length && !downs.length) {
      return;
    }
    const labels = LaneLoops.labelsOf(loops);
    const top = Math.min(...runs.map((y) => y - keep), ...labels.filter((_y, index) => index % 2 === 0));
    const low = Math.max(...[...runs, ...downs].map((y) => y + keep), ...labels.filter((_y, index) => index % 2 === 1));
    const above = Math.max(0, Math.ceil(lane.y - top));
    if (above) {
      this.growUp(lane, above, inside);
    }
    const bottom = lane.y + lane.height;
    const below = Math.ceil(low + above - bottom);
    if (below > 0 && !isLast) {
      this.strips.open(bottom, below, new Set([...inside, ...ups].filter((edge) => edge.points.every((point) => point.y < bottom + below))));
      lane.height += below;
    }
  }

  private growUp(lane: LaneBand, above: number, inside: readonly GEdge[]): void {
    const cut = lane.y;
    this.strips.open(cut, above);
    for (const edge of inside) {
      for (const point of edge.points) {
        if (point.y < cut) {
          point.y += above;
        }
      }
      if (edge.label && edge.label.y < cut) {
        edge.label.y += above;
      }
    }
    lane.y -= above;
    lane.height += above;
  }
}
