import { Box } from '../../model/index.js';
import { GroupShapes, type GroupItem } from './GroupShapes.js';

type Pads = { top: number; right: number; bottom: number; left: number };

export class GroupFit {
  static readonly PAD = 20;
  static readonly NAME_ROOM = 20;

  private static readonly ROUNDS = 8;

  constructor(
    private readonly shapes: Map<string, GroupItem>,
    private readonly self: string,
    private readonly top: number,
  ) {}

  static labelOn(box: Box, size: Pick<Box, 'width' | 'height'>): Box {
    return new Box(Math.round(box.center.x - size.width / 2), Math.round(box.y + Math.max(0, GroupFit.NAME_ROOM / 2 - size.height / 2)), size.width, size.height);
  }

  private static half(gap: number): number {
    return Math.max(0, Math.floor(gap / 2));
  }

  private static limitByFrame(pads: Pads, inner: Box, frame: Box): void {
    pads.top = Math.min(pads.top, GroupFit.half(inner.y - frame.y));
    pads.right = Math.min(pads.right, GroupFit.half(frame.right - inner.right));
    pads.bottom = Math.min(pads.bottom, GroupFit.half(frame.bottom - inner.bottom));
    pads.left = Math.min(pads.left, GroupFit.half(inner.x - frame.x));
  }

  fit(ids: Set<string>): Box {
    const { shapes, self } = this;
    this.addEventsOf(ids);
    let box: Box | undefined;
    for (let round = 0; round < GroupFit.ROUNDS; round++) {
      box = this.padded(ids, this.withLabels(ids));
      const size = ids.size;
      for (const shape of shapes.values()) {
        if (shape.id !== self && !ids.has(shape.id) && GroupShapes.holds(box, shape)) {
          ids.add(shape.id);
          if (shape.host && shapes.has(shape.host)) {
            ids.add(shape.host);
          }
        }
      }
      this.addEventsOf(ids);
      if (ids.size === size) {
        break;
      }
    }
    return box!;
  }

  private addEventsOf(ids: Set<string>): void {
    for (const shape of this.shapes.values()) {
      if (shape.host && ids.has(shape.host)) {
        ids.add(shape.id);
      }
    }
  }

  private isOther(shape: GroupItem, ids: ReadonlySet<string>): boolean {
    return shape.id !== this.self && !ids.has(shape.id) && !shape.el.is('bpmn:Group');
  }

  private padded(ids: ReadonlySet<string>, members: Box): Box {
    const pads = { top: this.top, right: GroupFit.PAD, bottom: GroupFit.PAD, left: GroupFit.PAD };
    for (const shape of this.shapes.values()) {
      if (this.isOther(shape, ids)) {
        if (shape.whole && members.isInside(shape.box)) {
          GroupFit.limitByFrame(pads, members, shape.box);
        } else {
          this.limitByNeighbour(pads, members, shape.box);
        }
      }
    }
    return new Box(members.x - pads.left, members.y - pads.top, members.width + pads.left + pads.right, members.height + pads.top + pads.bottom);
  }

  private limitByNeighbour(pads: Pads, members: Box, other: Box): void {
    const across = other.x < members.right + GroupFit.PAD && other.right > members.x - GroupFit.PAD;
    const along = other.y < members.bottom + GroupFit.PAD && other.bottom > members.y - this.top;
    if (across && other.y >= members.bottom) {
      pads.bottom = Math.min(pads.bottom, GroupFit.half(other.y - members.bottom));
    }
    if (across && other.bottom <= members.y) {
      pads.top = Math.min(pads.top, GroupFit.half(members.y - other.bottom));
    }
    if (along && other.x >= members.right) {
      pads.right = Math.min(pads.right, GroupFit.half(other.x - members.right));
    }
    if (along && other.right <= members.x) {
      pads.left = Math.min(pads.left, GroupFit.half(members.x - other.right));
    }
  }

  private withLabels(ids: ReadonlySet<string>): Box {
    const { shapes } = this;
    let members = Box.unionAll([...ids].map((id) => shapes.get(id)!.box))!;
    const others = [...shapes.values()].filter((shape) => this.isOther(shape, ids) && !(shape.whole && members.isInside(shape.box)));
    for (const id of [...ids].sort()) {
      const label = shapes.get(id)!.label;
      const grown = label && members.union(label);
      if (grown && others.every((other) => !other.box.overlaps(grown) || other.box.overlaps(members))) {
        members = grown;
      }
    }
    return members;
  }
}
