import { ChangeSet } from '../../../document/ChangeSet.js';
import { is, layoutRoot, type El } from '../../../document/utils/moddle.js';
import { DETACHED_GAP } from './EdgeRouter.js';
import { DiagramReader } from '../../di/DiagramReader.js';
import { Semantics } from '../../di/Semantics.js';
import { containsPoint, copyBox, copyPoints, type Box, type Point } from '../../utils/geom.js';
import { DiPruner } from '../../di/DiPruner.js';
import { boxOf, idOf, raw, rawList } from '../../utils/raw.js';

export interface SnapEntry {
  id: string;
  /** the BPMNPlane the DI element was in */
  planeDi?: El;
  type: string;
  kind: string;
  bounds?: Box;
  label?: Box;
  points?: Point[];
  expanded?: boolean;
  laneId?: string;
  poolId?: string;
  parentId?: string;
  sourceId?: string;
  targetId?: string;
}

/** An end a flow got since the snapshot: which end, and its id now ('' when the flow lost it). */
export interface ChangedEnd {
  end: 'source' | 'target';
  id: string;
}

/**
 * What every DI element showed before the ops, keyed by DI object so renamed and retyped
 * elements are still recognised, plus the semantic facts the incremental layout diffs.
 */
export class Snapshot {
  readonly byDi = new Map<El, SnapEntry>();
  readonly scopeOf = new Map<string, string>();
  readonly hostOf = new Map<string, string>();
  readonly names = new Map<string, string>();
  readonly flowEnds = new Map<string, { sourceId?: string; targetId?: string }>();
  rootId?: string;
  flowNodeShapes = 0;
  /** a stale drawing, e.g. after --no-layout */
  readonly undrawn: string[] = [];

  private constructor(
    /**
     * By the id before the ops: `set id=` renames in place, so idOf(els.get(oldId)) is the id now;
     * a retyped element is a new object with the old id.
     */
    readonly els: Map<string, El>,
    readonly laneOf: Map<string, string>,
  ) {}

  static take(defs: El): Snapshot {
    const sem = Semantics.of(defs);
    const snap = new Snapshot(new Map(sem.byId), new Map(sem.laneOf));
    const rootId = idOf(layoutRoot(defs));
    if (rootId) snap.rootId = rootId;
    for (const [id, scope] of sem.scopeOf) {
      const sid = idOf(scope);
      if (sid) snap.scopeOf.set(id, sid);
    }
    for (const [id, el] of sem.byId) {
      const name = raw<string>(el, 'name');
      if (name !== undefined) snap.names.set(id, name);
      if (is(el, 'bpmn:SequenceFlow')) snap.flowEnds.set(id, { sourceId: idOf(raw(el, 'sourceRef')), targetId: idOf(raw(el, 'targetRef')) });
      const host = is(el, 'bpmn:BoundaryEvent') ? idOf(raw(el, 'attachedToRef')) : undefined;
      if (host) snap.hostOf.set(id, host);
    }
    const planes = new DiagramReader(defs, sem).planes();
    for (const plane of planes) {
      for (const shape of plane.shapes.values()) {
        if (!shape.di) continue;
        if (is(shape.el, 'bpmn:FlowNode')) snap.flowNodeShapes++;
        snap.byDi.set(shape.di, {
          id: shape.id,
          ...(plane.di ? { planeDi: plane.di } : {}),
          type: shape.el.$type,
          kind: shape.kind,
          bounds: copyBox(shape.bounds),
          ...(shape.label ? { label: copyBox(shape.label) } : {}),
          ...(shape.expanded !== undefined ? { expanded: shape.expanded } : {}),
          ...(shape.laneId ? { laneId: shape.laneId } : {}),
          ...(shape.poolId ? { poolId: shape.poolId } : {}),
          ...(shape.parentId ? { parentId: shape.parentId } : {}),
        });
      }
      for (const edge of plane.edges.values()) {
        if (!edge.di) continue;
        snap.byDi.set(edge.di, {
          id: edge.id,
          ...(plane.di ? { planeDi: plane.di } : {}),
          type: edge.el.$type,
          kind: edge.kind,
          points: copyPoints(edge.points),
          ...(edge.label ? { label: copyBox(edge.label) } : {}),
          ...(edge.sourceId ? { sourceId: edge.sourceId } : {}),
          ...(edge.targetId ? { targetId: edge.targetId } : {}),
        });
      }
    }
    if (snap.flowNodeShapes) {
      for (const [id, el] of sem.byId) {
        if (!is(el, 'bpmn:FlowNode')) continue;
        const home = sem.homePlane(planes, id);
        if (home && !home.shapes.has(id)) snap.undrawn.push(id);
      }
    }
    return snap;
  }

