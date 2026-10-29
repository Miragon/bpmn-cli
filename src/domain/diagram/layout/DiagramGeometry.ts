import { is, type El } from '../../document/utils/moddle.js';
import { DiagramReader } from '../di/DiagramReader.js';
import { sameBox, type Box, type Point } from '../utils/geom.js';

/**
 * Everything a drawing shows, keyed by `plane root|element id`:
 * shape bounds, connection waypoints and their labels.
 */
export class DiagramGeometry {
  readonly shapes = new Map<string, { bounds: Box; label?: Box; flowNode: boolean }>();
  readonly edges = new Map<string, { points: Point[]; label?: Box }>();

  static of(defs: El): DiagramGeometry {
    const out = new DiagramGeometry();
    for (const plane of new DiagramReader(defs).planes()) {
      for (const shape of plane.shapes.values()) {
        out.shapes.set(`${plane.rootId}|${shape.id}`, { bounds: shape.bounds, ...(shape.label ? { label: shape.label } : {}), flowNode: is(shape.el, 'bpmn:FlowNode') });
      }
      for (const edge of plane.edges.values()) {
        out.edges.set(`${plane.rootId}|${edge.id}`, { points: edge.points, ...(edge.label ? { label: edge.label } : {}) });
      }
    }
    return out;
  }

  static flowNodeBoxes(defs: El): Map<string, Box> {
    const out = new Map<string, Box>();
    for (const plane of new DiagramReader(defs).planes()) {
      for (const shape of plane.shapes.values()) {
        if (is(shape.el, 'bpmn:FlowNode')) out.set(shape.id, shape.bounds);
      }
    }
    return out;
  }

  /** Any hand edit, including a format op such as route or label, makes the drawing hand-made. */
  drawnBy(laidOut: El, tol = 2): boolean {
    const theirs = DiagramGeometry.of(laidOut);
    if (![...this.shapes.values()].some((shape) => shape.flowNode)) return false;
    if (this.shapes.size !== theirs.shapes.size || this.edges.size !== theirs.edges.size) {
      return false;
    }
    const sameLabel = (first: Box | undefined, second: Box | undefined): boolean => (!first && !second) || (!!first && !!second && sameBox(first, second, tol));
    for (const [key, shape] of this.shapes) {
      const theirShape = theirs.shapes.get(key);
      if (!theirShape || !sameBox(shape.bounds, theirShape.bounds, tol) || !sameLabel(shape.label, theirShape.label)) {
        return false;
      }
    }
    for (const [key, edge] of this.edges) {
      const theirEdge = theirs.edges.get(key);
      if (!theirEdge || theirEdge.points.length !== edge.points.length || !sameLabel(edge.label, theirEdge.label)) {
        return false;
      }
      if (edge.points.some((point, index) => Math.abs(point.x - theirEdge.points[index]!.x) > tol || Math.abs(point.y - theirEdge.points[index]!.y) > tol)) {
        return false;
      }
    }
    return true;
  }
}
