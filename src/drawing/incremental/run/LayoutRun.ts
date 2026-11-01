import type { Box, BpmnDocument } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import type { Semantics } from '../../plane/Semantics.js';
import type { Drawing } from '../Drawing.js';
import type { NodePlacer } from '../placement/NodePlacer.js';
import type { PlacementState } from '../placement/PlacementState.js';
import type { EdgeBefore } from '../routing/EdgeRouter.js';

export interface RunSets {
  reroute: Set<string>;
  newEdges: Set<string>;
  fromEngine: Set<string>;
  active: Set<string>;
  relocated: Set<string>;
  grown: Set<string>;
  routedNow: Map<string, EdgeBefore>;
}

export class LayoutRun implements RunSets {
  readonly semantics: Semantics;
  readonly planes: Plane[];
  readonly notes: string[];
  reroute = new Set<string>();
  newEdges = new Set<string>();
  fromEngine = new Set<string>();
  active = new Set<string>();
  relocated = new Set<string>();
  grown = new Set<string>();
  routedNow = new Map<string, EdgeBefore>();

  constructor(
    readonly document: BpmnDocument,
    readonly before: DrawingSnapshot,
    readonly place: PlacementState,
    readonly placer: NodePlacer,
  ) {
    this.semantics = place.semantics;
    this.planes = place.planes;
    this.notes = place.notes;
  }

  drawing(plane: Plane): Drawing {
    return this.place.newDrawing(plane, this.place.moved, this.place.placed);
  }

  oldId(element: DShape | DEdge): string {
    return (element.di && this.before.byDi.get(element.di)?.id) || element.id;
  }

  cur(id: string): string;
  cur(id: string | undefined): string | undefined;
  cur(id: string | undefined): string | undefined {
    return this.before.currentId(id);
  }

  oldTitle(shape: DShape): Box | undefined {
    const was = shape.di ? this.before.byDi.get(shape.di) : undefined;
    return was?.bounds && was.kind === 'subProcess' && was.expanded === true ? Frames.titleBox(was.bounds, this.before.names.get(was.id)) : undefined;
  }

  sets(): RunSets {
    const { reroute, newEdges, fromEngine, active, relocated, grown, routedNow } = this;
    return { reroute: new Set(reroute), newEdges: new Set(newEdges), fromEngine: new Set(fromEngine), active: new Set(active), relocated: new Set(relocated), grown: new Set(grown), routedNow: new Map(routedNow) };
  }

  restoreSets(sets: RunSets): void {
    Object.assign(this, { ...sets, reroute: new Set(sets.reroute), newEdges: new Set(sets.newEdges), fromEngine: new Set(sets.fromEngine), active: new Set(sets.active), relocated: new Set(sets.relocated), grown: new Set(sets.grown), routedNow: new Map(sets.routedNow) });
  }
}
