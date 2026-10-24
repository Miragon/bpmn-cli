/**
 * Placement: builds the graph of one scope, assigns layers (columns) and
 * rows (bands), positions nodes, boundary events, event sub-processes and
 * artifacts. Recurses into expanded sub-processes.
 *
 * Conventions (see HANDOVER.md and docs/layout.md, "Layout conventions of the built-in engine"):
 *  - left to right; the happy path (the branch that reaches farthest) is a
 *    straight line on row 0
 *  - every other branch is a band below its split, in declaration order; a
 *    band is reused when its column interval is free (compact but never
 *    overlapping), and the split's column stays free for the drop line
 *  - boundary event handlers are bands below their host
 *  - boundary events sit on their host's bottom border (ScopeGrid.placeBoundaryEvents);
 *    one whose flows go to targets above it in its host's lane (or a scope
 *    without lanes) sits on the top border instead, at its right end, its
 *    flows straight up over the top, where the scope then draws better
 *    (TopBorderTrial, on the final arrangement: the rows stay, the other
 *    events keep their places)
 *  - loops (edges closing a cycle) do not influence layering; they are drawn
 *    underneath (see EdgeRouter)
 *  - the flows that enter a node from below (the entries of a join, the
 *    way of a boundary path into its handler in the lane or row above) rise
 *    straight into its bottom (a join's bottom vertex), the node right above
 *    them: what lies in the column under it down to the lowest of them (a
 *    shape, a routed artifact or a label: the end of a boundary path, the
 *    task after the boundary event's host, say) stays, and the node moves
 *    right past it with what follows it (a node whose column that takes
 *    moves on too), when the routes then have more such rises or run
 *    through fewer labels, and no more crossings, cut shapes or labels run
 *    through (JoinColumnTrial); the chains, and so the happy path, are those
 *    without the moves. A boundary event's way the router draws over the top
 *    enters the node's top instead and needs no such column
 *  - in a process with lanes, whose rows LaneArranger arranges by
 *    lane, a node entered from a node of its own lane on a row above moves
 *    up onto that row with the nodes of its row and lane it leads on to,
 *    where nothing of the lane lies or runs in their cells there (the happy
 *    path's line past the columns its nodes in other lanes leave empty
 *    included), when the flow into it is then straight and the routes have
 *    more straight flows and nothing worse (ChainLiftTrial, after the moves of
 *    JoinColumnTrial, whose straight rises stay): a split whose happy path
 *    runs on in another lane sends its branch in its own lane out through
 *    its right vertex. Without lanes the happy path holds the split's row
 *  - event sub-processes sit below the main content
 *  - text annotations go above, data objects/stores below their node (a
 *    join's right of the line its entries from below rise on); a
 *    note on a boundary event hangs below the host, clear of the sibling
 *    events, their labels and the flows dropping from them
 *  - expanded / collapsed follows `opts.expanded` for every sub-process,
 *    event sub-processes included; an expanded one is sized for its
 *    content, the labels of its content (data objects and stores included)
 *    and its title (ScopeFrame.fitSubProcess)
 *  - neighbours in a row whose labels sit on one side (events below,
 *    gateways above) are spaced so that the labels keep 4 px apart
 *  - parts of a scope that no flow connects (each from its start event, then
 *    from a node without incoming flow) go below one another in declaration
 *    order, except that with `opts.groups` (layoutModel: the groups whose
 *    box held a node) a part follows the first part of its group, the
 *    groups inside a group likewise; a part's group is that of its first
 *    node (declaration order, boundary events after their host) a group box
 *    held, and the parts from a start event and from a node without
 *    incoming flow are ordered as one list (start events first within a
 *    group): a group is drawn around its members again, so they stay
 *    together
 */
import { is, many, type El } from '../../model/utils/moddle.js';
import { METRICS, type GNode, type ScopeLayout } from '../../diagram/types.js';
import { ArtifactPlacer } from './ArtifactPlacer.js';
import { EdgeRouter } from './EdgeRouter.js';
import { JoinColumnTrial } from './JoinColumnTrial.js';
import { LinkRouter } from './LinkRouter.js';
import { ScopeFrame } from './ScopeFrame.js';
import { ScopeGraph } from './ScopeGraph.js';
import { ScopeGrid } from './ScopeGrid.js';
import { TopBorderTrial } from './TopBorderTrial.js';
import { growToFit } from './utils/scope.js';

export interface PlaceOptions {
  /** ids of sub-processes to lay out expanded */
  expanded: Set<string>;
  /** collects child planes of collapsed sub-processes */
  collapsedScopes: Map<string, ScopeLayout>;
  /** element id -> the groups whose box held it, outermost first (keeps the unconnected parts of a group together) */
  groups?: ReadonlyMap<string, readonly string[]>;
}

export class ScopePlacer {
  constructor(private readonly opts: PlaceOptions) {}

  /** Builds and lays out one scope (process or sub-process). */
  layOut(scope: El): ScopeLayout {
    const graph = new ScopeGraph(scope, (node) => this.nest(node));
    const { layout } = graph;
    const artifacts = new ArtifactPlacer(layout);
    artifacts.build(scope, graph.byId);
    const grid = new ScopeGrid(layout, this.opts.groups);
    grid.arrange();
    artifacts.placeAttached();
    // a process in lanes arranges its rows by lane first, and frees the joins' columns there, and puts boundary events on
    // their host's top border there (LaneArranger)
    if (!this.hasLanes(scope)) {
      new JoinColumnTrial(layout, (shifts) => {
        grid.arrange(shifts);
        artifacts.placeAttached();
      }).run();
      new TopBorderTrial(layout).run();
    }
    new EdgeRouter(layout).route();
    artifacts.refreshFlowAnchors();
    this.placeEventSubs(layout);
    artifacts.placeAnnotations();
    new LinkRouter(layout).route();
    growToFit(layout);
    return layout;
  }

  /** a sub-process, event sub-processes too: expanded unless the DI or the caller collapses them */
  private nest(node: GNode): void {
    if (this.opts.expanded.has(node.id)) {
      node.child = this.layOut(node.el);
      new ScopeFrame(node.child).fitSubProcess(node);
    } else {
      this.opts.collapsedScopes.set(node.id, this.layOut(node.el));
    }
  }

  /** The scope is a process drawn in lanes (LaneArranger draws the lanes of its first lane set). */
  private hasLanes(scope: El): boolean {
    const laneSet = is(scope, 'bpmn:Process') ? many(scope, 'laneSets')[0] : undefined;
    return !!laneSet && many(laneSet, 'lanes').length > 0;
  }

  private placeEventSubs(layout: ScopeLayout): void {
    if (!layout.eventSubs.length) return;
    let y = layout.height ? layout.height + METRICS.vGap : 0;
    for (const es of layout.eventSubs) {
      es.box = { x: 0, y, width: es.width, height: es.height };
      y += es.height + METRICS.vGap;
      layout.width = Math.max(layout.width, es.width);
    }
    layout.height = y - METRICS.vGap;
  }
}
