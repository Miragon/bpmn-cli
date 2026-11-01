import { Box, DiagramIndex, Point } from '../../../model/index.js';
import type { Block } from '../../full/FullLayout.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import type { LayoutRun } from '../run/LayoutRun.js';

export class BlockAdopter {
  constructor(private readonly run: LayoutRun) {}

  private static moved({ x, y, width, height }: Box, dx: number, dy: number): Box {
    return new Box(x + dx, y + dy, width, height);
  }

  adopt(plane: Plane, block: Block, dx: number, dy: number): void {
    const containersFirst = [...block.shapes].sort((first, second) => Number(second.container) - Number(first.container));
    containersFirst.forEach((shape) => this.adoptShape(shape, plane, dx, dy));
    this.linkParents(plane);
    block.edges.forEach((edge) => this.adoptEdge(edge, plane, dx, dy));
    block.planes.forEach((blockPlane) => this.adoptPlane(blockPlane));
  }

  private adoptShape(shape: DShape, target: Plane, dx: number, dy: number): void {
    if (!this.run.semantics.byId.has(shape.id) || target.shapes.has(shape.id)) {
      return;
    }
    const copy = this.run.place.newShape(target, shape.id, BlockAdopter.moved(shape.bounds, dx, dy));
    if (shape.label) {
      copy.label = BlockAdopter.moved(shape.label, dx, dy);
    }
    if (shape.kind === 'subProcess') {
      copy.expanded = shape.expanded === true;
      copy.container = shape.expanded === true;
    }
    target.shapes.set(shape.id, copy);
    this.run.place.placed.add(shape.id);
    this.run.fromEngine.add(shape.id);
  }

  private linkParents(plane: Plane): void {
    for (const shape of plane.shapes.values()) {
      const scope = this.run.semantics.scopeOf.get(shape.id);
      const scopeId = scope?.peek<string>('id');
      if (this.run.fromEngine.has(shape.id) && scopeId && DiagramIndex.isSubProcess(scope) && plane.shapes.get(scopeId)?.expanded) {
        shape.parentId = scopeId;
      }
    }
  }

  private adoptEdge(edge: DEdge, target: Plane, dx: number, dy: number): void {
    const element = this.run.semantics.byId.get(edge.id);
    if (!element || target.edges.has(edge.id)) {
      return;
    }
    const copy = PlaneReader.edgeOf(element, edge.id, edge.points.map(({ x, y }) => new Point(x + dx, y + dy)));
    if (edge.label) {
      copy.label = BlockAdopter.moved(edge.label, dx, dy);
    }
    target.edges.set(edge.id, copy);
    this.run.fromEngine.add(edge.id);
    this.run.newEdges.add(edge.id);
  }

  private adoptPlane({ rootId, shapes, edges }: Plane): void {
    const root = this.run.semantics.byId.get(rootId);
    if (!root || this.run.planes.some((existing) => existing.rootId === rootId)) {
      return;
    }
    const target = new Plane(`BPMNPlane_${rootId}`, rootId, root);
    this.run.planes.push(target);
    shapes.forEach((shape) => this.adoptShape(shape, target, 0, 0));
    edges.forEach((edge) => this.adoptEdge(edge, target, 0, 0));
  }
}
