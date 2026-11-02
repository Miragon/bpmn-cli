import { Box, Point, type BpmnDocument, type BpmnElement } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { LaneArranger } from '../lanes/LaneArranger.js';
import type { ScopeLayout } from '../scopes/GNode.js';
import { LaneBox } from '../scopes/LaneBox.js';
import { ScopeFrame } from '../scopes/ScopeFrame.js';
import { ScopePlacer, type PlaceOptions } from '../scopes/ScopePlacer.js';
import { CollaborationArtifacts } from './CollaborationArtifacts.js';
import { FreshDrawingWriter, type EngineWarning } from './FreshDrawingWriter.js';
import { PoolStacker } from './PoolStacker.js';

export class CleanEngine {
  constructor(
    private readonly document: BpmnDocument,
    private readonly expanded: ReadonlySet<string>,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  private static drawProcess(root: BpmnElement, writer: FreshDrawingWriter, placer: ScopePlacer, options: PlaceOptions): void {
    const { OUTER_MARGIN, LANE_HEADER, LANE_PADDING } = ShapeSizes;
    const scope = placer.layOut(root);
    new LaneArranger(scope, root, options.groups).apply();
    if (!scope.lanes.length) {
      writer.emitScope(scope, new Point(OUTER_MARGIN, OUTER_MARGIN));
      return;
    }
    const depth = LaneBox.depthOf(scope.lanes);
    const framed = new ScopeFrame(scope).framedSize();
    for (const lane of scope.lanes) {
      lane.stretch(framed.width - framed.left + 2 * LANE_PADDING + depth * LANE_HEADER);
    }
    writer.emitScope(scope, new Point(OUTER_MARGIN + depth * LANE_HEADER + LANE_PADDING, OUTER_MARGIN));
    for (const lane of scope.lanes) {
      writer.fixLaneShapes(lane, new Box(OUTER_MARGIN, OUTER_MARGIN, 0, 0), OUTER_MARGIN);
    }
  }

  run(): { warnings: EngineWarning[] } {
    const { document, expanded, groups } = this;
    const { definitions } = document.tree;
    const warnings: EngineWarning[] = [];
    const root = document.diagram.layoutRoot();
    definitions.set('diagrams', []);
    if (!root) {
      return { warnings };
    }
    const collapsedScopes = new Map<string, ScopeLayout>();
    const options: PlaceOptions = { expanded, collapsedScopes, ...(groups?.size ? { groups } : {}) };
    const placer = new ScopePlacer(options);
    const writer = new FreshDrawingWriter(document.tree);
    if (root.is('bpmn:Collaboration')) {
      this.drawCollaboration(root, writer, placer, options, warnings);
    } else {
      CleanEngine.drawProcess(root, writer, placer, options);
    }
    writer.writePlane(definitions, root, root.id, warnings);
    for (const [id, scope] of collapsedScopes) {
      writer.startPlane();
      writer.emitScope(scope, new Point(ShapeSizes.OUTER_MARGIN, ShapeSizes.OUTER_MARGIN));
      writer.writePlane(definitions, scope.el, id, warnings);
    }
    return { warnings };
  }

  private drawCollaboration(root: BpmnElement, writer: FreshDrawingWriter, placer: ScopePlacer, options: PlaceOptions, warnings: EngineWarning[]): void {
    const stack = new PoolStacker(root, writer);
    stack.drawPools(placer, options.groups);
    stack.drawMessageFlows(warnings);
    new CollaborationArtifacts(root, stack.pools, writer).draw(warnings);
  }
}
