import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, DiagramIndex } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import { PlaneShape, type ShapeKind } from '../../plane/PlaneShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane, Spacing } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import type { Semantics } from '../../plane/Semantics.js';
import { ShapeSizes, type ShapeSize } from '../../plane/ShapeSizes.js';
import type { Drawing } from '../Drawing.js';

export interface Reuse {
  shape: PlaneShape;
  boundaries: PlaneShape[];
  from: Plane;
  content?: { shapes: PlaneShape[]; edges: PlaneEdge[] };
}

export interface Probe {
  id: string;
  kind: ShapeKind;
  parentId?: string;
  laneId?: string;
  poolId?: string;
}

export interface PlacementHooks {
  planeFor(id: string): Plane | undefined;
  afterPlace?: ((plane: Plane, shape: PlaneShape) => void) | undefined;
  afterNode?: ((plane: Plane, id: string) => void) | undefined;
  reattachBoundaries?: ((plane: Plane, host: PlaneShape) => void) | undefined;
}

export interface PlacementInput {
  planes: Plane[];
  semantics: Semantics;
  oldSource: ReadonlyMap<string, string>;
  oldTarget: ReadonlyMap<string, string>;
  collapsed: ReadonlySet<string>;
  notes: string[];
  newDrawing: (plane: Plane, touched?: Set<string>, fresh?: ReadonlySet<string>) => Drawing;
}

export interface PlacerMemo {
  placed: Set<string>;
  moved: Set<string>;
  spacing: Map<Plane, Spacing>;
  reuse: Map<string, Reuse>;
  blockSize: Map<string, ShapeSize>;
  spliced: Map<string, string>;
  joins: Map<string, string>;
  relabel: Set<string>;
  heads: Map<string, number>;
  skip: Map<string, number>;
  continued: Set<string>;
}

type Ends = Pick<PlaneEdge, 'sourceId' | 'targetId'>;

export class PlacementState implements PlacerMemo {
  private static readonly FRAME_PAD = 15;
  private static readonly MAX_VISITED = 500;

  readonly planes: Plane[];
  readonly semantics: Semantics;
  readonly oldSource: ReadonlyMap<string, string>;
  readonly oldTarget: ReadonlyMap<string, string>;
  readonly collapsed: ReadonlySet<string>;
  readonly notes: string[];
  readonly newDrawing: PlacementInput['newDrawing'];
  readonly placed = new Set<string>();
  readonly moved = new Set<string>();
  readonly spacing: Map<Plane, Spacing>;
  readonly reuse = new Map<string, Reuse>();
  readonly blockSize = new Map<string, ShapeSize>();
  readonly spliced = new Map<string, string>();
  readonly joins = new Map<string, string>();
  readonly relabel = new Set<string>();
  readonly heads = new Map<string, number>();
  readonly skip = new Map<string, number>();
  readonly continued = new Set<string>();
  hooks: PlacementHooks = { planeFor: () => undefined };
  current: string | undefined;
  private readonly drawings = new Map<Plane, Drawing>();

  constructor(input: PlacementInput) {
    this.planes = input.planes;
    this.semantics = input.semantics;
    this.oldSource = input.oldSource;
    this.oldTarget = input.oldTarget;
    this.collapsed = input.collapsed;
    this.notes = input.notes;
    this.newDrawing = input.newDrawing;
    this.spacing = new Map(input.planes.map((plane) => [plane, plane.spacing()]));
  }

  private static refilled<TElement>(into: Set<TElement>, from: ReadonlySet<TElement>): void {
    into.clear();
    from.forEach((element) => into.add(element));
  }

  private static remapped<TKey, TValue>(into: Map<TKey, TValue>, from: ReadonlyMap<TKey, TValue>): void {
    into.clear();
    from.forEach((value, key) => into.set(key, value));
  }

