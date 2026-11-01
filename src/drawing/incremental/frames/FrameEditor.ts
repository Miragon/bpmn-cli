import { Box, Samples } from '../../../model/index.js';
import type { Axis } from '../../plane/BoxAxis.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import type { Semantics } from '../../plane/Semantics.js';
import { ShapeSizes, type ShapeSize } from '../../plane/ShapeSizes.js';
import type { SpaceResult, SpaceTool } from '../space/SpaceTool.js';
import { BoundaryReseat } from './BoundaryReseat.js';

export class FrameEditor {
  private static readonly HEADER = 30;
  private static readonly PAD = 30;
  private static readonly TOP_PAD = 45;
  private static readonly POOL_HEIGHT = 200;
  private static readonly POOL_WIDTH = 600;
  private static readonly POOL_GAP = 80;
  private static readonly LANE_HEIGHT = 150;
  private static readonly CHILD_PLANE_X = 160;
  private static readonly CHILD_PLANE_Y = 80;
  private static readonly MAX_CHAIN = 10;

  constructor(
    private readonly plane: Plane,
    private readonly space: SpaceTool,
    private readonly touched: Set<string>,
  ) {}

  private static shiftAll(shapes: readonly DShape[], edges: readonly DEdge[], dx: number, dy: number): void {
    for (const shape of shapes) {
      shape.translate(dx, dy);
    }
    for (const edge of edges) {
      edge.translate(dx, dy);
    }
  }

  wrapPool(pool: DShape): void {
    const { HEADER, PAD } = FrameEditor;
    const parts = [...this.plane.shapes.values()].filter((shape) => shape !== pool).flatMap((shape) => (shape.label ? [shape.bounds, shape.label] : [shape.bounds]));
    const points = [...this.plane.edges.values()].flatMap((edge) => edge.points).map((point) => new Box(point.x, point.y, 0, 0));
    const box = Box.unionAll([...parts, ...points]);
    pool.bounds = box ? new Box(Math.round(box.x - HEADER - PAD), Math.round(box.y - PAD), Math.round(box.width + HEADER + 2 * PAD), Math.round(box.height + 2 * PAD)) : new Box(100, 80, 600, 250);
  }

  placePool(pool: DShape, blackBox: boolean, size?: ShapeSize): void {
    const others = this.pools().filter((existing) => existing !== pool);
    const height = size?.height ?? (blackBox ? ShapeSizes.BLACK_BOX_HEIGHT : FrameEditor.POOL_HEIGHT);
    pool.bounds = others.length ? this.poolBelow(others, height, size) : this.firstPool(pool, height, size);
  }

  placeLane(lane: DShape): boolean {
    const container = this.parentFrame(lane);
    if (!container) {
      return false;
    }
    const siblings = this.siblingLanes(lane.poolId, lane.laneId, lane.id);
    const frame = container.bounds;
    if (!siblings.length) {
      lane.bounds = new Box(frame.x + FrameEditor.HEADER, frame.y, frame.width - FrameEditor.HEADER, frame.height);
      return true;
    }
    const height = Math.round(new Samples(siblings.map((sibling) => sibling.bounds.height)).median() ?? FrameEditor.LANE_HEIGHT) || FrameEditor.LANE_HEIGHT;
    const line = frame.bottom;
    const chain = this.containerChain(container);
    const before = new Map(chain.map((shape) => [shape.id, shape.bounds.bottom]));
    const band = lane.poolId ? this.plane.shapes.get(lane.poolId)?.bounds : undefined;
    this.record(this.space.makeSpace({ axis: 'y', line, delta: height, ...(band ? { within: band.copy() } : {}) }));
    for (const shape of chain) {
      if (Math.abs(before.get(shape.id)! - line) <= 1 && shape.bounds.bottom < line + height - 0.5) {
        shape.bounds.height += height;
        this.touched.add(shape.id);
      }
    }
    const last = siblings.at(-1)!;
    lane.bounds = new Box(last.bounds.x, line, last.bounds.width, height);
    return true;
  }

