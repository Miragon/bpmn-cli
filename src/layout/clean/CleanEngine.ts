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

/**
 * The built-in layout engine: places processes, pools, lanes and collapsed planes and writes
 * their DI in absolute coordinates. Groups are left to the caller, which redraws them.
 */
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
      // after everything else: the notes go next to elements that must already be placed
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
