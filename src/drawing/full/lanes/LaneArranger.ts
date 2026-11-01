import type { BpmnElement } from '../../../model/index.js';
import { LinkRouter } from '../links/LinkRouter.js';
import { ScopeArtifactPlacer } from '../links/ScopeArtifactPlacer.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { ChannelRouter } from '../routing/ChannelRouter.js';
import type { ScopeLayout } from '../scopes/GNode.js';
import { Scope } from '../scopes/Scope.js';
import { ScopeGrid } from '../scopes/ScopeGrid.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { ChainLiftTrial } from '../trials/ChainLiftTrial.js';
import { JoinColumnTrial } from '../trials/JoinColumnTrial.js';
import { TopBorderTrial } from '../trials/TopBorderTrial.js';
import { LaneEventSubs } from './LaneEventSubs.js';
import { LaneLoops } from './LaneLoops.js';
import { LaneRows } from './LaneRows.js';
import { LaneTree, type LaneBand } from './LaneTree.js';

export class LaneArranger {
  constructor(
    private readonly scope: ScopeLayout,
    private readonly process: BpmnElement,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  apply(): void {
    const { scope } = this;
    const laneSet = this.process.list('laneSets')[0];
    const tree = laneSet && new LaneTree(laneSet, scope);
    if (!tree?.leaves.length) {
      return;
    }
    const { leaves } = tree;
    const rows = new LaneRows(scope, leaves);
    rows.arrange();
    this.runTrials(rows);
    leaves.forEach((lane, index) => {
      const band = scope.laneBands![index]!;
      lane.y = band.top;
      lane.height = band.bottom - band.top;
    });
    this.route(leaves);
    const lowest = new LaneEventSubs(scope, leaves).place();
    this.closeLastLane(leaves.at(-1)!, lowest);
    tree.closeUp();
    scope.lanes = tree.boxes(this.contentWidth());
  }

  private runTrials(rows: LaneRows): void {
    const { scope, groups } = this;
    const band = scope.edges.find((edge) => edge.bandY !== undefined);
    const drawnBandY = band?.bandY;
    const grid = new ScopeGrid(scope, groups);
    let bandShift: number | undefined;
    new JoinColumnTrial(scope, (shifts) => {
      if (bandShift === undefined) {
        grid.arrange();
        bandShift = band?.bandY !== undefined && drawnBandY !== undefined ? drawnBandY - band.bandY : 0;
      }
      grid.arrange(shifts);
      for (const edge of scope.edges) {
        if (edge.bandY !== undefined) {
          edge.bandY += bandShift;
        }
      }
      rows.arrange();
    }).run();
    new ChainLiftTrial(scope, () => rows.arrange()).run();
    new TopBorderTrial(scope).run();
  }

  private route(leaves: readonly LaneBand[]): void {
    const { scope } = this;
    const loops = new LaneLoops(scope, leaves);
    const firstNode = scope.nodes[0];
    const topOfContent = (): number => firstNode?.box.y ?? 0;
    const beforeRouting = topOfContent();
    new ChannelRouter(scope).route();
    loops.growFirstLane(topOfContent() - beforeRouting, true);
    loops.fit();
    const beforeNotes = topOfContent();
    const artifacts = new ScopeArtifactPlacer(scope);
    artifacts.refreshFlowAnchors();
    artifacts.placeAnnotations();
    loops.growFirstLane(topOfContent() - beforeNotes, false);
    new LinkRouter(scope, true).route();
    new Scope(scope).growToFit();
  }

  private closeLastLane(last: LaneBand, lowest: number): void {
    const { scope } = this;
    const { LANE_PADDING } = ShapeSizes;
    const labels = new ScopeLabels(scope).all();
    const reaches = [lowest, ...scope.nodes.map((node) => node.box.bottom), ...scope.artifacts.map((artifact) => artifact.box.bottom), ...scope.edges.flatMap((edge) => edge.points.map((point) => point.y)), ...labels.map((label) => label.bottom)];
    const contentBottom = Math.max(...reaches);
    if (contentBottom > last.y + last.height - LANE_PADDING) {
      last.height = Math.round(contentBottom + LANE_PADDING - last.y);
    }
    scope.height = last.y + last.height;
  }

  private contentWidth(): number {
    const { scope } = this;
    const rights = [scope.width, ...[...scope.artifacts, ...scope.nodes, ...scope.eventSubs].map(({ box }) => box.right), ...new ScopeLabels(scope).all().map((label) => label.right)];
    return Math.max(...rights) + 2 * ShapeSizes.LANE_PADDING;
  }
}
