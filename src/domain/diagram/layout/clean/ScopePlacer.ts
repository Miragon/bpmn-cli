import { is, many, type El } from '../../../document/utils/moddle.js';
import { METRICS } from '../../utils/sizes.js';
import type { GNode, ScopeLayout } from '../../di/types.js';
import { ScopeArtifactPlacer } from './ScopeArtifactPlacer.js';
import { ChannelRouter } from './ChannelRouter.js';
import { JoinColumnTrial } from './JoinColumnTrial.js';
import { LinkRouter } from './LinkRouter.js';
import { ScopeFrame } from './ScopeFrame.js';
import { ScopeGraph } from './ScopeGraph.js';
import { ScopeGrid } from './ScopeGrid.js';
import { TopBorderTrial } from './TopBorderTrial.js';
import { growToFit } from '../../utils/scope.js';

export interface PlaceOptions {
  expanded: Set<string>;
  /** collects child planes of collapsed sub-processes */
  collapsedScopes: Map<string, ScopeLayout>;
  /**
   * element id -> the groups whose box held it, outermost first: the unconnected parts of a
   * group stay together, so the group can be drawn around its members again
   */
  groups?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Lays out one scope left to right: the happy path straight on row 0, other branches as bands
 * below their split, then the routes, event sub-processes and artifacts. Recurses into
 * expanded sub-processes.
 */
export class ScopePlacer {
  constructor(private readonly opts: PlaceOptions) {}

  /**
   * Runs the arrangement trials unless the process has lanes: LaneArranger runs them on its rows by
   * lane instead.
   */
  layOut(scope: El): ScopeLayout {
    const graph = new ScopeGraph(scope, (node) => this.nest(node));
    const { layout } = graph;
    const artifacts = new ScopeArtifactPlacer(layout);
    artifacts.build(scope, graph.byId);
    const grid = new ScopeGrid(layout, this.opts.groups);
    grid.arrange();
    artifacts.placeAttached();
    if (!this.hasLanes(scope)) {
      new JoinColumnTrial(layout, (shifts) => {
        grid.arrange(shifts);
        artifacts.placeAttached();
      }).run();
      new TopBorderTrial(layout).run();
    }
    new ChannelRouter(layout).route();
    artifacts.refreshFlowAnchors();
    this.placeEventSubs(layout);
    artifacts.placeAnnotations();
    new LinkRouter(layout).route();
    growToFit(layout);
    return layout;
  }

  private nest(node: GNode): void {
    if (this.opts.expanded.has(node.id)) {
      node.child = this.layOut(node.el);
      new ScopeFrame(node.child).fitSubProcess(node);
    } else {
      this.opts.collapsedScopes.set(node.id, this.layOut(node.el));
    }
  }

  /** LaneArranger draws the lanes of the first lane set only. */
  private hasLanes(scope: El): boolean {
    const laneSet = is(scope, 'bpmn:Process') ? many(scope, 'laneSets')[0] : undefined;
    return !!laneSet && many(laneSet, 'lanes').length > 0;
  }

  private placeEventSubs(layout: ScopeLayout): void {
    if (!layout.eventSubs.length) return;
    let top = layout.height ? layout.height + METRICS.vGap : 0;
    for (const es of layout.eventSubs) {
      es.box = { x: 0, y: top, width: es.width, height: es.height };
      top += es.height + METRICS.vGap;
      layout.width = Math.max(layout.width, es.width);
    }
    layout.height = top - METRICS.vGap;
  }
}
