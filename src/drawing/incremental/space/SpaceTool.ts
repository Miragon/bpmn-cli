import { TextMetrics } from '@miragon/bpmn-render/text';
import type { Box } from '../../../model/index.js';
import { BoxAxis, type Axis } from '../../plane/BoxAxis.js';
import { DShape } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { FrameSpace } from './FrameSpace.js';
import { SpacePass, type SpaceRequest, type SpaceResult } from './SpacePass.js';
import { StripCloser, type StripRequest } from './StripCloser.js';

export type { SpaceRequest, SpaceResult } from './SpacePass.js';
export type { StripRequest } from './StripCloser.js';

interface Fit {
  id: string;
  pad: number;
  keep: ReadonlySet<string>;
  into: SpaceResult;
}

export class SpaceTool {
  private static readonly LABEL_PAD = 5;
  private static readonly MAX_DEPTH = 20;
  private static readonly MAX_FRAMES = 8;
  private static readonly BOUNDARY_REACH = 6;
  private static readonly BOUNDARY_ROOM = 10;

  constructor(private readonly plane: Plane) {}

  private static withinOf(box: Box | undefined): { within?: Box } {
    return box ? { within: box.copy() } : {};
  }

  shiftShape(id: string, dx: number, dy: number): string[] {
    const shape = this.plane.shapes.get(id);
    if (!shape || (!dx && !dy)) {
      return [];
    }
    const moved = [id];
    const move = (moving: DShape): void => moving.translate(dx, dy);
    move(shape);
    for (const boundary of this.plane.boundariesOf(id)) {
      move(boundary);
      moved.push(boundary.id);
    }
    if (shape.container && shape.kind === 'subProcess') {
      const { shapes, edges } = this.plane.contentOf(id);
      shapes.forEach(move);
      moved.push(...shapes.map((child) => child.id));
      const inside = new Set(shapes.map((child) => child.id));
      for (const edge of edges) {
        if (edge.sourceId && edge.targetId && inside.has(edge.sourceId) && inside.has(edge.targetId)) {
          edge.translate(dx, dy);
        }
      }
    }
    return moved;
  }

