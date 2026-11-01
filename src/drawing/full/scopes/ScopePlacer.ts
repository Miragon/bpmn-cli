import { Box, type BpmnElement } from '../../../model/index.js';
import { ArtifactLinks } from '../links/ArtifactLinks.js';
import { LinkRouter } from '../links/LinkRouter.js';
import { ScopeArtifactPlacer } from '../links/ScopeArtifactPlacer.js';
import { ChannelRouter } from '../routing/ChannelRouter.js';
import { JoinColumnTrial } from '../trials/JoinColumnTrial.js';
import { TopBorderTrial } from '../trials/TopBorderTrial.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode, ScopeLayout } from './GNode.js';
import { Scope } from './Scope.js';
import { ScopeFrame } from './ScopeFrame.js';
import { ScopeGraph } from './ScopeGraph.js';
import { ScopeGrid } from './ScopeGrid.js';

export interface PlaceOptions {
  expanded: ReadonlySet<string>;
  collapsedScopes: Map<string, ScopeLayout>;
  groups?: ReadonlyMap<string, readonly string[]>;
}

export class ScopePlacer {
  constructor(private readonly options: PlaceOptions) {}

  private static hasLanes(scope: BpmnElement): boolean {
    const laneSet = scope.is('bpmn:Process') ? scope.list('laneSets')[0] : undefined;
    return !!laneSet && laneSet.list('lanes').length > 0;
  }

  private static placeEventSubs(layout: ScopeLayout): void {
    if (!layout.eventSubs.length) {
      return;
    }
    const { vGap } = ShapeSizes.GAPS;
    let top = layout.height ? layout.height + vGap : 0;
    for (const eventSub of layout.eventSubs) {
      eventSub.box = new Box(0, top, eventSub.width, eventSub.height);
      top += eventSub.height + vGap;
      layout.width = Math.max(layout.width, eventSub.width);
    }
    layout.height = top - vGap;
  }

  layOut(scope: BpmnElement): ScopeLayout {
    const graph = new ScopeGraph(scope, (node) => this.nest(node));
    const { layout } = graph;
    new ArtifactLinks(layout).build(scope, graph.byId);
    const artifacts = new ScopeArtifactPlacer(layout);
    const grid = new ScopeGrid(layout, this.options.groups);
    grid.arrange();
    artifacts.placeAttached();
    if (!ScopePlacer.hasLanes(scope)) {
      new JoinColumnTrial(layout, (shifts) => {
        grid.arrange(shifts);
        artifacts.placeAttached();
      }).run();
      new TopBorderTrial(layout).run();
    }
    new ChannelRouter(layout).route();
    artifacts.refreshFlowAnchors();
    ScopePlacer.placeEventSubs(layout);
    artifacts.placeAnnotations();
    new LinkRouter(layout, true).route();
    new Scope(layout).growToFit();
    return layout;
  }

  private nest(node: GNode): void {
    if (this.options.expanded.has(node.id)) {
      node.child = this.layOut(node.el);
      new ScopeFrame(node.child).fitSubProcess(node);
    } else {
      this.options.collapsedScopes.set(node.id, this.layOut(node.el));
    }
  }
}
