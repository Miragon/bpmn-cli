import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { LayoutDebug } from '../LayoutDebug.js';
import { is, type El } from '../../model/utils/moddle.js';
import { segmentHits } from '../../drawing/utils/geom.js';
import { hasExternalLabel } from '../../drawing/utils/labels.js';
import { idOf, raw, rawList } from '../../drawing/utils/raw.js';
import { DiagramReader } from '../../drawing/DiagramReader.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';
import type { DEdge, Plane } from '../../drawing/types.js';
import type { EdgeBefore } from './EdgeRouter.js';

/**
 * The connections of an incremental run: routed while a batch places its nodes (what the next
 * single command would see), then every new one and every kept one whose end changed, was placed
 * or that broke is routed again.
 */
export class IncrementalRouting {
  constructor(
    private readonly run: IncrementalLayout,
    private readonly snap: Snapshot,
    /** every connection's state before anything moved */
    private readonly edgesBefore: ReadonlyMap<DEdge, EdgeBefore>,
  ) {}

  private edgeIndex(planes: readonly Plane[]): Map<string, { plane: Plane; edge: DEdge }> {
    const out = new Map<string, { plane: Plane; edge: DEdge }>();
    for (const plane of planes) for (const e of plane.edges.values()) out.set(e.id, { plane, edge: e });
    return out;
  }

  private isConnection(el: El): boolean {
    return is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');
  }

  /**
   * A node a batch just placed: its sequence flows to drawn nodes, its label and the connections
   * the placement broke (not message flows) are routed now, and the spacing is measured again, so
   * the next placement sees what the next single command would. Step 8 routes such a flow again
   * only when it broke since.
   */
  routeNow(plane: Plane, id: string): void {
    const s = plane.shapes.get(id);
    const el = this.run.sem.byId.get(id);
    if (!s || !el) return;
    for (const f of [...rawList(el, 'incoming'), ...rawList(el, 'outgoing')]) {
      const fid = idOf(f);
      if (!fid || !is(f, 'bpmn:SequenceFlow')) continue;
      const ends = DiagramReader.edgeEnds(f);
      const other = ends.sourceId === id ? ends.targetId : ends.sourceId;
      if (!other || !plane.shapes.has(other) || this.run.planes.some((p) => p !== plane && p.edges.has(fid))) continue;
      let e = plane.edges.get(fid);
      if (!e) {
        e = { id: fid, el: f, kind: 'sequenceFlow', ...ends, points: [] };
        plane.edges.set(fid, e);
        this.run.newEdges.add(fid);
      } else {
        e.sourceId = ends.sourceId;
        e.targetId = ends.targetId;
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[route] ${fid}: ${this.run.newEdges.has(fid) ? 'new' : 'end placed'}, routed when ${id} was placed`);
      this.routeKept(plane, e);
    }
    // what the placement broke (the space tool, a new shape on a line) is routed again now
    const detached = !PlaneQuery.verticalBand(plane);
    for (const e of plane.edges.values()) {
      if (e.kind === 'messageFlow' || e.points.length < 2 || e.sourceId === id || e.targetId === id || !e.sourceId || !e.targetId) continue;
      const ends = DiagramReader.edgeEnds(e.el);
      // an end that changes later (a flow into a node still to be placed) is routed then
      if (ends.sourceId !== e.sourceId || ends.targetId !== e.targetId || !plane.shapes.has(e.sourceId) || !plane.shapes.has(e.targetId)) continue;
      const was = this.run.routedNow.get(e.id) ?? this.edgesBefore.get(e);
      if (!was || (!this.run.drawing(plane).brokenEdge(e, was, { detached }) && !(this.run.place.continued?.has(id) && this.grazes(plane, e, [id])))) continue;
      if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: broken when ${id} was placed`);
      this.routeKept(plane, e);
    }
    if (!s.label && hasExternalLabel(s) && raw<string>(el, 'name')) this.run.drawing(plane).placeShapeLabel(s);
    // the next command would measure the drawing's gap and row spacing again, with these flows
    this.run.place.spacing.set(plane, PlaneQuery.spacingOf(plane));
  }

  /** Routes a connection during placement (routeNow) and records its state then. */
  private routeKept(plane: Plane, e: DEdge): void {
    const drawing = this.run.drawing(plane);
    if (!drawing.reroute(e)) return;
    this.run.routedNow.set(e.id, drawing.edgeBefore(e));
  }

