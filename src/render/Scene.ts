import type { Point } from '../diagram/utils/geom.js';
import type { DShape, Plane } from '../diagram/types.js';
import { EdgePainter } from './EdgePainter.js';
import { ShapePainter } from './ShapePainter.js';
import { HALO_COLORS, LAYER, type Item } from './types.js';
import { grow, pointsBox } from './utils/boxes.js';
import { attr, n } from './utils/svg.js';

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
    for (const s of plane.shapes.values()) {
      const full = !drawn || drawn.has(s.id);
      const context = !full && (s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group' || around.has(s.id));
      if (!full && !context) continue;
      const painter = new ShapePainter(s);
      const label = painter.label();
      const layer = this.layerOf(s);
      // a frame that only moved or grew gets no halo (its content says what moved)
      const color = s.container && halo(s.id) === HALO_COLORS.moved ? undefined : halo(s.id);
      if (color) items.push({ box: grow(s.bounds, 9), layer, svg: painter.halo(color), id: s.id, extra: true });
      const content = !full ? undefined : s.container || s.kind === 'group' ? painter.nameBox() : s.bounds;
      items.push({ box: s.bounds, layer, svg: `<g ${full ? 'data-id' : 'data-context'}="${attr(s.id)}">${painter.svg()}</g>`, id: s.id, ...(full ? {} : { extra: true }), ...(content ? { content } : {}) });
      if (label) {
        if (color) items.push(this.labelTint(label, color, s.id));
        items.push({ ...label, id: s.id, ...(full ? { content: label.box } : { extra: true }) });
      }
    }
  }

  private addEdges(): void {
    const { plane, drawn, halo, items } = this;
    for (const e of plane.edges.values()) {
      if (e.points.length < 2) continue;
      const painter = new EdgePainter(e);
      if (drawn && !drawn.has(e.id)) {
        const from = !!e.sourceId && drawn.has(e.sourceId);
        const to = !!e.targetId && drawn.has(e.targetId);
        if (from === to) continue;
        // faded: it goes on to something the crop leaves out
        const stub = from ? Scene.cut(e.points, STUB) : Scene.cut([...e.points].reverse(), STUB).reverse();
        items.push({ box: painter.box(), fit: pointsBox(stub), layer: LAYER.edge, svg: `<g data-faded="${attr(e.id)}" opacity="${FADED}">${painter.svg()}</g>`, id: e.id });
        for (const label of [painter.label(), painter.messageLabel()]) if (label) items.push({ ...label, svg: `<g opacity="${FADED}">${label.svg}</g>`, id: e.id, extra: true });
        continue;
      }
      const color = halo(e.id);
      if (color) items.push({ box: grow(pointsBox(e.points), 5), layer: LAYER.edge, svg: painter.halo(color), id: e.id, extra: true });
      items.push({ box: painter.box(), layer: LAYER.edge, svg: `<g data-id="${attr(e.id)}">${painter.svg()}</g>`, id: e.id });
      const label = painter.label();
      if (label) {
        if (color) items.push(this.labelTint(label, color, e.id));
        items.push({ ...label, id: e.id, content: label.box });
      }
      const message = painter.messageLabel();
      if (message) items.push({ ...message, id: e.id, content: message.box });
    }
  }

  private framesAround(): Set<string> {
    const around = new Set<string>();
    if (!this.drawn) return around;
    for (const id of this.drawn) {
      let s = this.plane.shapes.get(id);
      for (let i = 0; s && i < 50; i++) {
        const up = s.parentId ?? (s.hostId ? this.plane.shapes.get(s.hostId)?.parentId : undefined);
        if (!up) break;
        around.add(up);
        s = this.plane.shapes.get(up);
      }
    }
    return around;
  }

  private layerOf(s: DShape): number {
    return s.kind === 'participant'
      ? LAYER.participant
      : s.kind === 'lane'
        ? LAYER.lane + this.depth(s, (x) => x.laneId) / 100
        : s.kind === 'subProcess' && s.expanded
          ? LAYER.subProcess + this.depth(s, (x) => x.parentId) / 100
          : s.kind === 'group'
            ? LAYER.group
            : s.kind === 'boundary'
              ? LAYER.boundary
              : LAYER.leaf;
  }

  private depth(s: DShape, parent: (s: DShape) => string | undefined): number {
    let d = 0;
    for (let p = parent(s); p && d < 50; d++) p = this.plane.shapes.get(p) ? parent(this.plane.shapes.get(p)!) : undefined;
    return d;
  }

  private labelTint(label: Item, color: string, id: string): Item {
    const g = grow(label.box, 2);
    return { box: g, layer: LAYER.label, svg: `<rect x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" rx="3" fill="${color}" fill-opacity="0.22"/>`, id, extra: true };
  }

  private static cut(points: readonly Point[], length: number): Point[] {
    const out: Point[] = [points[0]!];
    let rest = length;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d >= rest && d > 0) {
        out.push({ x: a.x + ((b.x - a.x) * rest) / d, y: a.y + ((b.y - a.y) * rest) / d });
        return out;
      }
      out.push(b);
      rest -= d;
    }
    return out;
  }
}
