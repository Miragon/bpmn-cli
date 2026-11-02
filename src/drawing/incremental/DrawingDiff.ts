import { Box, type BpmnElement } from '../../model/index.js';
import type { DrawingSnapshot, SnapEntry } from '../DrawingSnapshot.js';
import type { PlaneShape } from '../plane/PlaneShape.js';
import { Frames } from '../plane/Frames.js';
import { Plane } from '../plane/Plane.js';
import { ShapeSizes } from '../plane/ShapeSizes.js';
import type { LayoutRun } from './run/LayoutRun.js';
import { RowCloser } from './space/RowCloser.js';

export interface Strip {
  plane: Plane;
  box: Box;
  poolId?: string;
  parentId?: string;
}

interface Expansion {
  expand?: readonly string[];
  collapse?: readonly string[];
}

export class DrawingDiff {
  private static readonly FLOW_NODE_KINDS = ['task', 'subProcess', 'event', 'gateway'];

  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
  ) {}

  removedAndRelocated(relocated: ReadonlySet<string>): Strip[] {
    const strips = this.removedStrips();
    for (const plane of this.run.planes) {
      for (const shape of [...plane.shapes.values()]) {
        if (shape.kind === 'boundary' && shape.el.is('bpmn:FlowNode')) {
          this.reattach(plane, shape);
        } else if (shape.el.is('bpmn:FlowNode') && this.movedHome(plane, shape, relocated)) {
          strips.push(this.lift(plane, shape));
        }
      }
    }
    return strips;
  }

  closeStrips(strips: readonly Strip[], ignore: ReadonlySet<string>): void {
    for (const strip of [...strips].sort((left, right) => right.box.x - left.box.x)) {
      this.closeStrip(strip, ignore);
    }
  }

  applyExpansion({ expand = [], collapse = [] }: Expansion): void {
    const wanted = new Map<string, boolean>([...expand.map((id) => [id, true] as const), ...collapse.map((id) => [id, false] as const)]);
    for (const plane of [...this.run.planes]) {
      for (const shape of [...plane.shapes.values()]) {
        const desired = wanted.get(shape.id);
        if (shape.kind !== 'subProcess') {
          this.shrinkRetyped(plane, shape);
        } else if (desired !== undefined && desired !== (shape.expanded === true)) {
          this.toggle(plane, shape, desired);
        }
      }
    }
  }

  laneChanges(): void {
    const { run, before } = this;
    for (const plane of run.planes) {
      for (const shape of [...plane.shapes.values()]) {
        if (!shape.el.is('bpmn:FlowNode') || shape.kind === 'boundary' || run.place.placed.has(shape.id)) {
          continue;
        }
        const now = run.semantics.laneOf.get(shape.id);
        if (now && now !== run.cur(before.laneOf.get(run.oldId(shape))) && run.placer.changeLane(plane, shape.id)) {
          run.active.add(shape.id);
        }
      }
    }
  }

  private planeDrawnOn(bpmnPlane: BpmnElement | undefined): Plane | undefined {
    return bpmnPlane ? this.run.planes.find((plane) => plane.bpmnPlane === bpmnPlane) : undefined;
  }

  private livePlaneElements(): Set<BpmnElement> {
    const live = new Set<BpmnElement>();
    for (const plane of this.run.planes) {
      for (const { planeElement } of [...plane.shapes.values(), ...plane.edges.values()]) {
        if (planeElement) {
          live.add(planeElement);
        }
      }
    }
    return live;
  }

  private removedStrips(): Strip[] {
    const live = this.livePlaneElements();
    const strips: Strip[] = [];
    for (const [planeElement, entry] of this.before.byPlaneElement) {
      const plane = this.planeDrawnOn(entry.bpmnPlane);
      if (!live.has(planeElement) && entry.bounds && plane) {
        strips.push(...this.stripOfRemoved(plane, entry, entry.bounds));
      }
    }
    return strips;
  }

  private stripOfRemoved(plane: Plane, entry: SnapEntry, bounds: Box): Strip[] {
    const { run } = this;
    if (entry.kind === 'lane') {
      run.drawing(plane).frames.removedLane(bounds, entry.poolId, entry.laneId);
      return [];
    }
    if (entry.kind === 'participant') {
      run.drawing(plane).frames.removedPool(bounds);
      return [];
    }
    const poolId = run.cur(entry.poolId);
    const parentId = run.cur(entry.parentId);
    const frameGone = (poolId && !plane.shapes.has(poolId)) || (parentId && !plane.shapes.has(parentId));
    return DrawingDiff.FLOW_NODE_KINDS.includes(entry.kind) && !frameGone ? [this.stripAt(plane, bounds, poolId, parentId)] : [];
  }

  private stripAt(plane: Plane, box: Box, poolId: string | undefined, parentId: string | undefined): Strip {
    return { plane, box, ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) };
  }

  private reattach(plane: Plane, shape: PlaneShape): void {
    const { run, before } = this;
    const hostBefore = run.cur(before.hostOf.get(run.oldId(shape)));
    if (!shape.planeElement || !before.byPlaneElement.has(shape.planeElement) || hostBefore === undefined || hostBefore === shape.hostId || !plane.shapes.has(shape.id)) {
      return;
    }
    plane.shapes.delete(shape.id);
    run.place.reuse.set(shape.id, { shape, boundaries: [], from: plane });
    run.relocated.add(shape.id);
    this.rerouteTouching(plane, new Set([shape.id]), new Set());
  }

  private movedHome(plane: Plane, shape: PlaneShape, relocated: ReadonlySet<string>): boolean {
    const { run, before } = this;
    const scopeNow = run.semantics.scopeOf.get(shape.id)?.peek<string>('id');
    const scopeBefore = run.cur(before.scopeOf.get(run.oldId(shape)));
    const home = run.semantics.homePlane(run.planes, shape.id);
    return relocated.has(shape.id) || scopeNow !== scopeBefore || (!!home && home !== plane);
  }

  private lift(plane: Plane, shape: PlaneShape): Strip {
    const { run, before } = this;
    const boundaries = plane.boundariesOf(shape.id);
    const content = shape.kind === 'subProcess' && shape.expanded ? plane.contentOf(shape.id) : undefined;
    for (const lifted of [shape, ...boundaries, ...(content?.shapes ?? [])]) {
      plane.shapes.delete(lifted.id);
    }
    run.place.reuse.set(shape.id, { shape, boundaries, from: plane, ...(content ? { content } : {}) });
    run.relocated.add(shape.id);
    const was = shape.planeElement ? before.byPlaneElement.get(shape.planeElement) : undefined;
    const own = new Set([shape.id, ...boundaries.map((boundary) => boundary.id)]);
    this.rerouteTouching(plane, own, new Set(content?.edges.map((edge) => edge.id)));
    return this.stripAt(plane, shape.bounds.copy(), was ? run.cur(was.poolId) : shape.poolId, was ? run.cur(was.parentId) : shape.parentId);
  }

  private rerouteTouching(plane: Plane, own: ReadonlySet<string>, inner: ReadonlySet<string>): void {
    for (const edge of plane.edges.values()) {
      if (!inner.has(edge.id) && ((edge.sourceId && own.has(edge.sourceId)) || (edge.targetId && own.has(edge.targetId)))) {
        this.run.reroute.add(edge.id);
      }
    }
  }

  private frameOf({ plane, poolId, parentId }: Strip): PlaneShape | undefined {
    if (parentId) {
      return plane.shapes.get(parentId);
    }
    return poolId ? plane.shapes.get(poolId) : undefined;
  }

  private closeStrip(strip: Strip, ignore: ReadonlySet<string>): void {
    const { run } = this;
    const { plane, box } = strip;
    const { gap } = run.place.spacing.get(plane) ?? plane.spacing();
    const frame = this.frameOf(strip);
    const from = box.x - gap;
    const to = box.right + gap;
    const band = frame?.bounds;
    const sub = frame?.kind === 'subProcess' ? frame : undefined;
    const keep = sub ? this.outsideOf(plane, sub) : undefined;
    const inBand = (shape: PlaneShape): boolean => !band || (shape.bounds.center.y >= band.y && shape.bounds.center.y <= band.bottom);
    if (!plane.leaves().some((shape) => shape.bounds.x >= to && inBand(shape) && !keep?.has(shape.id))) {
      return;
    }
    const closed = run.drawing(plane).space.closeStrip({ axis: 'x', from, to, gap, ignore, ...(band ? { within: band.copy() } : {}), ...(keep ? { keep } : {}) });
    const result = closed ?? (sub ? undefined : new RowCloser(plane).close({ box, frame, from, to, gap, ignore }));
    result?.moved.forEach((id) => run.place.moved.add(id));
  }

  private outsideOf(plane: Plane, sub: PlaneShape): Set<string> {
    const frames = new Frames(plane);
    return new Set([...plane.shapes.values()].filter((shape) => shape !== sub && shape.hostId !== sub.id && !frames.within(shape, sub)).map((shape) => shape.id));
  }

  private shrinkRetyped(plane: Plane, shape: PlaneShape): void {
    const { run } = this;
    const old = shape.planeElement ? this.before.byPlaneElement.get(shape.planeElement) : undefined;
    if (shape.kind === 'subProcess' || !old?.expanded || !shape.planeElement) {
      return;
    }
    const was = shape.bounds.copy();
    const { width, height } = ShapeSizes.TASK;
    shape.bounds = new Box(was.x, Math.round(was.center.y - height / 2), width, height);
    shape.planeElement.set('isExpanded', undefined);
    shape.container = false;
    const drawing = run.drawing(plane);
    drawing.frames.reseatBoundaries(shape, was);
    run.active.add(shape.id);
    const { gap } = run.place.spacing.get(plane) ?? plane.spacing();
    const band = shape.poolId ? plane.shapes.get(shape.poolId)?.bounds : undefined;
    const own = new Set([...plane.edges.values()].filter((edge) => edge.sourceId === shape.id || edge.targetId === shape.id).map((edge) => edge.id));
    const result = drawing.space.closeStrip({ axis: 'x', from: shape.bounds.right, to: was.right + gap, gap, ignore: own, ...(band ? { within: band.copy() } : {}) });
    result?.moved.forEach((id) => run.place.moved.add(id));
    own.forEach((id) => run.reroute.add(id));
  }

  private childPlane(shape: PlaneShape): Plane {
    const { planes } = this.run;
    const existing = planes.find((plane) => plane.rootId === shape.id);
    if (existing) {
      return existing;
    }
    const child = new Plane(`BPMNPlane_${shape.id}`, shape.id, shape.el);
    planes.push(child);
    return child;
  }

  private toggle(plane: Plane, shape: PlaneShape, expand: boolean): void {
    const { run } = this;
    const { frames } = run.drawing(plane);
    if (expand) {
      frames.expand(shape, run.planes.find((candidate) => candidate.rootId === shape.id), run.semantics);
    } else {
      frames.collapse(shape, this.childPlane(shape), (run.place.spacing.get(plane) ?? plane.spacing()).gap);
    }
    run.active.add(shape.id);
    this.rerouteTouching(plane, new Set([shape.id]), new Set());
    run.notes.push(`${shape.id} drawn ${expand ? 'expanded' : 'collapsed'}`);
  }
}
