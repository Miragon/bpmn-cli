import { Box, type BpmnElement } from '../../../model/index.js';
import type { DShape, ShapeKind } from '../../plane/DShape.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane, Spacing } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import { Semantics } from '../../plane/Semantics.js';
import { ShapeSides } from '../../plane/ShapeSides.js';
import type { ShapeSize } from '../../plane/ShapeSizes.js';
import type { BoundaryPlacer } from './BoundaryPlacer.js';
import { ChainSearch } from './ChainSearch.js';
import type { NeighbourRoom } from './NeighbourRoom.js';
import type { PlacementObstacles } from './PlacementObstacles.js';
import type { PlacementState, Probe } from './PlacementState.js';
import { RowChooser, type RowSearch } from './RowChooser.js';
import type { Cand } from './RowCosts.js';

interface Spot {
  plane: Plane;
  id: string;
  spacing: Spacing;
  size: ShapeSize;
  probe: Probe;
  frame: DShape | undefined;
  exclude: Set<string>;
  kind: ShapeKind;
}

interface RowPlace {
  center: number;
  box: Box;
  gap: number;
  successorGap: number;
  maxRight: number;
}

export class NeighbourPlacer {
  private static readonly RANK_PENALTY = 40;
  private static readonly MAX_SUCCESSOR_GAP = 40;
  private static readonly LEFT_OF_PLANE = 160;
  private static readonly TOP_OF_PLANE = 40;

  private readonly chain: ChainSearch;

  constructor(
    private readonly state: PlacementState,
    private readonly obstacles: PlacementObstacles,
    private readonly rows: RowChooser,
    private readonly boundaries: BoundaryPlacer,
    private readonly room: NeighbourRoom,
  ) {
    this.chain = new ChainSearch(state);
  }

  placeAfter(plane: Plane, id: string, preds: DShape[], pending: ReadonlySet<string>): void {
    const main = preds[0]!;
    const host = main.hostId ? plane.shapes.get(main.hostId) : undefined;
    const spot = this.spotOf(plane, id, [main, host]);
    if (main.kind === 'boundary') {
      this.placeOnExceptionPath(spot, main, host, pending);
      return;
    }
    const drawnSuccessors = this.state.semantics.successors(main.id).filter((successor) => successor !== id && plane.shapes.has(successor)).map((successor) => plane.shapes.get(successor)!);
    const spliced = this.chain.spliceTarget(plane, id, main.id);
    const successor = spliced ? plane.shapes.get(spliced) : undefined;
    if (successor) {
      this.state.spliced.set(id, successor.id);
    }
    if (successor || !drawnSuccessors.length) {
      this.placeOnRow(spot, main, preds, successor, drawnSuccessors.length > 0);
    } else {
      this.placeOnBranch(spot, main, drawnSuccessors, pending);
    }
  }

  placeBefore(plane: Plane, id: string, successor: DShape): void {
    const { spacing, size, probe, frame, exclude } = this.spotOf(plane, id, [successor]);
    const inner = frame ? Frames.interior(frame, 10) : undefined;
    const left = successor.bounds.x - spacing.gap - size.width;
    const blockers = this.obstacles.of(plane, frame, exclude);
    const middle = successor.bounds.center.y;
    if (!inner || left >= inner.x) {
      for (let rowStep = 0; rowStep < 3; rowStep++) {
        const center = middle + rowStep * spacing.row;
        if (this.obstacles.isFree(new Box(left, center - size.height / 2, size.width, size.height), blockers)) {
          this.state.placeAt(plane, id, left, this.rows.intoOwnLane(plane, probe, left, center, size, [], successor), size);
          return;
        }
      }
    }
    const box = new Box(successor.bounds.x - 0.5, middle - size.height / 2, size.width, size.height);
    this.room.push(plane, successor, probe, { id, box, line: box.x, delta: size.width + spacing.gap, successor });
    const shifted = successor.bounds.x - spacing.gap - size.width;
    this.state.placeAt(plane, id, shifted, this.rows.intoOwnLane(plane, probe, shifted, successor.bounds.center.y, size, [], successor), size);
  }

