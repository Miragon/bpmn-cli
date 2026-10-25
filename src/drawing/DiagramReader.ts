import { is, type El } from '../model/utils/moddle.js';
import type { DEdge, DShape, EdgeKind, Plane, ShapeKind } from './types.js';
import { Semantics } from './Semantics.js';
import { boxOf, idOf, raw, rawList } from './utils/raw.js';

/**
 * Reads every BPMNDiagram's plane into shapes and edges the incremental engine moves without
 * touching moddle: bounds, waypoints and labels are copied, `el` / `di` stay the live objects.
 * Membership (lane, pool, parent, host) comes from the semantic model, never from geometry.
 */
export class DiagramReader {
  constructor(
    private readonly defs: El,
    readonly sem: Semantics = Semantics.of(defs),
  ) {}

  static shapeKind(el: El): ShapeKind {
    if (is(el, 'bpmn:BoundaryEvent')) return 'boundary';
    if (is(el, 'bpmn:Event')) return 'event';
    if (is(el, 'bpmn:Gateway')) return 'gateway';
    if (Semantics.isSubProcess(el)) return 'subProcess';
    if (is(el, 'bpmn:Activity')) return 'task';
    if (is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:DataInput') || is(el, 'bpmn:DataOutput')) return 'data';
    if (is(el, 'bpmn:TextAnnotation')) return 'annotation';
    if (is(el, 'bpmn:Participant')) return 'participant';
    if (is(el, 'bpmn:Lane')) return 'lane';
    if (is(el, 'bpmn:Group')) return 'group';
    return 'other';
  }

  static edgeKind(el: El): EdgeKind {
    if (is(el, 'bpmn:SequenceFlow')) return 'sequenceFlow';
    if (is(el, 'bpmn:MessageFlow')) return 'messageFlow';
    if (is(el, 'bpmn:Association')) return 'association';
    if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
    return 'other';
  }

  /** A data association's activity is its parent element. */
  static edgeEnds(el: El): { sourceId?: string; targetId?: string } {
    if (is(el, 'bpmn:DataInputAssociation')) {
      const src = rawList(el, 'sourceRef')[0];
      return { sourceId: idOf(src), targetId: idOf(el.$parent) };
    }
    if (is(el, 'bpmn:DataOutputAssociation')) return { sourceId: idOf(el.$parent), targetId: idOf(raw(el, 'targetRef')) };
    return { sourceId: idOf(raw(el, 'sourceRef')), targetId: idOf(raw(el, 'targetRef')) };
  }

  /** A plane without bpmnElement shows the first process or collaboration, as in bpmn-js. */
  static displayRoot(defs: El | undefined): El | undefined {
    return rawList(defs, 'rootElements').find((r) => is(r, 'bpmn:Process') || is(r, 'bpmn:Collaboration'));
  }

  /** Undefined without valid bounds: the element counts as undrawn. */
  private readShape(di: El, el: El, id: string): DShape | undefined {
    const bounds = boxOf(raw(di, 'bounds'));
    if (!bounds) return undefined;
    const kind = DiagramReader.shapeKind(el);
    const expanded = kind === 'subProcess' ? raw<boolean>(di, 'isExpanded') === true : undefined;
    const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true);
    const label = boxOf(raw(raw(di, 'label'), 'bounds'));
    const s: DShape = { id, el, di, bounds, kind, container };
    if (expanded !== undefined) s.expanded = expanded;
    if (label) s.label = label;
    if (kind === 'boundary') {
      const host = idOf(raw(el, 'attachedToRef'));
      if (host) s.hostId = host;
    }
    const lane = kind === 'lane' ? this.sem.laneParent.get(id) : this.sem.laneOf.get(id);
    if (lane) s.laneId = lane;
    const pool = this.sem.poolOf(id);
    if (pool) s.poolId = pool;
    return s;
  }

  private readEdge(di: El, el: El, id: string): DEdge {
    const points = rawList(di, 'waypoint').map((w) => ({ x: raw<number>(w, 'x') ?? 0, y: raw<number>(w, 'y') ?? 0 }));
    const label = boxOf(raw(raw(di, 'label'), 'bounds'));
    const e: DEdge = { id, el, di, kind: DiagramReader.edgeKind(el), points, ...DiagramReader.edgeEnds(el) };
    if (label) e.label = label;
    return e;
  }

  private linkParents(plane: Plane): void {
    for (const s of plane.shapes.values()) {
      const scope = this.sem.scopeOf.get(s.id);
      const sid = idOf(scope);
      if (!scope || !sid || !Semantics.isSubProcess(scope)) continue;
      const parent = plane.shapes.get(sid);
      if (parent?.expanded) s.parentId = sid;
    }
  }

  plane(diagram: El): Plane | undefined {
    const di = raw<El>(diagram, 'plane');
    const root = raw<El>(di, 'bpmnElement') ?? (di ? DiagramReader.displayRoot(diagram.$parent as El | undefined) : undefined);
    const rootId = idOf(root);
    if (!di || !root || !rootId) return undefined;
    const plane: Plane = { id: idOf(di) ?? `BPMNPlane_${rootId}`, di, rootId, root, shapes: new Map(), edges: new Map(), dropped: [] };
    for (const pe of rawList(di, 'planeElement')) {
      const el = raw<El>(pe, 'bpmnElement');
      const id = idOf(el);
      if (!el || !id) continue;
      if (is(pe, 'bpmndi:BPMNShape')) {
        const s = this.readShape(pe, el, id);
        if (s) plane.shapes.set(id, s);
        else (plane.unbounded ??= new Map()).set(id, pe);
      } else if (is(pe, 'bpmndi:BPMNEdge')) {
        plane.edges.set(id, this.readEdge(pe, el, id));
      }
    }
    this.linkParents(plane);
    return plane;
  }

  planes(): Plane[] {
    const out: Plane[] = [];
    for (const diagram of rawList(this.defs, 'diagrams')) {
      const read = this.plane(diagram);
      if (read) out.push(read);
    }
    return out;
  }
}
