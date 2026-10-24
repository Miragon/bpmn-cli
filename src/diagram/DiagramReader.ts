/**
 * The diagram as plain data: every BPMNDiagram's plane read into shapes and
 * edges the incremental engine can move around without touching moddle.
 *
 * CONTRACT
 *  - readPlanes(defs, sem) returns one Plane per BPMNDiagram (document order).
 *    Every BPMNShape / BPMNEdge whose bpmnElement resolves to an element with
 *    an id becomes a DShape / DEdge keyed by that id; bounds, waypoints and
 *    label bounds are COPIED (write.ts writes them back), `el` / `di` point at
 *    the live moddle objects.
 *    A plane without bpmnElement shows displayRoot(defs) (as in bpmn-js);
 *    write.ts then records that root on it.
 *    A BPMNShape without valid bounds is not a shape: its element counts as
 *    undrawn, the DI is kept in `unbounded` for the placement to reuse.
 *  - Membership comes from the semantic model, never from geometry:
 *      laneId   innermost lane listing the node in flowNodeRef (nested lanes
 *               included); for a lane: its parent lane
 *      poolId   the participant whose processRef is the element's process
 *               (walking out of sub-processes); for a lane: its pool
 *      parentId the sub-process directly containing the element, when that
 *               sub-process is drawn expanded on the same plane
 *      hostId   the activity a boundary event is attached to
 *  - Reading is side-effect free: properties are read directly, never through
 *    `get()` (which would materialise empty collections on the model).
 *  - semantics(defs) indexes the semantic model once (ids, lanes, pools,
 *    scopes); homePlane() says on which plane an element's DI belongs.
 */
import { is, type El } from '../model/utils/moddle.js';
import type { DEdge, DShape, Plane } from './types.js';
import { Semantics } from './Semantics.js';
import { boxOf, displayRoot, edgeEnds, edgeKind, idOf, isSubProcess, raw, rawList, shapeKind } from './utils/plane.js';

export class DiagramReader {
  constructor(
    private readonly defs: El,
    readonly sem: Semantics = Semantics.of(defs),
  ) {}

  private readShape(di: El, el: El, id: string): DShape | undefined {
    const bounds = boxOf(raw(di, 'bounds'));
    if (!bounds) return undefined;
    const kind = shapeKind(el);
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
    const e: DEdge = { id, el, di, kind: edgeKind(el), points, ...edgeEnds(el) };
    if (label) e.label = label;
    return e;
  }

  /** Sets parentId for shapes whose sub-process is drawn expanded on the same plane. */
  private linkParents(plane: Plane): void {
    for (const s of plane.shapes.values()) {
      const scope = this.sem.scopeOf.get(s.id);
      const sid = idOf(scope);
      if (!scope || !sid || !isSubProcess(scope)) continue;
      const parent = plane.shapes.get(sid);
      if (parent?.expanded) s.parentId = sid;
    }
  }

  plane(diagram: El): Plane | undefined {
    const di = raw<El>(diagram, 'plane');
    const root = raw<El>(di, 'bpmnElement') ?? (di ? displayRoot(diagram.$parent as El | undefined) : undefined);
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
