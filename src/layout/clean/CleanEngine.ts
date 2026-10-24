/**
 * The "clean" layout engine: processes, pools, lanes, collapsed planes and
 * the BPMN DI writer. Coordinates handed to the DI are absolute.
 *
 * Contract (beyond the placement conventions of ScopePlacer / EdgeRouter):
 *  - lanes: every flow node lies inside the band of its leaf lane, in the
 *    rows the placer gave the lane's nodes, except that a node entered from a
 *    node of its lane on a row above moves up onto that row where its cell
 *    there is free and that draws better (ChainLiftTrial: a split whose
 *    happy path runs on in another lane sends its branch in its own lane out
 *    through its right vertex); the bands follow the content when routing
 *    or annotations open a strip above it,
 *    a loop inside a lane keeps CHANNEL_KEEP (15 px) from the lane's top and
 *    bottom border and its label inside the lane, as does the run of a
 *    boundary event's way to a target above from its lane's bottom border
 *    and such a way over the top (also one from the event's place on its
 *    host's top border, TopBorderTrial), with its label, from its
 *    lane's top border (the lane grows around them; nothing of the lanes
 *    before it moves), and the lanes fill their pool without gaps
 *  - event sub-processes sit below the content of their own lane (the lanes
 *    below move down); those of the last lane or of no lane below everything
 *  - pools stack vertically in the order whose message flows cut the fewest
 *    shapes (declaration order on ties; PoolStacker); message flows: see MessageFlowRouter
 *  - text annotations owned by the collaboration are drawn next to their
 *    element (NotePlacer), their associations as straight lines; links between
 *    scope levels are drawn when both ends are on the same plane, otherwise
 *    reported as DI_NOT_CREATED
 *  - groups are not drawn here (no warning either): layoutModel draws them
 *    again around what their boxes held (diagram/Groups.ts)
 *  - a label on a shape, another label, a line or the title of an expanded
 *    sub-process (diagram/utils/text.ts titleBox) moves to a free spot around its
 *    element, in a sub-process below its title first, else beside the
 *    title; a spot next to the element before one stepped further out
 *    (LabelDeclutter)
 */
import { idOf, is, layoutRoot, type Model } from '../../model/utils/moddle.js';
import { SIZES } from '../../diagram/utils/sizes.js';
import type { ScopeLayout } from '../../diagram/types.js';
import { CollaborationArtifacts } from './CollaborationArtifacts.js';
import { DiWriter } from './DiWriter.js';
import { LaneArranger } from './LaneArranger.js';
import { PoolStacker } from './PoolStacker.js';
import { ScopeFrame } from './ScopeFrame.js';
import { ScopePlacer, type PlaceOptions } from './ScopePlacer.js';
import { laneDepth, stretchLane } from './utils/lanes.js';

export interface EngineWarning {
  code: string;
  elementId: string;
  message: string;
}

export class CleanEngine {
  constructor(
    private readonly model: Model,
    private readonly expanded: Set<string>,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  run(): { warnings: EngineWarning[] } {
    const { moddle, definitions } = this.model;
    const { expanded, groups } = this;
    const warnings: EngineWarning[] = [];
    const root = layoutRoot(definitions);
    definitions.set('diagrams', []);
    if (!root) return { warnings };
    const collapsedScopes = new Map<string, ScopeLayout>();
    const placeOpts: PlaceOptions = { expanded, collapsedScopes, ...(groups?.size ? { groups } : {}) };
    const placer = new ScopePlacer(placeOpts);
    const writer = new DiWriter(moddle);
    const margin = SIZES.outerMargin;
    if (is(root, 'bpmn:Collaboration')) {
      const stack = new PoolStacker(root, writer);
      stack.drawPools(placer, placeOpts.groups);
      stack.drawMessageFlows(warnings);
      // text annotations owned by the collaboration: next to their element, after everything else
      new CollaborationArtifacts(root, stack.pools, writer).draw(warnings);
    } else {
      const scope = placer.layOut(root);
      new LaneArranger(scope, root, placeOpts.groups).apply();
      if (scope.lanes.length) {
        const depth = laneDepth(scope.lanes);
        const framed = new ScopeFrame(scope).framedSize();
        for (const lane of scope.lanes) stretchLane(lane, framed.width - framed.left + 2 * SIZES.lanePadding + depth * SIZES.laneHeader);
        writer.emitScope(scope, { x: margin + depth * SIZES.laneHeader + SIZES.lanePadding, y: margin });
        for (const lane of scope.lanes) writer.fixLaneShapes(lane, { box: { x: margin, y: margin, width: 0, height: 0 }, participant: root, origin: { x: 0, y: 0 } }, true);
      } else {
        writer.emitScope(scope, { x: margin, y: margin });
      }
    }
    writer.writePlane(definitions, root, idOf(root), warnings);
    // collapsed sub-processes: one diagram each (bpmn-js drill-down)
    for (const [subId, scope] of collapsedScopes) {
      writer.startPlane();
      writer.emitScope(scope, { x: margin, y: margin });
      writer.writePlane(definitions, scope.el, subId, warnings);
    }
    return { warnings };
  }
}
