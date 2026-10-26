import type { Point } from '../../diagram/utils/geom.js';
import { grow } from '../../diagram/utils/geom.js';
import type { DShape, Plane } from '../../diagram/di/types.js';
import { EdgePainter } from './EdgePainter.js';
import { ShapePainter } from './ShapePainter.js';
import { HALO_COLORS, LAYER, type Item } from './types.js';
import { pointsBox } from '../utils/boxes.js';
import { attr, formatNumber } from '../utils/svg.js';

/** the view fits only this much of a faded connection */
const STUB = 40;
const FADED = 0.4;

/**
 * The drawable items of a plane. With a crop, frames around the drawn ids are context and
 * connections with one drawn end are faded stubs.
 */
export class Scene {
  readonly items: Item[] = [];

  constructor(
    private readonly plane: Plane,
    private readonly drawn: Set<string> | undefined,
    private readonly halo: (id: string) => string | undefined,
  ) {
    this.addShapes();
    this.addEdges();
  }

  private addShapes(): void {
    const { plane, drawn, halo, items } = this;
    const around = this.framesAround();
    for (const shape of plane.shapes.values()) {
      const full = !drawn || drawn.has(shape.id);
      const context = !full && (shape.kind === 'participant' || shape.kind === 'lane' || shape.kind === 'group' || around.has(shape.id));
      if (!full && !context) continue;
      const painter = new ShapePainter(shape);
      const label = painter.label();
      const layer = this.layerOf(shape);
      // a frame that only moved or grew gets no halo (its content says what moved)
      const color = shape.container && halo(shape.id) === HALO_COLORS.moved ? undefined : halo(shape.id);
      if (color) items.push({ box: grow(shape.bounds, 9), layer, svg: painter.halo(color), id: shape.id, extra: true });
      const content = !full ? undefined : shape.container || shape.kind === 'group' ? painter.nameBox() : shape.bounds;
      items.push({ box: shape.bounds, layer, svg: `<g ${full ? 'data-id' : 'data-context'}="${attr(shape.id)}">${painter.svg()}</g>`, id: shape.id, ...(full ? {} : { extra: true }), ...(content ? { content } : {}) });
      if (label) {
        if (color) items.push(this.labelTint(label, color, shape.id));
        items.push({ ...label, id: shape.id, ...(full ? { content: label.box } : { extra: true }) });
      }
    }
  }

  private addEdges(): void {
    const { plane, drawn, halo, items } = this;
    for (const edge of plane.edges.values()) {
      if (edge.points.length < 2) continue;
      const painter = new EdgePainter(edge);
      if (drawn && !drawn.has(edge.id)) {
        const from = !!edge.sourceId && drawn.has(edge.sourceId);
        const to = !!edge.targetId && drawn.has(edge.targetId);
        if (from === to) continue;
        // faded: it goes on to something the crop leaves out
        const stub = from ? Scene.cut(edge.points, STUB) : Scene.cut([...edge.points].reverse(), STUB).reverse();
        items.push({ box: painter.box(), fit: pointsBox(stub), layer: LAYER.edge, svg: `<g data-faded="${attr(edge.id)}" opacity="${FADED}">${painter.svg()}</g>`, id: edge.id });
        for (const label of [painter.label(), painter.messageLabel()]) if (label) items.push({ ...label, svg: `<g opacity="${FADED}">${label.svg}</g>`, id: edge.id, extra: true });
        continue;
      }
      const color = halo(edge.id);
      if (color) items.push({ box: grow(pointsBox(edge.points), 5), layer: LAYER.edge, svg: painter.halo(color), id: edge.id, extra: true });
      items.push({ box: painter.box(), layer: LAYER.edge, svg: `<g data-id="${attr(edge.id)}">${painter.svg()}</g>`, id: edge.id });
      const label = painter.label();
      if (label) {
        if (color) items.push(this.labelTint(label, color, edge.id));
        items.push({ ...label, id: edge.id, content: label.box });
      }
      const message = painter.messageLabel();
      if (message) items.push({ ...message, id: edge.id, content: message.box });
    }
  }

  private framesAround(): Set<string> {
    const around = new Set<string>();
    if (!this.drawn) return around;
    for (const id of this.drawn) {
      let frameShape = this.plane.shapes.get(id);
      for (let step = 0; frameShape && step < 50; step++) {
        const up = frameShape.parentId ?? (frameShape.hostId ? this.plane.shapes.get(frameShape.hostId)?.parentId : undefined);
        if (!up) break;
        around.add(up);
        frameShape = this.plane.shapes.get(up);
      }
    }
    return around;
  }

  private layerOf(shape: DShape): number {
    return shape.kind === 'participant'
      ? LAYER.participant
      : shape.kind === 'lane'
        ? LAYER.lane + this.depth(shape, (candidate) => candidate.laneId) / 100
        : shape.kind === 'subProcess' && shape.expanded
          ? LAYER.subProcess + this.depth(shape, (candidate) => candidate.parentId) / 100
          : shape.kind === 'group'
            ? LAYER.group
            : shape.kind === 'boundary'
              ? LAYER.boundary
              : LAYER.leaf;
  }

  private depth(shape: DShape, parent: (shape: DShape) => string | undefined): number {
    let level = 0;
    for (let parentId = parent(shape); parentId && level < 50; level++) parentId = this.plane.shapes.get(parentId) ? parent(this.plane.shapes.get(parentId)!) : undefined;
    return level;
  }

  private labelTint(label: Item, color: string, id: string): Item {
    const tintBox = grow(label.box, 2);
    return { box: tintBox, layer: LAYER.label, svg: `<rect x="${formatNumber(tintBox.x)}" y="${formatNumber(tintBox.y)}" width="${formatNumber(tintBox.width)}" height="${formatNumber(tintBox.height)}" rx="3" fill="${color}" fill-opacity="0.22"/>`, id, extra: true };
  }

  private static cut(points: readonly Point[], length: number): Point[] {
    const out: Point[] = [points[0]!];
    let rest = length;
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]!;
      const end = points[index]!;
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      if (distance >= rest && distance > 0) {
        out.push({ x: start.x + ((end.x - start.x) * rest) / distance, y: start.y + ((end.y - start.y) * rest) / distance });
        return out;
      }
      out.push(end);
      rest -= distance;
    }
    return out;
  }
}
