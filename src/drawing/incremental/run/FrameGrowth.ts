import { Box } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import type { LayoutRun } from './LayoutRun.js';

export class FrameGrowth {
  private static readonly GROUP_PAD = 15;
  private static readonly TITLE_ROOM = 4;

  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
    private readonly baseline: ReadonlyMap<string, Box>,
  ) {}

  growForTitles(): void {
    for (const plane of this.run.planes) {
      for (const shape of [...plane.shapes.values()]) {
        const name = shape.el.peek<string>('name');
        if (name && shape.kind === 'subProcess' && shape.container && !this.run.fromEngine.has(shape.id) && name !== this.before.names.get(this.run.oldId(shape))) {
          this.growForTitle(plane, shape);
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
      const result = this.run.drawing(plane).separation.separate({ active: moving.filter((id) => place.placed.has(id) || active.has(id)), moved: moving, movable: new Set([...moving, ...neighbours]), baseline: this.baseline });
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
