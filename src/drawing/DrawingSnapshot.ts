import { Box, ChangeEntries, DiagramIndex, DrawingPruner, Point, Polyline, type BpmnDocument, type BpmnElement } from '../model/index.js';
import { Stickies, type ResolvedAnchor, type StickyAnchor } from './diagram/Stickies.js';
import { Plane } from './plane/Plane.js';
import { PlaneReader, type EdgeEnds } from './plane/PlaneReader.js';
import { Semantics } from './plane/Semantics.js';

export interface SnapEntry {
  id: string;
  bpmnPlane?: BpmnElement | undefined;
  type: string;
  kind: string;
  bounds?: Box;
  label?: Box | undefined;
  points?: Point[];
  expanded?: boolean | undefined;
  laneId?: string | undefined;
  poolId?: string | undefined;
  parentId?: string | undefined;
  sourceId?: string | undefined;
  targetId?: string | undefined;
}

export interface ChangedEnd {
  end: 'source' | 'target';
  id: string;
}

export interface RedrawnElements {
  moved: string[];
  rerouted: string[];
}

export class DrawingSnapshot {
  readonly byPlaneElement = new Map<BpmnElement, SnapEntry>();
  readonly scopeOf = new Map<string, string>();
  readonly hostOf = new Map<string, string>();
  readonly names = new Map<string, string>();
  readonly groupNames = new Map<BpmnElement, string>();
  readonly flowEnds = new Map<string, EdgeEnds>();
  rootId: string | undefined;
  flowNodeShapes = 0;
  stickies: StickyAnchor[] = [];

  private constructor(
    readonly els: Map<string, BpmnElement>,
    readonly laneOf: Map<string, string>,
  ) {}

  static of(document: BpmnDocument): DrawingSnapshot {
    const { definitions } = document.tree;
    const semantics = Semantics.of(definitions);
    const snapshot = new DrawingSnapshot(new Map(semantics.byId), new Map(semantics.laneOf));
    snapshot.rootId = document.diagram.layoutRoot()?.peek<string>('id');
    for (const [id, scope] of semantics.scopeOf) {
      const scopeId = scope.peek<string>('id');
      if (scopeId) {
        snapshot.scopeOf.set(id, scopeId);
      }
    }
    for (const [id, element] of semantics.byId) {
      snapshot.noteElement(id, element);
    }
    for (const plane of new PlaneReader(definitions, semantics).planes()) {
      snapshot.notePlane(plane);
    }
    snapshot.stickies = new Stickies(definitions).anchors();
    return snapshot;
  }

  isEmpty(): boolean {
    return this.flowNodeShapes === 0;
  }

  currentId(oldId: string): string;
  currentId(oldId: string | undefined): string | undefined;
  currentId(oldId: string | undefined): string | undefined {
    if (oldId === undefined) {
      return undefined;
    }
    return this.els.get(oldId)?.peek<string>('id') ?? oldId;
  }

  redrawnIn({ tree }: BpmnDocument): RedrawnElements {
    const drawn = new Map([...this.byPlaneElement.values()].map((entry) => [this.currentId(entry.id), entry]));
    const planes = new PlaneReader(tree.definitions, Semantics.of(tree.definitions)).planes();
    const moved = planes.flatMap((plane) => [...plane.shapes.values()]).filter(({ id, bounds }) => !Box.same(drawn.get(id)?.bounds, bounds));
    const rerouted = planes.flatMap((plane) => [...plane.edges.values()]).filter(({ id, points }) => !new Polyline(drawn.get(id)?.points ?? []).same(new Polyline(points)));
    return { moved: moved.map(({ id }) => id), rerouted: rerouted.map(({ id }) => id) };
  }

