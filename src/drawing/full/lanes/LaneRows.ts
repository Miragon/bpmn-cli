import { ScopeArtifactPlacer } from '../links/ScopeArtifactPlacer.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode, ScopeLayout } from '../scopes/GNode.js';
import { ScopeGrid } from '../scopes/ScopeGrid.js';
import type { LaneBand } from './LaneTree.js';

export class LaneRows {
  private static readonly MIN_CONTENT = 60;

  private readonly dataRows: ReadonlySet<GNode>;

  constructor(
    private readonly scope: ScopeLayout,
    private readonly leaves: readonly LaneBand[],
  ) {
    this.dataRows = new Set(scope.artifacts.filter((artifact) => artifact.kind !== 'annotation' && artifact.anchorNode).map((artifact) => artifact.anchorNode!));
  }

  arrange(): void {
    const { scope, leaves } = this;
    const { LANE_PADDING } = ShapeSizes;
    let laneTop = 0;
    for (const lane of leaves) {
      const content = this.placeRows(lane, laneTop + LANE_PADDING);
      lane.y = laneTop;
      lane.height = Math.max(LaneRows.MIN_CONTENT + 2 * LANE_PADDING, content + 2 * LANE_PADDING);
      laneTop += lane.height;
    }
    scope.height = laneTop;
    new ScopeArtifactPlacer(scope).placeAttached();
    scope.laneBands = leaves.map((lane) => ({ nodes: new Set(lane.nodes), top: lane.y, bottom: lane.y + lane.height }));
  }

  private placeRows(lane: LaneBand, top: number): number {
    const { vGap } = ShapeSizes.GAPS;
    const rows = [...new Set(lane.nodes.map((node) => node.row))].sort((first, second) => first - second);
    let rowY = top;
    for (const row of rows) {
      const inRow = lane.nodes.filter((node) => node.row === row);
      const rowHeight = Math.max(0, ...inRow.map((node) => node.height + ScopeGrid.boundaryExtra(node)));
      for (const node of inRow) {
        node.shift(0, Math.round(rowY + rowHeight / 2 - node.height / 2 - node.box.y));
      }
      rowY += rowHeight + vGap + (inRow.some((node) => this.dataRows.has(node)) ? ScopeGrid.DATA_ROW_EXTRA : 0);
    }
    return rows.length ? rowY - vGap - top : 0;
  }
}