  removedLane(box: Box, poolId: string | undefined, parentId: string | undefined): void {
    const pool = poolId ? this.plane.shapes.get(poolId) : undefined;
    const siblings = this.siblingLanes(poolId, parentId, '');
    if (!siblings.length) {
      return;
    }
    if (!this.occupied(box, pool)) {
      this.record(this.space.makeSpace({ axis: 'y', line: box.bottom - 0.5, delta: -box.height, ...(pool ? { within: pool.bounds.copy() } : {}) }));
      return;
    }
    const above = siblings.find((sibling) => Math.abs(sibling.bounds.bottom - box.y) <= 1);
    const below = siblings.find((sibling) => Math.abs(sibling.bounds.y - box.bottom) <= 1);
    if (above) {
      above.bounds.height += box.height;
      this.touched.add(above.id);
    } else if (below) {
      below.bounds.y -= box.height;
      below.bounds.height += box.height;
      this.touched.add(below.id);
    }
  }

  removedPool(box: Box): void {
    const below = this.pools().filter((pool) => pool.bounds.y >= box.bottom - 1);
    if (!below.length) {
      return;
    }
    const next = Math.min(...below.map((pool) => pool.bounds.y));
    const occupied = [...this.plane.shapes.values()].some((shape) => shape.kind !== 'participant' && shape.bounds.center.y > box.y && shape.bounds.center.y < next);
    if (!occupied) {
      this.record(this.space.makeSpace({ axis: 'y', line: next - 0.5, delta: -(next - box.y) }));
    }
  }

  reseatBoundaries(host: DShape, old: Box): void {
    new BoundaryReseat(this.plane, host, old, this.touched).reseat();
  }

  collapse(sub: DShape, child: Plane, gap: number): void {
    const { shapes, edges } = this.plane.contentOf(sub.id);
    const old = sub.bounds.copy();
    FrameEditor.shiftAll(shapes, edges, FrameEditor.CHILD_PLANE_X - (old.x + FrameEditor.PAD), FrameEditor.CHILD_PLANE_Y - (old.y + FrameEditor.TOP_PAD));
    for (const shape of shapes) {
      this.plane.shapes.delete(shape.id);
      if (shape.parentId === sub.id) {
        shape.parentId = undefined;
      }
      child.shapes.set(shape.id, shape);
    }
    for (const edge of edges) {
      this.plane.edges.delete(edge.id);
      child.edges.set(edge.id, edge);
    }
    const { width, height } = ShapeSizes.TASK;
    sub.bounds = new Box(old.x, Math.round(old.center.y - height / 2), width, height);
    sub.expanded = false;
    sub.container = false;
    this.touched.add(sub.id);
    this.reseatBoundaries(sub, old);
    const band = sub.poolId ? this.plane.shapes.get(sub.poolId)?.bounds : undefined;
    this.record(this.space.closeStrip({ axis: 'x', from: sub.bounds.right, to: old.right + gap, gap, ...(band ? { within: band.copy() } : {}) }));
  }

  expand(sub: DShape, child: Plane | undefined, semantics: Semantics): void {
    const { PAD, TOP_PAD } = FrameEditor;
    const content = child ? [...child.shapes.values()] : [];
    const box = Box.unionAll(content.flatMap((shape) => (shape.label ? [shape.bounds, shape.label] : [shape.bounds])));
    const { width: smallestWidth, height: smallestHeight } = ShapeSizes.NEW_SUB_PROCESS;
    const width = Math.max(smallestWidth, box ? Math.round(box.width + 2 * PAD) : 0);
    const height = Math.max(smallestHeight, box ? Math.round(box.height + TOP_PAD + PAD) : 0);
    const old = sub.bounds.copy();
    sub.expanded = true;
    sub.container = true;
    this.growSub(sub, 'x', width - old.width);
    this.growSub(sub, 'y', height - old.height);
    sub.bounds = new Box(old.x, old.y, width, height);
    this.touched.add(sub.id);
    this.reseatBoundaries(sub, old);
    if (child) {
      this.adoptContent(sub, child, box, semantics);
    }
  }

  private record(result: SpaceResult | undefined): void {
    result?.moved.forEach((id) => this.touched.add(id));
    result?.resized.forEach((id) => this.touched.add(id));
  }

  private pools(): DShape[] {
    return [...this.plane.shapes.values()].filter((shape) => shape.kind === 'participant');
  }

