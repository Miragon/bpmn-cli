import { DrawingSnapshot } from '../../src/drawing/index.js';
import { Drawing } from '../../src/drawing/incremental/Drawing.js';
import { NodePlacer } from '../../src/drawing/incremental/placement/NodePlacer.js';
import { PlacementObstacles } from '../../src/drawing/incremental/placement/PlacementObstacles.js';
import { PlacementState } from '../../src/drawing/incremental/placement/PlacementState.js';
import { RowChooser } from '../../src/drawing/incremental/placement/RowChooser.js';
import { LayoutRun } from '../../src/drawing/incremental/run/LayoutRun.js';
import type { PlaneEdge } from '../../src/drawing/plane/PlaneEdge.js';
import type { PlaneShape } from '../../src/drawing/plane/PlaneShape.js';
import { Plane } from '../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../src/drawing/plane/PlaneReader.js';
import { Semantics } from '../../src/drawing/plane/Semantics.js';
import { ChangeSet, type BpmnDocument } from '../../src/model/index.js';
import { DrawingPair, type PairParts } from './DrawingPair.js';

export class PlacementScene {
  readonly place: PlacementState;
  readonly run: LayoutRun;
  readonly placer: NodePlacer;
  readonly obstacles: PlacementObstacles;
  readonly rows: RowChooser;
  readonly plane: Plane;

  constructor(readonly parts: PairParts) {
    const { document, before, changes } = parts;
    const { definitions } = document.tree;
    const semantics = Semantics.of(definitions);
    const planes = new PlaneReader(definitions, semantics).planes();
    const oldTarget = PlacementScene.oldEnds(document, before, 'target');
    const oldSource = PlacementScene.oldEnds(document, before, 'source');
    const collapsed = new Set(changes.expansions.expansion().collapse);
    const newDrawing = (plane: Plane, touched?: Set<string>, fresh?: ReadonlySet<string>): Drawing => new Drawing(plane, touched, fresh);
    this.place = new PlacementState({ planes, semantics, oldSource, oldTarget, collapsed, notes: [], newDrawing });
    this.placer = new NodePlacer(this.place);
    this.run = new LayoutRun(document, before, this.place, this.placer);
    this.place.hooks.planeFor = (id) => semantics.homePlane(planes, id) ?? planes[0];
    this.obstacles = new PlacementObstacles(this.place);
    this.rows = new RowChooser(this.place, this.obstacles);
    this.plane = planes[0]!;
  }

  static async of(name: string): Promise<PlacementScene> {
    return new PlacementScene(await DrawingPair.read(name));
  }

  static async drawn(path: string, changes = new ChangeSet()): Promise<PlacementScene> {
    return new PlacementScene(await DrawingPair.drawn(path, changes));
  }

  private static oldEnds(document: BpmnDocument, before: DrawingSnapshot, end: 'source' | 'target'): Map<string, string> {
    const old = new Map<string, string>();
    for (const [oldFlowId, ends] of before.flowEnds) {
      const id = before.currentId(oldFlowId);
      const element = document.tree.byId(id);
      const was = before.currentId(end === 'source' ? ends.sourceId : ends.targetId);
      const now = element ? PlaneReader.edgeEnds(element) : undefined;
      if (now && was && (end === 'source' ? now.sourceId : now.targetId) !== was) {
        old.set(id, was);
      }
    }
    return old;
  }

  shape(id: string): PlaneShape {
    return this.plane.shapes.get(id)!;
  }

  edge(id: string): PlaneEdge {
    return this.plane.edges.get(id)!;
  }

  drawing(): Drawing {
    return this.run.drawing(this.plane);
  }
}
