import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { LayoutDebug } from '../LayoutDebug.js';
import { is, type El } from '../../../document/utils/moddle.js';
import { hasExternalLabel } from '../../utils/labels.js';
import { idOf, raw, rawList } from '../../utils/raw.js';
import { DiagramReader } from '../../di/DiagramReader.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import type { DEdge, Plane } from '../../di/types.js';
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
    for (const plane of planes) for (const edge of plane.edges.values()) out.set(edge.id, { plane, edge });
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
   * What the placement broke (the space tool, a new shape on a line, an association a new shape
   * touches) is routed again now; a flow whose end changes later (into a node still to be placed)
   * is routed then.
   */
  routeNow(plane: Plane, id: string): void {
    const shape = plane.shapes.get(id);
    const el = this.run.sem.byId.get(id);
    if (!shape || !el) return;
    for (const flow of [...rawList(el, 'incoming'), ...rawList(el, 'outgoing')]) {
      const fid = idOf(flow);
      if (!fid || !is(flow, 'bpmn:SequenceFlow')) continue;
      const ends = DiagramReader.edgeEnds(flow);
      const other = ends.sourceId === id ? ends.targetId : ends.sourceId;
      if (!other || !plane.shapes.has(other) || this.run.planes.some((otherPlane) => otherPlane !== plane && otherPlane.edges.has(fid))) continue;
      let edge = plane.edges.get(fid);
      if (!edge) {
        edge = { id: fid, el: flow, kind: 'sequenceFlow', ...ends, points: [] };
        plane.edges.set(fid, edge);
        this.run.newEdges.add(fid);
      } else {
        edge.sourceId = ends.sourceId;
        edge.targetId = ends.targetId;
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[route] ${fid}: ${this.run.newEdges.has(fid) ? 'new' : 'end placed'}, routed when ${id} was placed`);
      this.routeKept(plane, edge);
    }
    const detached = !PlaneQuery.verticalBand(plane);
    const drawing = this.run.drawing(plane);
    for (const edge of plane.edges.values()) {
      if (edge.kind === 'messageFlow' || edge.points.length < 2 || edge.sourceId === id || edge.targetId === id || !edge.sourceId || !edge.targetId) continue;
      const ends = DiagramReader.edgeEnds(edge.el);
      if (ends.sourceId !== edge.sourceId || ends.targetId !== edge.targetId || !plane.shapes.has(edge.sourceId) || !plane.shapes.has(edge.targetId)) continue;
      const was = this.run.routedNow.get(edge.id) ?? this.edgesBefore.get(edge);
      if (!was || (!drawing.brokenEdge(edge, was, { detached }) && !(this.run.place.continued?.has(id) && drawing.grazes(edge, [id])) && !drawing.touchesFresh(edge))) continue;
      if (LayoutDebug.on()) LayoutDebug.log(`[route] ${edge.id}: broken when ${id} was placed`);
      this.routeKept(plane, edge);
    }
    if (!shape.label && hasExternalLabel(shape) && raw<string>(el, 'name')) drawing.placeShapeLabel(shape);
    this.run.place.spacing.delete(plane);
  }

  /** Routes a connection during placement (routeNow) and records its state then. */
  private routeKept(plane: Plane, edge: DEdge): void {
    const drawing = this.run.drawing(plane);
    if (!drawing.reroute(edge)) return;
    this.run.routedNow.set(edge.id, drawing.edgeBefore(edge));
  }

  /**
   * Creates DEdges for connections without DI and collects every edge to (re)route.
   * A line not reaching its ends is routed again, except on vertical pools / lanes, and so is an
   * association a new node or its label touches; one routed when its second end was placed is kept
   * unless it broke since. Ends are compared by their ids now, so renaming an end (`set id=`)
   * changes nothing.
   */
  collectEdges(before: Map<DEdge, EdgeBefore>): void {
    const edges = this.edgeIndex(this.run.planes);
    for (const el of this.run.modelOrder(this.run.doc.definitions)) {
      const id = idOf(el);
      if (!id || !this.isConnection(el)) continue;
      const ends = DiagramReader.edgeEnds(el);
      const home = is(el, 'bpmn:MessageFlow') ? this.run.sem.homePlane(this.run.planes, id) : this.run.planes.find((plane) => (!ends.sourceId || plane.shapes.has(ends.sourceId) || plane.edges.has(ends.sourceId)) && (!ends.targetId || plane.shapes.has(ends.targetId) || plane.edges.has(ends.targetId)));
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
    const continued = this.run.place.continued ?? [];
    for (const plane of this.run.planes) {
      const detached = !PlaneQuery.verticalBand(plane);
      const drawing = this.run.drawing(plane);
      for (const edge of plane.edges.values()) {
        if (this.run.fromEngine.has(edge.id)) continue;
        const now = this.run.routedNow.get(edge.id);
        if (now) {
          const ends = DiagramReader.edgeEnds(edge.el);
          if (ends.sourceId === edge.sourceId && ends.targetId === edge.targetId && edge.points.length >= 2 && !drawing.brokenEdge(edge, now, { detached }) && !drawing.grazes(edge, continued) && !drawing.touchesFresh(edge)) continue;
          this.run.reroute.add(edge.id);
          if (LayoutDebug.on()) LayoutDebug.log(`[route] ${edge.id}: broken after it was routed`);
          continue;
        }
        if (this.run.newEdges.has(edge.id)) {
          this.run.reroute.add(edge.id);
          continue;
        }
        const old = edge.di ? this.snap.byDi.get(edge.di) : undefined;
        const ends = DiagramReader.edgeEnds(edge.el);
        edge.sourceId = ends.sourceId;
        edge.targetId = ends.targetId;
        const why =
          old && (this.run.cur(old.sourceId) !== ends.sourceId || this.run.cur(old.targetId) !== ends.targetId)
            ? 'ends changed'
            : (edge.sourceId && this.run.place.placed.has(edge.sourceId)) || (edge.targetId && this.run.place.placed.has(edge.targetId))
              ? 'end placed'
              : drawing.brokenEdge(edge, before.get(edge), { detached })
                ? 'broken'
                : drawing.grazes(edge, continued)
                  ? 'runs along a new shape'
                  : drawing.touchesFresh(edge)
                    ? 'touches a new shape'
                    : undefined;
        if (why) {
          this.run.reroute.add(edge.id);
          if (LayoutDebug.on()) LayoutDebug.log(`[route] ${edge.id}: ${why}`);
        }
      }
    }
  }

  /**
   * Once the labels are settled (the last node's is placed after the routing, a repair route may
   * run over one): a kept association that a node placed in this run or its label touches is
   * routed again, once, and the labels its line then runs over step aside (one placed before a
   * repair route ran over it too). A route that still touches one keeps the drawn line, whose
   * labels step aside all the same. Returns the ones routed again.
   */
  routeGrazed(): string[] {
    return this.run.planes.flatMap((plane) => {
      const drawing = this.run.drawing(plane);
      const touched = [...plane.edges.values()].filter((edge) => !this.run.newEdges.has(edge.id) && drawing.touchesFresh(edge));
      const routed = touched.filter((edge) => {
        const drawn = { points: edge.points, label: edge.label };
        if (!drawing.reroute(edge)) return false;
        if (!drawing.touchesFresh(edge)) return true;
        Object.assign(edge, drawn);
        return false;
      });
      drawing.clearLabels(touched);
      return routed.map((edge) => edge.id);
    });
  }

  /**
   * Routes every collected edge; returns the kept ones routed again.
   * Message flows go after the sequence flows (they see the final ones), edges on edges last.
   */
  routeAll(): string[] {
    const rerouted: string[] = [];
    for (const plane of this.run.planes) {
      const drawing = this.run.drawing(plane);
      const pending = drawing.routeOrder([...plane.edges.values()].filter((edge) => this.run.reroute.has(edge.id)));
      const waiting = new Set(pending.map((edge) => edge.id));
      for (const edge of pending) {
        const lines = drawing.routingLines(edge.id).filter((line) => ![...waiting].some((id) => plane.edges.get(id)?.points === line));
        const routed = drawing.reroute(edge, { lines });
        waiting.delete(edge.id);
        if (!routed) {
          if (!edge.points.length) {
            plane.edges.delete(edge.id);
            this.run.newEdges.delete(edge.id);
            this.run.notes.push(`${edge.id} not drawn: an end has no shape on its diagram`);
          }
          continue;
        }
        if (!this.run.newEdges.has(edge.id)) rerouted.push(edge.id);
      }
    }
    return rerouted;
  }
}