  private firstPool(pool: DShape, height: number, size: ShapeSize | undefined): Box {
    const { HEADER, PAD, POOL_WIDTH } = FrameEditor;
    const content = Box.unionAll([...this.plane.shapes.values()].filter((shape) => shape !== pool).map((shape) => shape.bounds));
    const left = content ? content.x - HEADER - PAD : 100;
    const top = content ? content.bottom + 80 : 80;
    return new Box(Math.round(left), Math.round(top), Math.round(size?.width ?? Math.max(POOL_WIDTH, content ? content.width + HEADER + 2 * PAD : POOL_WIDTH)), height);
  }

  private poolBelow(others: readonly DShape[], height: number, size: ShapeSize | undefined): Box {
    const sorted = [...others].sort((upper, lower) => upper.bounds.y - lower.bounds.y);
    const gaps = sorted.slice(1).map((pool, index) => pool.bounds.y - sorted[index]!.bounds.bottom);
    const gap = Math.max(0, Math.round(new Samples(gaps.filter((spacing) => spacing >= 0)).median() ?? FrameEditor.POOL_GAP));
    const widest = [...others].sort((first, second) => second.bounds.width - first.bounds.width || first.bounds.x - second.bounds.x)[0]!;
    const lowest = Math.max(...others.map((existing) => existing.bounds.bottom));
    return new Box(widest.bounds.x, Math.round(lowest + gap), Math.max(widest.bounds.width, size?.width ?? 0), height);
  }

  private siblingLanes(poolId: string | undefined, parentId: string | undefined, except: string): DShape[] {
    return [...this.plane.shapes.values()].filter((shape) => shape.kind === 'lane' && shape.id !== except && shape.poolId === poolId && shape.laneId === parentId).sort((upper, lower) => upper.bounds.y - lower.bounds.y);
  }

  private parentFrame({ laneId, poolId }: DShape): DShape | undefined {
    if (laneId) {
      return this.plane.shapes.get(laneId);
    }
    return poolId ? this.plane.shapes.get(poolId) : undefined;
  }

  private containerChain(container: DShape): DShape[] {
    const chain: DShape[] = [];
    let current: DShape | undefined = container;
    for (let depth = 0; current && depth < FrameEditor.MAX_CHAIN; depth++) {
      chain.push(current);
      current = current.kind === 'lane' ? this.parentFrame(current) : undefined;
    }
    return chain;
  }

  private occupied(box: Box, pool: DShape | undefined): boolean {
    return [...this.plane.shapes.values()].some(({ isLeaf, kind, bounds }) => {
      const { y } = bounds.center;
      return isLeaf && kind !== 'boundary' && y > box.y && y < box.bottom && (!pool || (bounds.x >= pool.bounds.x && bounds.x <= pool.bounds.right));
    });
  }

  private growSub(sub: DShape, axis: Axis, delta: number): void {
    if (delta > 0) {
      const line = (axis === 'x' ? sub.bounds.right : sub.bounds.bottom) - 0.5;
      const keep = new Set(this.plane.boundariesOf(sub.id).map((boundary) => boundary.id));
      this.record(this.space.makeSpace({ axis, line, delta, keep, anchors: [sub.id], frame: sub.id }));
    }
  }

  private adoptContent(sub: DShape, child: Plane, box: Box | undefined, semantics: Semantics): void {
    const content = [...child.shapes.values()];
    const edges = [...child.edges.values()];
    if (box) {
      FrameEditor.shiftAll(content, edges, sub.bounds.x + FrameEditor.PAD - box.x, sub.bounds.y + FrameEditor.TOP_PAD - box.y);
    }
    for (const shape of content) {
      child.shapes.delete(shape.id);
      if (semantics.scopeOf.get(shape.id)?.peek<string>('id') === sub.id) {
        shape.parentId = sub.id;
      }
      if (shape.poolId === undefined && sub.poolId) {
        shape.poolId = sub.poolId;
      }
      this.plane.shapes.set(shape.id, shape);
    }
    for (const edge of edges) {
      child.edges.delete(edge.id);
      this.plane.edges.set(edge.id, edge);
    }
    child.deleted = true;
  }
}