  changedEnds(edge: BpmnElement): ChangedEnd[] {
    const old = this.byPlaneElement.get(edge);
    const element = edge.peek<BpmnElement>('bpmnElement');
    if (!old || !element || (old.kind !== 'sequenceFlow' && old.kind !== 'messageFlow')) {
      return [];
    }
    const now = PlaneReader.edgeEnds(element);
    const changed: ChangedEnd[] = [];
    if (this.endNow(old.sourceId) !== now.sourceId) {
      changed.push({ end: 'source', id: now.sourceId ?? '' });
    }
    if (this.endNow(old.targetId) !== now.targetId) {
      changed.push({ end: 'target', id: now.targetId ?? '' });
    }
    return changed;
  }

  pruneReEnded(definitions: BpmnElement): string[] {
    return DrawingPruner.pruneEdges(definitions, (edge, plane, further) => {
      const ends = further ? this.changedEnds(edge) : [];
      return ends.length > 0 && !ends.every((end) => DrawingSnapshot.reaches(edge, plane, end));
    });
  }

  resolvedAnchors(document: BpmnDocument): ResolvedAnchor[] {
    return this.stickies.flatMap((sticky) => {
      const processId = sticky.process.peek<string>('id');
      const nodeId = sticky.node.peek<string>('id');
      if (!processId || !nodeId || document.tree.byId(processId) !== sticky.process || !document.tree.byId(nodeId)) {
        return [];
      }
      return [{ processId, index: sticky.index, ...(sticky.stickyId !== undefined ? { stickyId: sticky.stickyId } : {}), nodeId, centre: sticky.centre }];
    });
  }

  private static reaches(edge: BpmnElement, plane: BpmnElement, { end, id }: ChangedEnd): boolean {
    const shape = plane.list('planeElement').find((element) => element.is('bpmndi:BPMNShape') && element.peek<BpmnElement>('bpmnElement')?.peek<string>('id') === id);
    const box = id ? DiagramIndex.boxOf(shape?.peek<BpmnElement>('bounds')) : undefined;
    const points = edge.list('waypoint').map((waypoint) => new Point(waypoint.peek<number>('x') ?? 0, waypoint.peek<number>('y') ?? 0));
    const point = end === 'source' ? points[0] : points.at(-1);
    return !!box && !!point && points.length >= 2 && box.contains(point, Plane.DETACHED_GAP);
  }

  private endNow(oldId: string | undefined): string | undefined {
    const element = oldId === undefined ? undefined : this.els.get(oldId);
    return (element && ChangeEntries.successorOf(element).peek<string>('id')) ?? oldId;
  }

  private noteElement(id: string, element: BpmnElement): void {
    const name = element.peek<string>('name');
    if (name !== undefined) {
      this.names.set(id, name);
    }
    if (element.is('bpmn:Group')) {
      this.groupNames.set(element, element.name ?? '');
    }
    if (element.is('bpmn:SequenceFlow')) {
      this.flowEnds.set(id, PlaneReader.edgeEnds(element));
    }
    const host = element.is('bpmn:BoundaryEvent') ? element.peek<BpmnElement>('attachedToRef')?.peek<string>('id') : undefined;
    if (host) {
      this.hostOf.set(id, host);
    }
  }

  private notePlane(plane: Plane): void {
    for (const shape of plane.shapes.values()) {
      if (shape.planeElement) {
        if (shape.el.is('bpmn:FlowNode')) {
          this.flowNodeShapes++;
        }
        const { id, kind, bounds, label, expanded, laneId, poolId, parentId } = shape;
        this.byPlaneElement.set(shape.planeElement, { id, bpmnPlane: plane.bpmnPlane, type: shape.el.type, kind, bounds: bounds.copy(), label: label?.copy(), expanded, laneId, poolId, parentId });
      }
    }
    for (const edge of plane.edges.values()) {
      if (edge.planeElement) {
        const { id, kind, points, label, sourceId, targetId } = edge;
        this.byPlaneElement.set(edge.planeElement, { id, bpmnPlane: plane.bpmnPlane, type: edge.el.type, kind, points: new Polyline(points).copy(), label: label?.copy(), sourceId, targetId });
      }
    }
  }
}