  currentId(oldId: string): string;
  currentId(oldId: string | undefined): string | undefined;
  currentId(oldId: string | undefined): string | undefined {
    if (oldId === undefined) return undefined;
    return idOf(this.els.get(oldId)) ?? oldId;
  }

  /** A renamed or retyped end counts as the same end. */
  changedEnds(edge: El): ChangedEnd[] {
    const old = this.byDi.get(edge);
    if (!old || (old.kind !== 'sequenceFlow' && old.kind !== 'messageFlow')) return [];
    const el = raw<El>(edge, 'bpmnElement');
    if (!el) return [];
    const now = DiagramReader.edgeEnds(el);
    const out: ChangedEnd[] = [];
    if (this.endNow(old.sourceId) !== now.sourceId) out.push({ end: 'source', id: now.sourceId ?? '' });
    if (this.endNow(old.targetId) !== now.targetId) out.push({ end: 'target', id: now.targetId ?? '' });
    return out;
  }

  private endNow(oldId: string | undefined): string | undefined {
    const el = oldId === undefined ? undefined : this.els.get(oldId);
    return (el && idOf(ChangeSet.successorOf(el))) ?? oldId;
  }

  /**
   * Deletes edges still showing a flow's old ends; one already reaching the new ends stays.
   * `further` limits this to a root's extra diagrams, which the incremental layout never draws.
   * On a first diagram an edge whose new end has no shape yet (--no-layout) stays.
   */
  pruneReEnded(defs: El, opts: { further?: boolean } = {}): string[] {
    const drawn = new Map<El, Map<string, Box>>();
    const boundsOn = (plane: El): Map<string, Box> => {
      let shapes = drawn.get(plane);
      if (!shapes) {
        drawn.set(plane, (shapes = new Map()));
        for (const pe of rawList(plane, 'planeElement')) {
          const id = is(pe, 'bpmndi:BPMNShape') ? idOf(raw(pe, 'bpmnElement')) : undefined;
          const box = id ? boxOf(raw(pe, 'bounds')) : undefined;
          if (id && box && !shapes.has(id)) shapes.set(id, box);
        }
      }
      return shapes;
    };
    return DiPruner.pruneEdges(defs, (edge, plane, further) => {
      if (opts.further && !further) return false;
      const ends = this.changedEnds(edge);
      if (!ends.length) return false;
      const shapes = boundsOn(plane);
      if (!further && ends.some((end) => end.id && !shapes.has(end.id))) return false;
      const pts = rawList(edge, 'waypoint').map((waypoint) => ({ x: raw<number>(waypoint, 'x') ?? 0, y: raw<number>(waypoint, 'y') ?? 0 }));
      const reached = (end: ChangedEnd): boolean => {
        const box = end.id ? shapes.get(end.id) : undefined;
        const point = end.end === 'source' ? pts[0] : pts[pts.length - 1];
        return !!box && !!point && pts.length >= 2 && containsPoint(box, point, DETACHED_GAP);
      };
      return !ends.every(reached);
    });
  }
}
