import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, type BpmnElement } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import { PlaneShape, type LabelSide } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { LabelClutter } from './LabelClutter.js';
import { LabelSpots, type LabelSize } from './LabelSpots.js';

type Owner = PlaneShape | PlaneEdge;

export class LabelPlacer {
  private static readonly STEPS = 3;
  private static readonly BORDER_TOLERANCE = 2;

  constructor(private readonly plane: Plane) {}

  private static nameOf(element: BpmnElement): string | undefined {
    const name = element.peek<string>('name');
    return name && name.trim() ? name : undefined;
  }

  private static resizedInPlace(old: Box, bounds: Box, { width, height }: LabelSize): Box {
    const { center } = old;
    if (old.y >= bounds.bottom - LabelPlacer.BORDER_TOLERANCE) {
      return new Box(Math.round(center.x - width / 2), old.y, width, height);
    }
    if (old.bottom <= bounds.y + LabelPlacer.BORDER_TOLERANCE) {
      return new Box(Math.round(center.x - width / 2), Math.round(old.bottom - height), width, height);
    }
    const left = old.x >= bounds.right - LabelPlacer.BORDER_TOLERANCE ? old.x : Math.round(old.right - width);
    return new Box(left, Math.round(center.y - height / 2), width, height);
  }

  labelOnSide(shape: PlaneShape, side: LabelSide, size: LabelSize): Box {
    const host = this.hostOf(shape);
    const clutter = this.clutterAround(shape, host);
    const spots = new LabelSpots(size).aroundSide(shape, side, LabelPlacer.nameOf(shape.el), host);
    return this.firstFree(shape, clutter, spots) ?? spots[0]!;
  }

  placeShapeLabel(shape: PlaneShape, prefer?: LabelSide): Box | undefined {
    const name = LabelPlacer.nameOf(shape.el);
    if (!name || !PlaneShape.hasExternalLabel(shape.kind)) {
      return undefined;
    }
    const size = this.sizeOf(name);
    const host = this.hostOf(shape);
    const clutter = this.clutterAround(shape, host);
    const order = PlaneShape.LABEL_SIDES[shape.kind] ?? PlaneShape.LABEL_SIDES['event']!;
    const sides = prefer ? [prefer, ...order.filter((side) => side !== prefer)] : order;
    const spots = this.firstSpots(shape, sides, size, !prefer ? host : undefined, host);
    const spotter = new LabelSpots(size);
    const shifted = shape.kind !== 'boundary' || prefer ? sides.map((side) => spotter.aroundSide(shape, side, name, host)) : [];
    const free = this.firstFree(shape, clutter, spots, ...shifted);
    shape.label = free ?? (prefer ? shape.labelAt(size, prefer, host) : spots[0]!);
    return shape.label;
  }

  placeEdgeLabel(edge: PlaneEdge): Box | undefined {
    const name = LabelPlacer.nameOf(edge.el);
    if (!name || edge.points.length < 2 || !(edge.el.is('bpmn:SequenceFlow') || edge.el.is('bpmn:MessageFlow'))) {
      return undefined;
    }
    const clutter = new LabelClutter(this.plane, edge.id, new Set());
    const spots = new LabelSpots(this.sizeOf(name)).alongEdge(edge.points);
    edge.label = spots.find((spot) => !clutter.collides(spot, name)) ?? spots.find((spot) => !clutter.collides(spot)) ?? spots[0]!;
    return edge.label;
  }

  clearTitles(wasClear: (owner: Owner, sub: PlaneShape) => boolean): Array<[string, string]> {
    const titles = [...this.plane.shapes.values()].flatMap((shape): Array<[PlaneShape, Box]> => {
      const title = Frames.title(shape);
      return title ? [[shape, title]] : [];
    });
    const onTitle = (box: Box): PlaneShape | undefined => titles.find(([, title]) => box.overlaps(title))?.[0];
    const cleared: Array<[string, string]> = [];
    for (const owner of titles.length ? [...this.plane.shapes.values(), ...this.plane.edges.values()] : []) {
      const old = owner.label;
      const sub = old && LabelPlacer.nameOf(owner.el) ? onTitle(old) : undefined;
      if (!old || !sub || !wasClear(owner, sub) || (owner instanceof PlaneShape && !PlaneShape.hasExternalLabel(owner.kind))) {
        continue;
      }
      this.replaceLabel(owner);
      const home = this.homeOf(owner);
      if (owner.label && !onTitle(owner.label) && (!home || owner.label.isInside(home.bounds))) {
        cleared.push([owner.id, sub.id]);
      } else {
        owner.label = old;
      }
    }
    return cleared;
  }