  placeUnconnected(plane: Plane, id: string): DShape {
    const { spacing, size, frame, exclude } = this.spotOf(plane, id, []);
    const members = [...plane.shapes.values()].filter((shape) => shape.id !== id && shape.isLeaf && shape.kind !== 'boundary' && shape.kind !== 'annotation' && shape.kind !== 'data' && this.obstacles.within(plane, shape, frame) && shape !== frame);
    if (members.length) {
      const left = Math.min(...members.map((shape) => shape.bounds.x));
      const below = this.obstacles.contentBottom(plane, frame, exclude) ?? Math.max(...members.map((shape) => shape.bounds.bottom));
      const centre = below + Math.max(30, spacing.row - 80) + size.height / 2;
      const [row] = this.rows.freeRows(plane, frame, { left, size, extent: 0, exclude }, { centre, step: spacing.row / 2, count: 1 });
      return this.state.placeAt(plane, id, left, row!.centre, size);
    }
    const inside = frame?.kind === 'subProcess';
    if (frame) {
      const inner = Frames.interior(frame, inside ? 20 : 15);
      return this.state.placeAt(plane, id, inner.x + (inside ? 10 : 20), inside ? inner.y + 20 + size.height / 2 : inner.center.y, size);
    }
    const others = [...plane.shapes.values()].filter((shape) => shape.id !== id);
    const left = others.length ? Math.min(...others.map((shape) => shape.bounds.x)) : NeighbourPlacer.LEFT_OF_PLANE;
    const bottom = others.length ? Math.max(...others.map((shape) => shape.bounds.bottom)) : NeighbourPlacer.TOP_OF_PLANE;
    return this.state.placeAt(plane, id, left, bottom + 60 + size.height / 2, size);
  }

  private spotOf(plane: Plane, id: string, anchors: ReadonlyArray<DShape | undefined>): Spot {
    const probe = this.state.probeOf(plane, id);
    return {
      plane,
      id,
      spacing: this.state.spacingFor(plane),
      size: this.state.sizeFor(id),
      probe,
      frame: new Frames(plane).of(probe),
      exclude: new Set([id, ...this.obstacles.homeGroups(plane, anchors)]),
      kind: PlaneReader.shapeKind(this.state.semantics.byId.get(id)!),
    };
  }

  private placeCand({ plane, id, probe }: Spot, cand: Cand, anchor: DShape): void {
    if (cand.insert) {
      const { line, delta, within, frame } = cand.insert;
      this.state.recordSpace(this.state.drawing(plane).space.makeSpace({ axis: 'y', line, delta, anchors: [anchor.id, probe.parentId], ...(within ? { within } : {}), ...(frame ? { frame } : {}) }));
    }
    if (cand.top) {
      this.boundaries.seatOnTop(plane, anchor, cand.top);
    }
    this.state.placeAt(plane, id, cand.x, this.rows.intoOwnLane(plane, probe, cand.x, cand.centre, cand.size, [], anchor), cand.size);
  }

  private placeOnExceptionPath(spot: Spot, event: DShape, host: DShape | undefined, pending: ReadonlySet<string>): void {
    const { plane, id, spacing, size, probe, frame, exclude, kind } = spot;
    const anchor = host ?? event;
    const extent = this.chain.extent(id, pending, spacing.gap);
    const lefts = [anchor.bounds.right + spacing.gap, Math.round(event.bounds.center.x - size.width / 2)];
    const onTop = !!host && ShapeSides.attached(event.bounds, host.bounds) === 'top';
    const floor = Math.max(event.bounds.bottom, host ? host.bounds.bottom : Number.NEGATIVE_INFINITY);
    const searchAt = (left: number): RowSearch => ({ left, size, extent, exclude });
    const first = anchor.bounds.center.y + spacing.row;
    const cands = lefts.flatMap((left, rank) => this.rows.rowCandidates(plane, probe, frame, searchAt(left), { first, step: spacing.row, floor, basePenalty: NeighbourPlacer.RANK_PENALTY * rank + (onTop ? RowChooser.TOP_ROW : 0), anchor, descend: event.bounds.center.x }));
    if (host && onTop) {
      cands.push(...lefts.flatMap((left, rank) => this.rows.rowsAbove(plane, probe, frame, searchAt(left), { anchor: event, start: host.bounds.center.y - spacing.row, step: spacing.row, penalty: NeighbourPlacer.RANK_PENALTY * rank })));
    } else if (host) {
      cands.push(...this.boundaries.topCandidates(plane, id, probe, event, host, frame, searchAt(0)));
    }
    this.placeCand(spot, this.rows.cheapest(id, plane, event, kind, cands), event);
  }

