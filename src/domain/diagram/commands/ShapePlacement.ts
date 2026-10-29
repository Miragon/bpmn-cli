import { modelError } from '../../document/utils/errors.js';
import { is, type El } from '../../document/utils/moddle.js';
import type { PlaceShapes } from '../../commands/types.js';
import { bottom, copyBox, cx, cy, inside, overlaps, right, type Box, type Point } from '../utils/geom.js';
import { Frames } from '../di/Frames.js';
import { PlaneQuery } from '../di/PlaneQuery.js';
import { idOf, raw, rawList } from '../utils/raw.js';
import type { DShape, Plane, Side } from '../di/types.js';
import { attachedSide } from '../utils/sides.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { frameWord, outermost, unique } from '../utils/shape-sets.js';

const CLEAR = 20;

/**
 * The `place` op: moves the ids as one rigid group onto the row and / or column of a reference,
 * or with `side` moves a boundary event to the other border of its host.
 */
export class ShapePlacement {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: PlaceShapes,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  /**
   * Places the shapes beside their reference; a reference that is one of the moved shapes' own
   * frames is refused, as the shapes cannot go beside it.
   */
  run(): string[] {
    if (this.command.side) {
      return this.boundarySide(this.command.ids?.[0] ?? '', this.command.side);
    }
    const items = unique(this.command.ids ?? []).map((id) => this.diagram.movableShape(id));
    const { plane, shape: ref } = items[0]!;
    for (const item of items) {
      this.diagram.samePlane(plane, item.plane, item.shape.id, ref.id);
    }
    const group = outermost(plane, items.map((item) => item.shape));
    const sp = PlaneQuery.spacingOf(plane);
    const refUnit = this.diagram.drawing(plane).unitBox(ref);
    const fixed: DShape[] = [];
    const target = (id: string): { shape: DShape; unit: Box } => {
      const found = this.diagram.drawnShape(id);
      this.diagram.samePlane(plane, found.plane, ref.id, id);
      fixed.push(found.shape);
      return { shape: found.shape, unit: found.shape.container ? found.shape.bounds : this.diagram.drawing(plane).unitBox(found.shape) };
    };
    let dx = 0;
    let dy = 0;
    const parts: string[] = [];
    if (this.command.rowOf) {
      dy = cy(target(this.command.rowOf).shape.bounds) - cy(ref.bounds);
      parts.push(`in the row of ${this.command.rowOf}`);
    } else if (this.command.below) {
      const anchor = target(this.command.below);
      const top = refUnit.y - ref.bounds.y;
      const want = Math.max(cy(anchor.shape.bounds) + sp.row, bottom(anchor.unit) + CLEAR - top + ref.bounds.height / 2);
      dy = want - cy(ref.bounds);
      parts.push(`below ${this.command.below}`);
    } else if (this.command.above) {
      const anchor = target(this.command.above);
      const below = bottom(refUnit) - bottom(ref.bounds);
      const want = Math.min(cy(anchor.shape.bounds) - sp.row, anchor.unit.y - CLEAR - below - ref.bounds.height / 2);
      dy = want - cy(ref.bounds);
      parts.push(`above ${this.command.above}`);
    }
    if (this.command.columnOf) {
      dx = cx(target(this.command.columnOf).shape.bounds) - cx(ref.bounds);
      parts.push(`in the column of ${this.command.columnOf}`);
    } else if (this.command.after) {
      dx = right(target(this.command.after).unit) + sp.gap - refUnit.x;
      parts.push(`after ${this.command.after}`);
    } else if (this.command.before) {
      dx = target(this.command.before).unit.x - sp.gap - right(refUnit);
      parts.push(`before ${this.command.before}`);
    }
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (const frame of fixed) {
      if (!frame.container) continue;
      for (const member of group) {
        if (!Frames.chain(plane, member).includes(frame)) continue;
        const memberUnit = this.diagram.drawing(plane).unitBox(member);
        if (inside({ ...memberUnit, x: memberUnit.x + dx, y: memberUnit.y + dy }, frame.bounds)) {
          continue;
        }
        throw modelError('E_LEAVES_CONTAINER', `Placing ${member.id} ${parts.join(' and ')} would move it out of its ${frameWord(frame)} ${frame.id}`, {
          element: member.id,
          related: [frame.id],
          hint: `${frame.id} holds ${member.id}: pick a reference inside it, or move the node out of it first (\`bpmn move <file> ${member.id} --in <scopeId>\` / \`--lane <laneId>\`).`,
        });
      }
    }
    this.diagram.room(plane).checkFrames(group, dx, dy, parts.join(' and '), fixed);
    if (!dx && !dy) {
      this.notes.push(`${ref.id} is already there`);
      return [];
    }
    for (const member of group) {
      this.diagram.drawing(plane).shift(member.id, dx, dy);
    }
    const unit = (candidate: DShape): Box => (candidate.container ? candidate.bounds : this.diagram.drawing(plane).unitBox(candidate));
    const shape = (id: string): DShape => plane.shapes.get(id)!;
    const holds = (): boolean => {
      const refBox = this.diagram.drawing(plane).unitBox(ref);
      const rowOk = this.command.rowOf ? Math.abs(cy(ref.bounds) - cy(shape(this.command.rowOf).bounds)) <= 1 : this.command.below ? refBox.y >= bottom(unit(shape(this.command.below))) - 1 : this.command.above ? bottom(refBox) <= unit(shape(this.command.above)).y + 1 : true;
      const colOk = this.command.columnOf ? Math.abs(cx(ref.bounds) - cx(shape(this.command.columnOf).bounds)) <= 1 : this.command.after ? refBox.x >= right(unit(shape(this.command.after))) - 1 : this.command.before ? right(refBox) <= unit(shape(this.command.before)).x + 1 : true;
      return rowOk && colOk;
    };
    const lock: Array<'x' | 'y'> = [...(this.command.columnOf || this.command.after || this.command.before ? ['x' as const] : []), ...(this.command.rowOf || this.command.below || this.command.above ? ['y' as const] : [])];
    this.diagram.room(plane).makeRoom(group, fixed, this.snap, this.notes, parts.join(' and '), holds, lock);
    return this.diagram.drawing(plane).settle(this.snap);
  }

