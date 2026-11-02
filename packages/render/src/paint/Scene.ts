import { Box, type Plane, type PlaneEdge, type PlaneShape, type Point, type ShapeKind } from '../read/index.js';
import { EdgePainter } from './EdgePainter.js';
import type { PaintedLabel } from './LabelPainter.js';
import { ShapePainter } from './ShapePainter.js';
import { Svg } from './Svg.js';

export interface SceneItem {
  box: Box;
  layer: number;
  svg: string;
  fitted?: Box;
  context?: boolean;
}

export class Scene {
  private static readonly LAYER = { participant: 0, lane: 1, subProcess: 2, leaf: 3, group: 4, boundary: 5, edge: 6, label: 7 } as const;
  private static readonly LAYER_OF_KIND: Partial<Record<ShapeKind, number>> = { participant: Scene.LAYER.participant, group: Scene.LAYER.group, boundary: Scene.LAYER.boundary };
  private static readonly STUB_LENGTH = 40;
  private static readonly STUB_OPACITY = 0.4;
  private static readonly MAX_DEPTH = 50;
  private static readonly DEPTH_STEP = 0.01;

  readonly items: SceneItem[] = [];
  readonly drawnIds: string[] = [];

  constructor(
    private readonly plane: Plane,
    private readonly fit: Set<string> | undefined,
  ) {
    this.addShapes();
    this.addEdges();
  }

  private static stub(points: readonly Point[]): Point[] {
    const cut: Point[] = [points[0] as Point];
    let rest = Scene.STUB_LENGTH;
    for (const [index, end] of points.slice(1).entries()) {
      const start = points[index] as Point;
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      if (distance >= rest && distance > 0) {
        cut.push({ x: start.x + ((end.x - start.x) * rest) / distance, y: start.y + ((end.y - start.y) * rest) / distance });
        return cut;
      }
      cut.push(end);
      rest -= distance;
    }
    return cut;
  }

  private addShapes(): void {
    const frames = this.framesAroundFit();
    for (const shape of this.plane.shapes.values()) {
      const full = !this.fit || this.fit.has(shape.id);
      if (full || ['participant', 'lane', 'group'].includes(shape.kind) || frames.has(shape.id)) {
        this.addShape(shape, full);
      }
    }
  }

  private addShape(shape: PlaneShape, full: boolean): void {
    const painter = new ShapePainter(shape);
    const context = full ? {} : { context: true };
    this.items.push({ box: shape.bounds, layer: this.layerOf(shape), svg: `<g ${full ? 'data-id' : 'data-context'}="${Svg.attribute(shape.id)}">${painter.svg()}</g>`, ...context });
    if (full) {
      this.drawnIds.push(shape.id);
    }
    const label = painter.label();
    if (label) {
      this.items.push({ ...label, layer: Scene.LAYER.label, ...context });
    }
  }

  private addEdges(): void {
    for (const edge of this.plane.edges.values()) {
      if (edge.points.length < 2) {
        continue;
      }
      if (!this.fit || this.fit.has(edge.id)) {
        this.addEdge(edge);
      } else {
        this.addFadedEdge(edge, this.fit);
      }
    }
  }

  private addEdge(edge: PlaneEdge): void {
    const painter = new EdgePainter(edge);
    this.items.push({ box: painter.box(), layer: Scene.LAYER.edge, svg: `<g data-id="${Svg.attribute(edge.id)}">${painter.svg()}</g>` });
    this.drawnIds.push(edge.id);
    for (const label of [painter.label(), painter.messageLabel()]) {
      this.addEdgeLabel(label, '');
    }
  }

  private addFadedEdge(edge: PlaneEdge, fit: Set<string>): void {
    const fromFit = !!edge.sourceId && fit.has(edge.sourceId);
    const toFit = !!edge.targetId && fit.has(edge.targetId);
    if (fromFit === toFit) {
      return;
    }
    const painter = new EdgePainter(edge);
    const stub = fromFit ? Scene.stub(edge.points) : Scene.stub([...edge.points].reverse());
    const opacity = ` opacity="${Scene.STUB_OPACITY}"`;
    this.items.push({ box: painter.box(), fitted: Box.spanning(stub) as Box, layer: Scene.LAYER.edge, svg: `<g data-faded="${Svg.attribute(edge.id)}"${opacity}>${painter.svg()}</g>` });
    for (const label of [painter.label(), painter.messageLabel()]) {
      this.addEdgeLabel(label, opacity);
    }
  }

  private addEdgeLabel(label: PaintedLabel | undefined, opacity: string): void {
    if (label) {
      this.items.push({ box: label.box, layer: Scene.LAYER.label, svg: opacity ? `<g${opacity}>${label.svg}</g>` : label.svg, ...(opacity ? { context: true } : {}) });
    }
  }

  private framesAroundFit(): Set<string> {
    const frames = new Set<string>();
    for (const id of this.fit ?? []) {
      let shape = this.plane.shapes.get(id);
      for (let step = 0; shape && step < Scene.MAX_DEPTH; step++) {
        const parentId: string | undefined = shape.parentId ?? (shape.hostId ? this.plane.shapes.get(shape.hostId)?.parentId : undefined);
        if (!parentId) {
          break;
        }
        frames.add(parentId);
        shape = this.plane.shapes.get(parentId);
      }
    }
    return frames;
  }

  private layerOf(shape: PlaneShape): number {
    if (shape.kind === 'lane') {
      return Scene.LAYER.lane + this.depth(shape, (candidate) => candidate.laneId) * Scene.DEPTH_STEP;
    }
    if (shape.kind === 'subProcess' && shape.expanded) {
      return Scene.LAYER.subProcess + this.depth(shape, (candidate) => candidate.parentId) * Scene.DEPTH_STEP;
    }
    return Scene.LAYER_OF_KIND[shape.kind] ?? Scene.LAYER.leaf;
  }

  private depth(shape: PlaneShape, parentOf: (shape: PlaneShape) => string | undefined): number {
    let level = 0;
    let parentId = parentOf(shape);
    while (parentId && level < Scene.MAX_DEPTH) {
      const parent = this.plane.shapes.get(parentId);
      parentId = parent ? parentOf(parent) : undefined;
      level++;
    }
    return level;
  }
}