  private placeOnRow(spot: Spot, main: DShape, preds: DShape[], successor: DShape | undefined, branchDrawn: boolean): void {
    const { plane, id, spacing, size, probe } = spot;
    const maxRight = Math.max(...preds.map((pred) => pred.bounds.right));
    const sameRow = !!successor && Math.abs(successor.bounds.center.y - main.bounds.center.y) <= spacing.rowTol;
    const onSuccessor = !!successor && (sameRow || branchDrawn || this.branchedBeforeTheBatch(main, id));
    const wanted = onSuccessor ? successor.bounds.center.y : main.bounds.center.y;
    const ownRow = onSuccessor && !!probe.laneId && successor.laneId !== probe.laneId;
    const reach = this.room.newReach(id, size);
    const gap = Math.max(spacing.gap, this.room.labelRoom(this.room.reachOf(main), reach));
    const successorGap = successor ? this.room.labelRoom(reach, this.room.reachOf(successor)) : 0;
    const left = maxRight + gap;
    const center = this.rows.intoOwnLane(plane, probe, left, wanted, size, successor ? [Math.round(successor.bounds.center.y)] : [], ownRow ? undefined : main);
    const box = new Box(left, center - size.height / 2, size.width, size.height);
    this.clearRow(spot, main, preds, successor, { center, box, gap, successorGap, maxRight });
    this.state.placeAt(plane, id, left, center, size);
    if (!successor) {
      this.state.continued.add(id);
    }
  }

  private branchedBeforeTheBatch(main: DShape, id: string): boolean {
    return Semantics.sequenceFlows(this.state.semantics.byId.get(main.id), 'outgoing').some((flow) => flow.peek<BpmnElement>('targetRef')?.peek<string>('id') !== id && this.state.oldTarget.has(flow.peek<string>('id') ?? ''));
  }

  private clearRow({ plane, id, spacing, size, probe, frame, exclude }: Spot, main: DShape, preds: DShape[], successor: DShape | undefined, place: RowPlace): void {
    const { box, center, gap, successorGap, maxRight } = place;
    const blockers = this.obstacles.of(plane, frame, exclude);
    const clearOfSuccessor = !successor || Math.abs(successor.bounds.center.y - center) > size.height / 2 + successor.bounds.height / 2 || successor.bounds.x >= box.right + Math.max(Math.min(spacing.gap, NeighbourPlacer.MAX_SUCCESSOR_GAP), successorGap);
    if (this.obstacles.isFree(box, blockers) && clearOfSuccessor) {
      return;
    }
    const wantedGap = Math.max(spacing.gap, successorGap);
    const full = size.width + gap + wantedGap - spacing.gap;
    const delta = Math.min(full, this.room.localShift(plane, box, maxRight + 1, blockers, successor, wantedGap) ?? full);
    if (successor && this.successorStaysBehind(successor, preds, maxRight)) {
      const fixed = new Set(preds.flatMap((pred) => [pred.id, ...plane.boundariesOf(pred.id).map((boundary) => boundary.id)]));
      this.room.push(plane, main, probe, { id, box, line: successor.bounds.x - 0.5, delta: Math.max(delta, Math.ceil(box.right + wantedGap - successor.bounds.x)), successor, fixed });
    } else {
      this.room.push(plane, main, probe, { id, box, line: maxRight + 1, delta, successor });
    }
  }

  private successorStaysBehind(successor: DShape, preds: DShape[], maxRight: number): boolean {
    return successor.bounds.x < maxRight + 1 && preds.some((pred) => successor.bounds.x >= pred.bounds.right) && !preds.some((pred) => this.state.leadsTo(successor.id, pred.id));
  }

  private placeOnBranch(spot: Spot, main: DShape, drawnSuccessors: DShape[], pending: ReadonlySet<string>): void {
    const { plane, id, spacing, size, probe, frame, exclude, kind } = spot;
    const left = main.bounds.right + spacing.gap;
    const middle = main.bounds.center.y;
    const frames = new Frames(plane);
    const below = drawnSuccessors.filter((shape) => shape.bounds.center.y >= middle - spacing.rowTol && frames.of(shape) === frame);
    const belowCentres = below.map((shape) => shape.bounds.center.y);
    const base = Math.max(middle, ...belowCentres);
    const floor = Math.max(main.bounds.bottom, ...belowCentres);
    const search = { left, size, extent: this.chain.extent(id, pending, spacing.gap), exclude };
    const cands = this.rows.rowCandidates(plane, probe, frame, search, { first: base + spacing.row, step: spacing.row, floor, anchor: main, descend: main.bounds.center.x });
    if (!drawnSuccessors.some((shape) => shape.bounds.center.y < middle - spacing.rowTol && frames.of(shape) === frame)) {
      cands.push(...this.rows.rowsAbove(plane, probe, frame, search, { anchor: main, start: middle - spacing.row, step: spacing.row, penalty: RowChooser.TOP_ROW }));
    }
    this.placeCand(spot, this.rows.cheapest(id, plane, main, kind, cands), main);
  }
}