  /**
   * The nodes only the event leads to, beyond the host's `side` border in the host's own frame.
   * A node in another lane keeps its place: mirrored, it would leave its lane.
   */
  private exceptionPath(plane: Plane, event: DShape, host: DShape, side: Side): DShape[] {
    const home = Frames.of(plane, host);
    const beyond = (box: Box): boolean => (side === 'bottom' ? box.y >= bottom(host.bounds) - 0.5 : side === 'top' ? bottom(box) <= host.bounds.y + 0.5 : false);
    const flowsOf = (id: string, prop: 'incoming' | 'outgoing'): El[] => rawList(this.diagram.sem.byId.get(id), prop).filter((flow) => is(flow, 'bpmn:SequenceFlow'));
    const path: DShape[] = [];
    const inPath = new Set([event.id]);
    const queue = [event.id];
    while (queue.length) {
      for (const flow of flowsOf(queue.shift()!, 'outgoing')) {
        const node = plane.shapes.get(idOf(raw(flow, 'targetRef')) ?? '');
        if (!node || inPath.has(node.id) || node.id === host.id || !PlaneQuery.isLeaf(node) || node.kind === 'boundary' || !beyond(node.bounds) || Frames.of(plane, node) !== home) {
          continue;
        }
        if (!flowsOf(node.id, 'incoming').every((incoming) => inPath.has(idOf(raw(incoming, 'sourceRef')) ?? ''))) {
          continue;
        }
        inPath.add(node.id);
        path.push(node);
        queue.push(node.id);
      }
    }
    return path;
  }

