import { Box, BpmnError } from '../../model/index.js';
import type { PlaceOperation } from '../../operations/index.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import type { Axis } from '../plane/BoxAxis.js';
import type { PlaneShape } from '../plane/PlaneShape.js';
import { Frames } from '../plane/Frames.js';
import type { Plane, Spacing } from '../plane/Plane.js';
import type { DrawnDiagram } from './DrawnDiagram.js';
import { BoundaryPlacement } from './placement/BoundaryPlacement.js';
import { RoomMaker } from './placement/RoomMaker.js';

interface Placing {
  plane: Plane;
  reference: PlaneShape;
  referenceUnit: Box;
  spacing: Spacing;
}

interface PlacedTarget {
  shape: PlaneShape;
  unit: Box;
}

export class ShapePlacement {
  private static readonly CLEAR = 20;

  private readonly fixed: PlaneShape[] = [];
  private readonly words: string[] = [];

  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: PlaceOperation,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  run(): string[] {
    const { side, ids } = this.operation;
    if (side) {
      return new BoundaryPlacement(this.diagram, this.before, this.notes).run(ids?.[0] ?? '', side);
    }
    const items = [...new Set(ids)].map((id) => this.diagram.movableShape(id));
    const { plane, shape: reference } = items[0]!;
    for (const item of items) {
      this.diagram.samePlane(plane, item.plane, item.shape.id, reference.id);
    }
    const group = plane.outermost(items.map((item) => item.shape));
    const placing: Placing = { plane, reference, referenceUnit: this.diagram.drawing(plane).space.unitBox(reference), spacing: plane.spacing() };
    const dy = Math.round(this.rowOffset(placing));
    const dx = Math.round(this.columnOffset(placing));
    return this.moveGroup(placing, group, dx, dy);
  }

  private target({ plane, reference }: Placing, id: string): PlacedTarget {
    const found = this.diagram.drawnShape(id);
    this.diagram.samePlane(plane, found.plane, reference.id, id);
    this.fixed.push(found.shape);
    return { shape: found.shape, unit: this.unitOf(plane, found.shape) };
  }

  private unitOf(plane: Plane, shape: PlaneShape): Box {
    return shape.container ? shape.bounds : this.diagram.drawing(plane).space.unitBox(shape);
  }

  private rowOffset(placing: Placing): number {
    const { reference, referenceUnit, spacing } = placing;
    const { rowOf, below, above } = this.operation;
    const { bounds } = reference;
    if (rowOf) {
      this.words.push(`in the row of ${rowOf}`);
      return this.target(placing, rowOf).shape.bounds.center.y - bounds.center.y;
    }
    if (below) {
      const anchor = this.target(placing, below);
      this.words.push(`below ${below}`);
      const top = referenceUnit.y - bounds.y;
      return Math.max(anchor.shape.bounds.center.y + spacing.row, anchor.unit.bottom + ShapePlacement.CLEAR - top + bounds.height / 2) - bounds.center.y;
    }
    if (above) {
      const anchor = this.target(placing, above);
      this.words.push(`above ${above}`);
      const under = referenceUnit.bottom - bounds.bottom;
      return Math.min(anchor.shape.bounds.center.y - spacing.row, anchor.unit.y - ShapePlacement.CLEAR - under - bounds.height / 2) - bounds.center.y;
    }
    return 0;
  }

  private columnOffset(placing: Placing): number {
    const { reference, referenceUnit, spacing } = placing;
    const { columnOf, after, before } = this.operation;
    if (columnOf) {
      this.words.push(`in the column of ${columnOf}`);
      return this.target(placing, columnOf).shape.bounds.center.x - reference.bounds.center.x;
    }
    if (after) {
      this.words.push(`after ${after}`);
      return this.target(placing, after).unit.right + spacing.gap - referenceUnit.x;
    }
    if (before) {
      this.words.push(`before ${before}`);
      return this.target(placing, before).unit.x - spacing.gap - referenceUnit.right;
    }
    return 0;
  }

  private moveGroup(placing: Placing, group: readonly PlaneShape[], dx: number, dy: number): string[] {
    const { plane, reference } = placing;
    const target = this.words.join(' and ');
    this.refuseLeavingTargets(plane, group, dx, dy);
    const drawing = this.diagram.drawing(plane);
    const room = new RoomMaker(plane, drawing);
    room.checkFrames(group, dx, dy, target, this.fixed);
    if (!dx && !dy) {
      this.notes.push(`${reference.id} is already there`);
      return [];
    }
    for (const member of group) {
      drawing.space.shiftShape(member.id, dx, dy);
    }
    room.makeRoom({ moved: group, references: this.fixed, before: this.before, target, holds: () => this.rowHolds(placing) && this.columnHolds(placing), lock: this.lockedAxes() }, this.notes);
    return drawing.settle(this.before);
  }

  private refuseLeavingTargets(plane: Plane, group: readonly PlaneShape[], dx: number, dy: number): void {
    const frames = new Frames(plane);
    for (const frame of this.fixed.filter((shape) => shape.container)) {
      for (const member of group.filter((shape) => frames.chain(shape).includes(frame))) {
        const unit = this.diagram.drawing(plane).space.unitBox(member);
        if (!new Box(unit.x + dx, unit.y + dy, unit.width, unit.height).isInside(frame.bounds)) {
          throw BpmnError.model('E_LEAVES_CONTAINER', `Placing ${member.id} ${this.words.join(' and ')} would move it out of its ${frame.frameWord} ${frame.id}`, {
            element: member.id,
            related: [frame.id],
            hint: `${frame.id} holds ${member.id}: pick a reference inside it, or move the node out of it first (\`bpmn move <file> ${member.id} --in <scopeId>\` / \`--lane <laneId>\`).`,
          });
        }
      }
    }
  }

  private rowHolds({ plane, reference }: Placing): boolean {
    const { rowOf, below, above } = this.operation;
    const unit = this.diagram.drawing(plane).space.unitBox(reference);
    if (rowOf) {
      return Math.abs(reference.bounds.center.y - plane.shapes.get(rowOf)!.bounds.center.y) <= 1;
    }
    if (below) {
      return unit.y >= this.unitOf(plane, plane.shapes.get(below)!).bottom - 1;
    }
    return !above || unit.bottom <= this.unitOf(plane, plane.shapes.get(above)!).y + 1;
  }

  private columnHolds({ plane, reference }: Placing): boolean {
    const { columnOf, after, before } = this.operation;
    const unit = this.diagram.drawing(plane).space.unitBox(reference);
    if (columnOf) {
      return Math.abs(reference.bounds.center.x - plane.shapes.get(columnOf)!.bounds.center.x) <= 1;
    }
    if (after) {
      return unit.x >= this.unitOf(plane, plane.shapes.get(after)!).right - 1;
    }
    return !before || unit.right <= this.unitOf(plane, plane.shapes.get(before)!).x + 1;
  }

  private lockedAxes(): Axis[] {
    const { columnOf, after, before, rowOf, below, above } = this.operation;
    return [...(columnOf || after || before ? (['x'] as const) : []), ...(rowOf || below || above ? (['y'] as const) : [])];
  }
}