  checkpoint(): PlacerMemo {
    return {
      placed: new Set(this.placed),
      moved: new Set(this.moved),
      spacing: new Map(this.spacing),
      reuse: new Map(this.reuse),
      blockSize: new Map(this.blockSize),
      spliced: new Map(this.spliced),
      joins: new Map(this.joins),
      relabel: new Set(this.relabel),
      heads: new Map(this.heads),
      skip: new Map(this.skip),
      continued: new Set(this.continued),
    };
  }

  restore(memo: PlacerMemo): void {
    PlacementState.refilled(this.placed, memo.placed);
    PlacementState.refilled(this.moved, memo.moved);
    PlacementState.refilled(this.relabel, memo.relabel);
    PlacementState.refilled(this.continued, memo.continued);
    PlacementState.remapped(this.spacing, memo.spacing);
    PlacementState.remapped(this.reuse, memo.reuse);
    PlacementState.remapped(this.blockSize, memo.blockSize);
    PlacementState.remapped(this.spliced, memo.spliced);
    PlacementState.remapped(this.joins, memo.joins);
    PlacementState.remapped(this.heads, memo.heads);
    PlacementState.remapped(this.skip, memo.skip);
  }

  drawing(plane: Plane): Drawing {
    let drawing = this.drawings.get(plane);
    if (!drawing) {
      drawing = this.newDrawing(plane);
      this.drawings.set(plane, drawing);
    }
    return drawing;
  }

  spacingFor(plane: Plane): Spacing {
    let spacing = this.spacing.get(plane);
    if (!spacing) {
      spacing = plane.spacing((edge) => this.drawnEnds(plane, edge));
      this.spacing.set(plane, spacing);
    }
    return spacing;
  }

  spacingWithout(plane: Plane, ids: readonly string[]): Spacing {
    return plane.spacing((edge) => (ids.includes(edge.sourceId ?? '') || ids.includes(edge.targetId ?? '') ? undefined : this.drawnEnds(plane, edge)));
  }

  sizeFor(id: string): ShapeSize {
    const reused = this.reuse.get(id)?.shape.bounds;
    const known = this.blockSize.get(id) ?? (reused && { width: reused.width, height: reused.height });
    if (known) {
      return known;
    }
    const element = this.semantics.byId.get(id)!;
    return PlaneReader.shapeKind(element) === 'subProcess' && !this.collapsed.has(id) ? { ...ShapeSizes.NEW_SUB_PROCESS } : ShapeSizes.of(element);
  }

  newShape(plane: Plane, id: string, bounds: Box): PlaneShape {
    const reuse = this.reuse.get(id);
    const element = this.semantics.byId.get(id)!;
    const shape = PlaneReader.shapeOf(this.semantics, id, element, bounds, this.expandedOf(id));
    if (reuse?.shape.planeElement) {
      shape.planeElement = reuse.shape.planeElement;
    } else if (!reuse) {
      shape.planeElement = this.planes.map((candidate) => candidate.unbounded?.get(id)).find((unbounded) => !!unbounded);
    }
    const scope = this.semantics.scopeOf.get(id);
    const scopeId = scope?.peek<string>('id');
    if (scopeId && DiagramIndex.isSubProcess(scope) && plane.shapes.get(scopeId)?.expanded) {
      shape.parentId = scopeId;
    }
    if (reuse?.shape.label) {
      const { x, y } = reuse.shape.bounds;
      const { label } = reuse.shape;
      shape.label = new Box(label.x + bounds.x - x, label.y + bounds.y - y, label.width, label.height);
    }
    return shape;
  }

  commit(plane: Plane, shape: PlaneShape): void {
    const frame = shape.kind === 'boundary' ? undefined : new Frames(plane).of(shape);
    this.fitIntoInterior(shape, frame);
    plane.shapes.set(shape.id, shape);
    this.placed.add(shape.id);
    const reuse = this.reuse.get(shape.id);
    if (reuse) {
      this.bringAlong(plane, shape, reuse);
    }
    this.hooks.afterPlace?.(plane, shape);
    this.recordSpace(this.drawing(plane).space.fitInFrame(shape.id, PlacementState.FRAME_PAD));
    if (reuse || shape.kind === 'boundary') {
      return;
    }
    this.makeRoomForLabel(plane, shape, frame);
    this.hooks.reattachBoundaries?.(plane, shape);
  }