  /**
   * Moves the event to the free spot nearest its centre on the other border; its exception path
   * follows, mirrored about the host's centre row, with room made in the frame first.
   * A pool, a sub-process and the last lane grow on their own; another lane is grown here. Without
   * a free spot on the border the event may reach over a corner, where hand drawings put a third
   * event.
   */
  private boundarySide(id: string, side: 'top' | 'bottom'): string[] {
    const { plane, shape: event } = this.diagram.drawnShape(id);
    const host = event.hostId ? plane.shapes.get(event.hostId) : undefined;
    if (event.kind !== 'boundary' || !host) {
      throw modelError('E_WRONG_KIND', `"${id}" is ${event.kind === 'boundary' ? 'a boundary event without a drawn host' : `a ${event.kind}`}: side moves a boundary event to a border of its host`, {
        element: id,
        hint: 'Give the boundary event (`bpmn show <file> <hostId>` lists them); other shapes take a row and / or a column: --row-of, --below, --above, --column-of, --after, --before.',
      });
    }
    const from = attachedSide(event.bounds, host.bounds);
    if (from === side) {
      this.notes.push(`${id} is already on the ${side} border of ${host.id}`);
      return [];
    }
    const path = from === 'top' || from === 'bottom' ? this.exceptionPath(plane, event, host, from) : [];
    const mirror = (node: DShape): number => Math.round(2 * cy(host.bounds) - 2 * cy(node.bounds));
    const frame = Frames.of(plane, host);
    if (side === 'top' && path.length && frame) {
      const same = path.filter((node) => Frames.of(plane, node) === frame);
      const top = Math.min(...same.map((node) => this.diagram.drawing(plane).unitBox(node).y + mirror(node)));
      const deficit = Math.ceil(Frames.interior(frame, 15).y - top);
      if (same.length && deficit > 0) {
        const sub = frame.kind === 'subProcess';
        this.diagram.drawing(plane).makeSpace({ axis: 'y', line: frame.bounds.y + 1, delta: deficit, anchors: [host.id], ...(sub ? { frame: frame.id, within: copyBox(frame.bounds) } : {}) });
        this.notes.push(`made ${deficit} px of room above ${host.id} in its ${frameWord(frame)} ${frame.id}`);
      }
    }
    if (side === 'bottom' && path.length && frame?.kind === 'lane' && [...plane.shapes.values()].some((lane) => lane.kind === 'lane' && lane !== frame && lane.poolId === frame.poolId && lane.bounds.y >= bottom(frame.bounds) - 1)) {
      const same = path.filter((node) => Frames.of(plane, node) === frame);
      const low = Math.max(...same.map((node) => bottom(this.diagram.drawing(plane).unitBox(node)) + mirror(node)));
      const deficit = Math.ceil(low - bottom(Frames.interior(frame, 15)));
      if (same.length && deficit > 0) {
        this.diagram.drawing(plane).makeSpace({ axis: 'y', line: bottom(frame.bounds) - 1, delta: deficit, anchors: [frame.id] });
        this.notes.push(`made ${deficit} px of room below ${host.id} in its lane ${frame.id}`);
      }
    }
    const hb = host.bounds;
    const size = { width: event.bounds.width, height: event.bounds.height };
    const spotY = Math.round((side === 'top' ? hb.y : bottom(hb)) - size.height / 2);
    const others = [...plane.shapes.values()].filter((boundary) => boundary.hostId === host.id && boundary.id !== id).map((boundary) => boundary.bounds);
    const docks: Point[] = [];
    for (const edge of plane.edges.values()) {
      if (edge.points.length < 2 || edge.sourceId === id || edge.targetId === id) {
        continue;
      }
      if (edge.sourceId === host.id) docks.push(edge.points[0]!);
      if (edge.targetId === host.id) docks.push(edge.points[edge.points.length - 1]!);
    }
    const free = (box: Box): boolean => !others.some((other) => overlaps(other, box, 4)) && !docks.some((dock) => dock.x > box.x - 4 && dock.x < right(box) + 4 && dock.y > box.y - 4 && dock.y < bottom(box) + 4);
    let spot: Box | undefined;
    for (const [lo, hi] of [
      [hb.x + size.width / 2, right(hb) - size.width / 2],
      [hb.x - size.width / 2 + 4, right(hb) + size.width / 2 - 4],
    ] as const) {
      const start = Math.min(hi, Math.max(lo, cx(event.bounds)));
      for (let offset = 0; !spot && offset <= hb.width; offset += 4) {
        for (const centerX of offset ? [start + offset, start - offset] : [start]) {
          const candidate = { x: Math.round(centerX - size.width / 2), y: spotY, ...size };
          if (centerX >= lo - 0.5 && centerX <= hi + 0.5 && free(candidate)) {
            spot = candidate;
            break;
          }
        }
      }
      if (spot) break;
    }
    if (!spot) {
      throw modelError('E_NO_ROOM', `There is no room for ${id} on the ${side} border of ${host.id}: other boundary events and docking connections take it`, {
        element: id,
        related: [host.id],
        hint: `Move another boundary event of ${host.id} first, or route the connections docking there to another side (\`bpmn route <file> <flowId> --entry left\`).`,
      });
    }
    const dx = spot.x - event.bounds.x;
    const dy = spot.y - event.bounds.y;
    event.bounds = { ...event.bounds, x: spot.x, y: spot.y };
    if (event.label) {
      event.label.x += dx;
      event.label.y += dy;
    }
    const shifts = path.map((node) => ({ node, dy: mirror(node) }));
    for (const { node, dy: ny } of shifts) {
      this.diagram.room(plane).checkFrames([node], 0, ny, `on the ${side} side of ${host.id}`, [host]);
    }
    for (const { node, dy: ny } of shifts) {
      this.diagram.drawing(plane).shift(node.id, 0, ny);
    }
    const holds = (): boolean => attachedSide(event.bounds, host.bounds) === side && path.every((node) => (side === 'top' ? bottom(node.bounds) <= hb.y : node.bounds.y >= bottom(hb)));
    if (path.length) {
      this.diagram.room(plane).makeRoom(path, [host], this.snap, this.notes, `on the ${side} side of ${host.id}`, holds, ['y']);
    }
    if (event.label) this.diagram.drawing(plane).placeShapeLabel(event);
    const rerouted = this.diagram.drawing(plane).settle(this.snap);
    for (const edge of plane.edges.values()) {
      if (edge.sourceId !== id || rerouted.includes(edge.id)) continue;
      if (this.diagram.drawing(plane).reroute(edge)) rerouted.push(edge.id);
    }
    this.notes.push(`${id} moved to the ${side} border of ${host.id}${path.length ? `; its path followed (${path.map((node) => node.id).join(', ')})` : ''}`);
    return rerouted;
  }
}