  makeSpace(request: SpaceRequest): SpaceResult {
    const { axis, line, delta } = request;
    if (!delta) {
      return { moved: new Set(), resized: new Set() };
    }
    const before = new Map([...this.plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()] as const));
    const along = BoxAxis.of(axis);
    const keep = request.keep ?? new Set<string>();
    const held = request.anchors && delta > 0 ? this.holders(request.anchors) : undefined;
    const frame = request.frame ? this.plane.shapes.get(request.frame) : undefined;
    const pass = new SpacePass({ plane: this.plane, axis, line, delta, band: undefined, keep, before, held, push: request.push, scope: undefined });
    const frameBox = frame && pass.boxOf(frame);
    if (frame && frameBox && frame.container && delta > 0 && along.near(frameBox) < line && along.far(frameBox) > line) {
      return new FrameSpace(pass).inFrame(frame);
    }
    return FrameSpace.applied(pass.scoped(along.bandOf(request.within ?? frame?.bounds)));
  }

  unitBox(shape: DShape): Box {
    return this.plane.boundariesOf(shape.id).reduce((unit, boundary) => unit.union(boundary.bounds), shape.bounds.copy());
  }

  borderPad(frame: DShape, box: Box, axis: Axis): number {
    let pad = 0;
    const room = SpaceTool.BOUNDARY_ROOM;
    for (const { bounds } of this.plane.boundariesOf(frame.id)) {
      const onBorder = axis === 'y' ? Math.abs(bounds.center.y - frame.bounds.bottom) <= SpaceTool.BOUNDARY_REACH : Math.abs(bounds.center.x - frame.bounds.right) <= SpaceTool.BOUNDARY_REACH;
      const facing = axis === 'y' ? bounds.x < box.right + room && bounds.right > box.x - room : bounds.y < box.bottom + room && bounds.bottom > box.y - room;
      if (onBorder && facing) {
        pad = Math.max(pad, (axis === 'y' ? bounds.height : bounds.width) / 2 + room);
      }
    }
    return pad;
  }

  fitInFrame(id: string, pad = 15, frameOf: (shape: DShape) => DShape | undefined = (shape) => new Frames(this.plane).of(shape), keepAlso: Iterable<string> = []): SpaceResult {
    const into: SpaceResult = { moved: new Set(), resized: new Set() };
    let inner = this.plane.shapes.get(id);
    const content = inner?.kind === 'subProcess' && inner.container ? this.plane.contentOf(id).shapes.map((child) => child.id) : [];
    const keep = new Set([id, ...this.plane.boundariesOf(id).map((boundary) => boundary.id), ...content, ...keepAlso]);
    for (let round = 0; inner && round < SpaceTool.MAX_FRAMES; round++) {
      const frame: DShape | undefined = this.frameAround(inner, frameOf, round > 0);
      if (!frame) {
        break;
      }
      this.growFrame(frame, inner, round === 0 ? this.labelOrDefault(inner) : undefined, { id, pad, keep, into });
      inner = frame;
    }
    return into;
  }

  roomBelowTitle(sub: DShape, label: Box, anchor: string): { delta: number; res: SpaceResult } | undefined {
    const delta = Math.ceil(Frames.labelArea(sub).y - label.y);
    if (delta <= 0) {
      return undefined;
    }
    return { delta, res: this.makeSpace({ axis: 'y', line: sub.bounds.y + 1, delta, anchors: [anchor], frame: sub.id, within: sub.bounds.copy() }) };
  }

  closeStrip(request: StripRequest): SpaceResult | undefined {
    return new StripCloser(this.plane, (space) => this.makeSpace(space)).close(request);
  }

  private holders(anchors: ReadonlyArray<string | undefined>): Set<string> {
    const { shapes } = this.plane;
    const holders = new Set<string>();
    for (const id of anchors) {
      const anchor = id ? shapes.get(id) : undefined;
      let current = anchor?.hostId ? (shapes.get(anchor.hostId) ?? anchor) : anchor;
      for (let depth = 0; current && depth < SpaceTool.MAX_DEPTH; depth++) {
        holders.add(current.id);
        current = current.parentId ? shapes.get(current.parentId) : undefined;
      }
    }
    return holders;
  }

  private growthScope(frame: DShape, axis: Axis): { within?: Box; frame?: string } {
    if (frame.kind === 'subProcess' && frame.container) {
      return { frame: frame.id };
    }
    if (axis === 'y') {
      return {};
    }
    if (frame.kind === 'participant') {
      return SpaceTool.withinOf(frame.bounds);
    }
    return SpaceTool.withinOf(frame.poolId ? this.plane.shapes.get(frame.poolId)?.bounds : undefined);
  }

  private labelOrDefault(shape: DShape): Box | undefined {
    const name = shape.el.peek<string>('name')?.trim();
    if (!name || shape.kind === 'boundary' || !DShape.hasExternalLabel(shape.kind)) {
      return undefined;
    }
    return shape.label ?? shape.labelAt(TextMetrics.labelSize(name), DShape.defaultLabelSide(shape.kind));
  }

  private frameAround(inner: DShape, frameOf: (shape: DShape) => DShape | undefined, holdingCentre: boolean): DShape | undefined {
    let frame = frameOf(inner);
    while (frame && holdingCentre && !frame.bounds.contains(inner.bounds.center)) {
      frame = frameOf(frame);
    }
    return frame;
  }

  private growFrame(frame: DShape, inner: DShape, label: Box | undefined, fit: Fit): void {
    const box = inner.kind === 'participant' || inner.kind === 'lane' ? inner.bounds : this.unitBox(inner);
    const framePad = inner.kind === 'lane' ? 0 : fit.pad;
    const reach = (axis: Axis): number => {
      const far = BoxAxis.of(axis).far(box) + Math.max(framePad, this.borderPad(frame, box, axis));
      return label ? Math.max(far, BoxAxis.of(axis).far(label) + Math.max(SpaceTool.LABEL_PAD, this.borderPad(frame, label, axis))) : far;
    };
    this.growTowards(frame, 'x', reach('x') - frame.bounds.right, fit);
    this.growTowards(frame, 'y', reach('y') - frame.bounds.bottom, fit);
  }

  private growTowards(frame: DShape, axis: Axis, over: number, { id, keep, into }: Fit): void {
    if (over <= 0.5) {
      return;
    }
    const line = BoxAxis.of(axis).far(frame.bounds) - 1;
    const { moved, resized } = this.makeSpace({ axis, line, delta: Math.ceil(over), keep, anchors: [id], ...this.growthScope(frame, axis) });
    moved.forEach((shapeId) => into.moved.add(shapeId));
    resized.forEach((shapeId) => into.resized.add(shapeId));
  }
}