  recordSpace(result: { moved: Set<string> }): void {
    result.moved.forEach((id) => this.moved.add(id));
  }

  probeOf(plane: Plane, id: string): Probe {
    const { kind, parentId, laneId, poolId } = this.newShape(plane, id, new Box(0, 0, 0, 0));
    return { id, kind, ...(parentId ? { parentId } : {}), ...(laneId ? { laneId } : {}), ...(poolId ? { poolId } : {}) };
  }

  placeAt(plane: Plane, id: string, left: number, centreY: number, { width, height }: ShapeSize): PlaneShape {
    const shape = this.newShape(plane, id, new Box(Math.round(left), Math.round(centreY - height / 2), width, height));
    this.commit(plane, shape);
    return shape;
  }

  leadsTo(from: string, to: string): boolean {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length && seen.size <= PlacementState.MAX_VISITED) {
      for (const successor of this.semantics.successors(queue.shift()!)) {
        if (successor === to) {
          return true;
        }
        if (!seen.has(successor)) {
          seen.add(successor);
          queue.push(successor);
        }
      }
    }
    return false;
  }

  private expandedOf(id: string): boolean | undefined {
    if (!DiagramIndex.isSubProcess(this.semantics.byId.get(id))) {
      return undefined;
    }
    const reuse = this.reuse.get(id);
    return reuse ? reuse.shape.expanded === true : !this.collapsed.has(id) || this.blockSize.has(id);
  }

  private drawnEnds(plane: Plane, edge: PlaneEdge): Ends {
    const end = (now: string | undefined, old: string | undefined): string | undefined => (!now || plane.shapes.has(now) || now === this.current ? now : old);
    return { sourceId: end(edge.sourceId, this.oldSource.get(edge.id)), targetId: end(edge.targetId, this.oldTarget.get(edge.id)) };
  }

  private fitIntoInterior(shape: PlaneShape, frame: PlaneShape | undefined): void {
    if (!frame) {
      return;
    }
    const inner = Frames.interior(frame, PlacementState.FRAME_PAD);
    const dx = Math.max(0, Math.round(inner.x - shape.bounds.x));
    const dy = Math.max(0, Math.round(inner.y - shape.bounds.y));
    if (dx || dy) {
      shape.translate(dx, dy);
    }
  }

  private bringAlong(plane: Plane, shape: PlaneShape, reuse: Reuse): void {
    const dx = shape.bounds.x - reuse.shape.bounds.x;
    const dy = shape.bounds.y - reuse.shape.bounds.y;
    for (const moving of [...reuse.boundaries, ...(reuse.content?.shapes ?? [])]) {
      moving.translate(dx, dy);
      plane.shapes.set(moving.id, moving);
      this.moved.add(moving.id);
    }
    for (const edge of reuse.content?.edges ?? []) {
      edge.translate(dx, dy);
      if (reuse.from !== plane) {
        reuse.from.edges.delete(edge.id);
        plane.edges.set(edge.id, edge);
      }
    }
    this.reuse.delete(shape.id);
  }

  private makeRoomForLabel(plane: Plane, shape: PlaneShape, frame: PlaneShape | undefined): void {
    const name = shape.el.peek<string>('name')?.trim();
    if (!name || frame?.kind !== 'subProcess' || !PlaneShape.hasExternalLabel(shape.kind) || PlaneShape.defaultLabelSide(shape.kind) !== 'above') {
      return;
    }
    const room = this.drawing(plane).space.roomBelowTitle(frame, shape.labelAt(TextMetrics.labelSize(name), 'above'), shape.id);
    if (room) {
      this.recordSpace(room.res);
    }
  }
}
