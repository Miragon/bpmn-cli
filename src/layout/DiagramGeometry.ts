import { is, type El } from '../model/utils/moddle.js';
import { readPlanes } from '../diagram/plane.js';
import { sameBox, type Box, type Point } from '../diagram/utils/geom.js';

/**
 * Everything a drawing shows, by `plane root|element id`: the bounds and
 * label of every shape (flow nodes, artifacts, pools, lanes, groups) and the
 * waypoints and label of every connection.
 */
export class DiagramGeometry {
  readonly shapes = new Map<string, { bounds: Box; label?: Box; flowNode: boolean }>();
  readonly edges = new Map<string, { points: Point[]; label?: Box }>();

  static of(defs: El): DiagramGeometry {
    const out = new DiagramGeometry();
    for (const plane of readPlanes(defs)) {
      for (const s of plane.shapes.values()) out.shapes.set(`${plane.rootId}|${s.id}`, { bounds: s.bounds, ...(s.label ? { label: s.label } : {}), flowNode: is(s.el, 'bpmn:FlowNode') });
      for (const e of plane.edges.values()) out.edges.set(`${plane.rootId}|${e.id}`, { points: e.points, ...(e.label ? { label: e.label } : {}) });
    }
    return out;
  }

  /** Bounds of every flow node shape of all diagrams, by element id. */
  static flowNodeBoxes(defs: El): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const plane of readPlanes(defs)) {
      for (const s of plane.shapes.values()) if (is(s.el, 'bpmn:FlowNode')) out.set(s.id, s.bounds);
    }
    return out;
  }

  /**
   * True when this drawing is what the engine drew in `laidOut`: the same
   * shapes and connections, every bound, label and waypoint within `tol` px. A
   * moved annotation, a hand bend, a dragged label or a resized pool (also
   * from a format op such as route or label) makes it hand-made.
   */
  drawnBy(laidOut: El, tol = 2): boolean {
    const theirs = DiagramGeometry.of(laidOut);
    if (![...this.shapes.values()].some((s) => s.flowNode)) return false;
    if (this.shapes.size !== theirs.shapes.size || this.edges.size !== theirs.edges.size) return false;
    const sameLabel = (a: Box | undefined, b: Box | undefined): boolean => (!a && !b) || (!!a && !!b && sameBox(a, b, tol));
    for (const [key, s] of this.shapes) {
      const t = theirs.shapes.get(key);
      if (!t || !sameBox(s.bounds, t.bounds, tol) || !sameLabel(s.label, t.label)) return false;
    }
    for (const [key, e] of this.edges) {
      const t = theirs.edges.get(key);
      if (!t || t.points.length !== e.points.length || !sameLabel(e.label, t.label)) return false;
      if (e.points.some((p, i) => Math.abs(p.x - t.points[i]!.x) > tol || Math.abs(p.y - t.points[i]!.y) > tol)) return false;
    }
    return true;
  }
}
