import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, type BpmnElement } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane, Spacing } from '../../plane/Plane.js';
import { ShapeSides } from '../../plane/ShapeSides.js';
import type { LayoutRun } from './LayoutRun.js';

interface Grown {
  old: Box;
  width: number;
  height: number;
}

export class FrameGrowth {
  private static readonly FRAME_PAD = 15;
  private static readonly GROUP_PAD = 15;
  private static readonly TITLE_ROOM = 4;
  private static readonly MIN_NEXT_GAP = 40;
  private static readonly ROW_MARGIN = 10;

  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
    private readonly baseline: ReadonlyMap<string, Box>,
  ) {}

  growForNames(): void {
    for (const plane of this.run.planes) {
      const spacing = this.run.place.spacing.get(plane) ?? plane.spacing();
      for (const shape of [...plane.shapes.values()]) {
        const name = shape.el.peek<string>('name');
        if (name && (shape.kind === 'task' || shape.kind === 'subProcess') && !this.run.fromEngine.has(shape.id) && name !== this.before.names.get(this.run.oldId(shape))) {
          this.growForName(plane, shape, name, spacing);
        }
      }
    }
  }

  separateAll(): void {
    const { place, active, fromEngine, semantics } = this.run;
    const changed = new Set([...place.placed, ...active, ...place.moved]);
    for (const plane of this.run.planes) {
      const moving = [...changed].filter((id) => plane.shapes.has(id) && !fromEngine.has(id));
      if (!moving.length) {
        continue;
      }
      const neighbours = moving.flatMap((id) => [...semantics.predecessors(id), ...semantics.successors(id)]).filter((id) => plane.shapes.has(id));
      const result = this.run.drawing(plane).separation.separate({ active: moving.filter((id) => place.placed.has(id) || active.has(id)), movable: new Set([...moving, ...neighbours]), baseline: this.baseline });
      this.noteMoved([...result.moved, ...result.resized]);
      if (result.unresolved.length) {
        this.run.notes.push(`overlap left: ${result.unresolved.map(([firstId, secondId]) => `${firstId}~${secondId}`).join(', ')}`);
      }
    }
  }

  growGroups(): void {
    for (const plane of this.run.planes) {
      const groups = [...plane.shapes.values()].filter((group) => group.kind === 'group');
      for (const id of groups.length ? this.run.place.placed : []) {
        const shape = plane.shapes.get(id);
        if (shape?.isLeaf && shape.kind !== 'boundary') {
          groups.filter((group) => shape.bounds.overlaps(group.bounds) && !shape.bounds.isInside(group.bounds, 10)).forEach((group) => this.growGroup(group, shape));
        }
      }
    }
  }

  private growGroup(group: DShape, shape: DShape): void {
    const box = group.bounds;
    const pad = FrameGrowth.GROUP_PAD;
    const left = Math.min(box.x, shape.bounds.x - pad);
    const top = Math.min(box.y, shape.bounds.y - pad);
    group.bounds = new Box(left, top, Math.max(box.right, shape.bounds.right + pad) - left, Math.max(box.bottom, shape.bounds.bottom + pad) - top);
    this.run.place.moved.add(group.id);
  }

  private noteMoved(ids: Iterable<string>): void {
    for (const id of ids) {
      this.run.place.moved.add(id);
    }
  }

  private textRoom(plane: Plane, shape: DShape): number {
    const { el } = shape;
    const marker = shape.kind === 'subProcess' || el.is('bpmn:CallActivity') || !!el.peek<BpmnElement>('loopCharacteristics') || el.peek<boolean>('isForCompensation') === true;
    const below = plane.boundariesOf(shape.id).some((boundary) => ShapeSides.attached(boundary.bounds, shape.bounds) === 'bottom');
    return marker || below ? TextMetrics.BOTTOM_ROOM : 0;
  }

  private growForName(plane: Plane, shape: DShape, name: string, spacing: Spacing): void {
    if (shape.container) {
      this.growForTitle(plane, shape);
      return;
    }
    const size = TextMetrics.activitySize(name, shape.bounds, this.textRoom(plane, shape));
    if (!size) {
      return;
    }
    const old = shape.bounds.copy();
    const { width, height } = size;
    if (width > old.width) {
      this.makeRoomOnRow(plane, shape, { old, width, height }, spacing);
    }
    shape.bounds = new Box(old.x, Math.round(old.center.y - height / 2), width, height);
    const frame = new Frames(plane).of(shape);
    const inner = frame ? Frames.interior(frame, FrameGrowth.FRAME_PAD) : undefined;
    if (inner && shape.bounds.y < inner.y) {
      shape.bounds.y = Math.round(inner.y);
    }
    const drawing = this.run.drawing(plane);
    drawing.frames.reseatBoundaries(shape, old);
    this.noteMoved(drawing.space.fitInFrame(shape.id, FrameGrowth.FRAME_PAD).moved);
    this.run.active.add(shape.id);
    this.run.place.moved.add(shape.id);
    this.run.grown.add(shape.id);
    this.run.notes.push(`${shape.id} grew to ${width}x${height} to fit its name`);
  }

  private makeRoomOnRow(plane: Plane, shape: DShape, { old, width, height }: Grown, spacing: Spacing): void {
    const growth = width - old.width;
    const own = new Set([shape.id, ...plane.boundariesOf(shape.id).map((boundary) => boundary.id)]);
    const top = old.center.y - height / 2;
    const onRow = (box: Box): boolean => box.y < top + height + FrameGrowth.ROW_MARGIN && box.bottom > top - FrameGrowth.ROW_MARGIN;
    const frames = new Frames(plane);
    const next = [...plane.shapes.values()].filter((other) => !own.has(other.id) && (other.isLeaf || (other.kind === 'subProcess' && other.container && !frames.within(shape, other))) && other.bounds.x >= old.right - 0.5 && onRow(other.bounds));
    const lefts = next.flatMap(({ bounds, label }) => [bounds.x, ...(label && onRow(label) && label.right > old.right ? [Math.max(old.right, label.x)] : [])]);
    const free = Math.min(Number.POSITIVE_INFINITY, ...lefts.map((left) => left - old.right));
    if (free - growth >= Math.min(spacing.gap, FrameGrowth.MIN_NEXT_GAP)) {
      return;
    }
    const sub = shape.parentId ? plane.shapes.get(shape.parentId) : undefined;
    const frame = sub ?? (shape.poolId ? plane.shapes.get(shape.poolId) : undefined);
    const result = this.run.drawing(plane).space.makeSpace({ axis: 'x', line: old.right + 0.5, delta: growth, keep: own, anchors: [shape.id], ...(frame ? { within: frame.bounds.copy() } : {}), ...(sub ? { frame: sub.id } : {}) });
    this.noteMoved([...result.moved, ...result.resized]);
  }

  private growForTitle(plane: Plane, shape: DShape): void {
    const title = Frames.title(shape);
    const old = this.run.oldTitle(shape);
    const gained = title && (old ? title.height - old.height : title.bottom - shape.bounds.y);
    if (!title || !gained || gained <= 0) {
      return;
    }
    const { shapes, edges } = plane.contentOf(shape.id);
    const under = (box: Box): boolean => box.y >= shape.bounds.y && box.y < shape.bounds.bottom && box.x < title.right + 2 && box.right > title.x - 2;
    const boxes = [...shapes.flatMap((child) => [child.bounds, ...(child.label ? [child.label] : [])]), ...edges.flatMap((edge) => edge.label ?? [])].filter(under);
    const delta = boxes.length ? Math.ceil(Math.min(gained, title.bottom + FrameGrowth.TITLE_ROOM - Math.min(...boxes.map((box) => box.y)))) : 0;
    if (delta <= 0) {
      return;
    }
    const result = this.run.drawing(plane).space.makeSpace({ axis: 'y', line: shape.bounds.y + 1, delta, anchors: [shape.id], frame: shape.id, within: shape.bounds.copy() });
    this.noteMoved([...result.moved, ...result.resized, shape.id]);
    this.run.notes.push(`${shape.id} made ${delta} px of room below its new title`);
  }
}