  /** Creates DEdges for connections without DI and collects every edge to (re)route. */
  collectEdges(before: Map<DEdge, EdgeBefore>): void {
    const edges = this.edgeIndex(this.run.planes);
    for (const el of this.run.modelOrder(this.run.doc.definitions)) {
      const id = idOf(el);
      if (!id || !this.isConnection(el)) continue;
      const ends = DiagramReader.edgeEnds(el);
      const home = is(el, 'bpmn:MessageFlow') ? this.run.sem.homePlane(this.run.planes, id) : this.run.planes.find((p) => (!ends.sourceId || p.shapes.has(ends.sourceId) || p.edges.has(ends.sourceId)) && (!ends.targetId || p.shapes.has(ends.targetId) || p.edges.has(ends.targetId)));
      const have = edges.get(id);
      if (!home) continue;
      if (have && have.plane !== home) {
        have.plane.edges.delete(id);
        home.edges.set(id, have.edge);
        this.run.reroute.add(id);
      } else if (!have) {
        home.edges.set(id, { id, el, kind: DiagramReader.edgeKind(el), ...ends, points: [] });
        this.run.newEdges.add(id);
      }
    }
    for (const plane of this.run.planes) {
      // a line not reaching its ends is routed again, except on vertical pools / lanes
      const detached = !PlaneQuery.verticalBand(plane);
      for (const e of plane.edges.values()) {
        if (this.run.fromEngine.has(e.id)) continue;
        // routed when its second end was placed: kept unless it broke since
        const now = this.run.routedNow.get(e.id);
        if (now) {
          const ends = DiagramReader.edgeEnds(e.el);
          if (ends.sourceId === e.sourceId && ends.targetId === e.targetId && e.points.length >= 2 && !this.run.drawing(plane).brokenEdge(e, now, { detached }) && !this.grazes(plane, e, this.run.place.continued)) continue;
          this.run.reroute.add(e.id);
          if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: broken after it was routed`);
          continue;
        }
        if (this.run.newEdges.has(e.id)) {
          this.run.reroute.add(e.id);
          continue;
        }
        const old = e.di ? this.snap.byDi.get(e.di) : undefined;
        const ends = DiagramReader.edgeEnds(e.el);
        e.sourceId = ends.sourceId;
        e.targetId = ends.targetId;
        // the ends compared by their ids now: renaming an end (`set id=`) changes nothing here
        const why =
          old && (this.run.cur(old.sourceId) !== ends.sourceId || this.run.cur(old.targetId) !== ends.targetId)
            ? 'ends changed'
            : (e.sourceId && this.run.place.placed.has(e.sourceId)) || (e.targetId && this.run.place.placed.has(e.targetId))
              ? 'end placed'
              : this.run.drawing(plane).brokenEdge(e, before.get(e), { detached })
                ? 'broken'
                : this.grazes(plane, e, this.run.place.continued)
                  ? 'runs along a new shape'
                  : undefined;
        if (why) {
          this.run.reroute.add(e.id);
          if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: ${why}`);
        }
      }
    }
  }

  /**
   * Whether a connection runs along the border of one of `ids` or touches it (reads as docking on
   * it): checked for nodes continuing a chain. Its own ends, their boundary events and hosts do
   * not count.
   */
  private grazes(plane: Plane, e: DEdge, ids: Iterable<string> | undefined): boolean {
    if (!ids || e.points.length < 2) return false;
    const own = new Set<string>();
    for (const end of [e.sourceId, e.targetId]) {
      const s = end ? plane.shapes.get(end) : undefined;
      if (!s) continue;
      own.add(s.id);
      if (s.hostId) own.add(s.hostId);
      for (const b of PlaneQuery.boundariesOf(plane, s.id)) own.add(b.id);
    }
    for (const id of ids) {
      const s = plane.shapes.get(id);
      if (!s || own.has(id) || !PlaneQuery.isLeaf(s)) continue;
      for (let i = 0; i + 1 < e.points.length; i++) if (segmentHits(e.points[i]!, e.points[i + 1]!, s.bounds, -1)) return true;
    }
    return false;
  }

  /** Routes every collected edge; returns the kept ones routed again. */
  routeAll(): string[] {
    const rerouted: string[] = [];
    for (const plane of this.run.planes) {
      // message flows after the sequence flows (they see the final ones), edges on edges last
      const drawing = this.run.drawing(plane);
      const pending = drawing.routeOrder([...plane.edges.values()].filter((e) => this.run.reroute.has(e.id)));
      const waiting = new Set(pending.map((e) => e.id));
      for (const e of pending) {
        const lines = drawing.routingLines(e.id).filter((l) => ![...waiting].some((id) => plane.edges.get(id)?.points === l));
        const routed = drawing.reroute(e, { lines });
        waiting.delete(e.id);
        if (!routed) {
          if (!e.points.length) {
            plane.edges.delete(e.id);
            this.run.newEdges.delete(e.id);
            this.run.notes.push(`${e.id} not drawn: an end has no shape on its diagram`);
          }
          continue;
        }
        if (!this.run.newEdges.has(e.id)) rerouted.push(e.id);
      }
    }
    return rerouted;
  }
}