  refitLabel(owner: Owner): Box | undefined {
    const name = LabelPlacer.nameOf(owner.el);
    if (!name) {
      return undefined;
    }
    if (!(owner instanceof PlaneShape)) {
      return this.placeEdgeLabel(owner);
    }
    if (!PlaneShape.hasExternalLabel(owner.kind)) {
      return undefined;
    }
    if (!owner.label) {
      return this.placeShapeLabel(owner);
    }
    const box = LabelPlacer.resizedInPlace(owner.label, owner.bounds, this.sizeOf(name));
    const host = this.hostOf(owner);
    if (new LabelClutter(this.plane, owner.id, new Set([owner.id, ...(host ? [host.id] : [])])).collides(box)) {
      return this.placeShapeLabel(owner);
    }
    owner.label = box;
    return box;
  }

  private sizeOf(name: string): LabelSize {
    const { width, height } = TextMetrics.labelSize(name);
    return { width, height };
  }

  private hostOf({ hostId }: PlaneShape): PlaneShape | undefined {
    return hostId ? this.plane.shapes.get(hostId) : undefined;
  }

  private clutterAround(shape: PlaneShape, host: PlaneShape | undefined): LabelClutter {
    const clutter = new LabelClutter(this.plane, shape.id, new Set([shape.id, ...(host ? [host.id] : [])]));
    if (host) {
      clutter.shapes.push(host.bounds);
    }
    return clutter;
  }

  private firstSpots(shape: PlaneShape, sides: readonly LabelSide[], size: LabelSize, boundaryHost: PlaneShape | undefined, host: PlaneShape | undefined): Box[] {
    const spots: Box[] = [];
    for (let step = 0; step < LabelPlacer.STEPS; step++) {
      if (shape.kind === 'boundary' && boundaryHost) {
        spots.push(...new LabelSpots(size).onBoundary(shape.bounds, boundaryHost.bounds, step));
      } else {
        spots.push(...sides.map((side) => shape.labelAt(size, side, host, step)));
      }
    }
    return spots;
  }

  private firstFree(shape: PlaneShape, clutter: LabelClutter, ...lists: Array<readonly Box[]>): Box | undefined {
    const frame = shape.kind === 'boundary' ? undefined : new Frames(this.plane).of(shape);
    const home = frame ? this.homeOf(shape) : undefined;
    const area = frame ? Frames.labelArea(frame) : undefined;
    const tiers = [LabelPlacer.nameOf(shape.el), undefined];
    for (const name of tiers) {
      for (const spots of lists) {
        const free = spots.filter((spot) => !clutter.collides(spot, name));
        const fitting = (area ? free.find((spot) => spot.isInside(area)) : undefined) ?? free.find((spot) => !home || spot.isInside(home.bounds));
        if (fitting) {
          return fitting;
        }
      }
    }
    const all = lists.flat();
    return tiers.flatMap((name) => all.find((spot) => !clutter.collides(spot, name)) ?? [])[0];
  }

  private frameOf(shape: PlaneShape | undefined): PlaneShape | undefined {
    return (shape?.parentId ? this.plane.shapes.get(shape.parentId) : undefined) ?? (shape?.poolId ? this.plane.shapes.get(shape.poolId) : undefined);
  }

  private homeOf(owner: Owner): PlaneShape | undefined {
    if (owner instanceof PlaneShape) {
      return this.frameOf(owner);
    }
    const source = this.frameOf(owner.sourceId ? this.plane.shapes.get(owner.sourceId) : undefined);
    return source && source === this.frameOf(owner.targetId ? this.plane.shapes.get(owner.targetId) : undefined) ? source : undefined;
  }

  private replaceLabel(owner: Owner): void {
    if (!(owner instanceof PlaneShape)) {
      this.placeEdgeLabel(owner);
      return;
    }
    const side = owner.labelSide(this.hostOf(owner)?.bounds);
    this.placeShapeLabel(owner, side === 'inside' ? undefined : side);
  }
}
