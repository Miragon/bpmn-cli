import type { BpmnElement } from '../../model/index.js';
import { ReorderTarget, type OrderOperation } from '../../operations/index.js';
import type { Drawing } from '../incremental/Drawing.js';
import type { OperationBefore } from '../incremental/OperationBefore.js';
import type { DShape } from '../plane/DShape.js';
import type { Plane } from '../plane/Plane.js';
import type { DrawnDiagram } from './DrawnDiagram.js';

export class BandReordering {
  private static readonly MEMBER_PAD = 5;

  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: OrderOperation,
    private readonly before: OperationBefore,
    private readonly notes: string[],
  ) {}

  private static byTop(bands: readonly DShape[]): DShape[] {
    return [...bands].sort((one, other) => one.bounds.y - other.bounds.y);
  }

  private static inOrder(bands: readonly DShape[], byTop: readonly DShape[]): boolean {
    return bands.every((band, index) => band === byTop[index]);
  }

  private static isCarried({ kind, hostId, parentId }: DShape): boolean {
    return kind !== 'participant' && !hostId && !parentId;
  }

  private static idsOf(elements: readonly BpmnElement[]): string[] {
    return elements.map((element) => element.peek<string>('id') ?? '').filter(Boolean);
  }

  private static laneBandOf(shape: DShape, bands: readonly DShape[], subtrees: Map<DShape, Set<string>>, poolId: string | undefined): DShape | undefined {
    const { id, kind, laneId, bounds } = shape;
    if (kind === 'lane') {
      return bands.find((band) => band.id !== id && subtrees.get(band)!.has(id));
    }
    if (laneId) {
      return bands.find((band) => subtrees.get(band)!.has(laneId));
    }
    const { y } = bounds.center;
    return shape.poolId === poolId && !shape.container ? bands.find((band) => y >= band.bounds.y && y < band.bounds.bottom) : undefined;
  }

  private static moveBand(drawing: Drawing, band: DShape, members: readonly DShape[], dy: number): void {
    if (!dy) {
      return;
    }
    band.bounds.y += dy;
    for (const member of members) {
      if (member.kind === 'lane') {
        member.bounds.y += dy;
      } else {
        drawing.space.shiftShape(member.id, 0, dy);
      }
    }
  }

  private static growOverfullLanes(drawing: Drawing, bands: readonly DShape[], members: Map<DShape, DShape[]>): void {
    const { poolId } = bands[0]!;
    const pool = poolId ? drawing.plane.shapes.get(poolId) : undefined;
    for (const band of bands) {
      const nodes = members.get(band)!.filter((member) => member.kind !== 'lane');
      const over = Math.max(Number.NEGATIVE_INFINITY, ...nodes.map((node) => drawing.space.unitBox(node).bottom)) + BandReordering.MEMBER_PAD - band.bounds.bottom;
      if (over > 0.5) {
        drawing.space.makeSpace({ axis: 'y', line: band.bounds.bottom - 1, delta: Math.ceil(over), ...(pool ? { within: pool.bounds.copy() } : {}) });
      }
    }
  }

  private static poolBandOf({ poolId, bounds }: DShape, plane: Plane, bands: readonly DShape[]): DShape | undefined {
    if (poolId) {
      return plane.shapes.get(poolId);
    }
    const { x, y } = bounds.center;
    return bands.find((band) => y >= band.bounds.y && y <= band.bounds.bottom && x >= band.bounds.x && x <= band.bounds.right);
  }

  run(): string[] {
    return new ReorderTarget(this.diagram.document, this.operation).ordersPools() ? this.orderPools() : this.orderLanes();
  }

  private orderLanes(): string[] {
    const { document, planes } = this.diagram;
    const owner = document.tree.byId(this.operation.id);
    const laneSet = owner ? document.scopes.laneSetOf(owner) : undefined;
    const lanes = BandReordering.idsOf(laneSet?.list('lanes') ?? []);
    const plane = planes.find((candidate) => lanes.length > 0 && lanes.every((id) => candidate.shapes.has(id)));
    if (!plane) {
      if (planes.length) {
        this.notes.push('the lanes are not drawn: nothing to reorder in the diagram');
      }
      return [];
    }
    const bands = lanes.map((id) => plane.shapes.get(id)!);
    const byTop = BandReordering.byTop(bands);
    if (BandReordering.inOrder(bands, byTop)) {
      return [];
    }
    const members = this.laneMembers(plane, bands);
    const drawing = this.diagram.drawing(plane);
    let cursor = byTop[0]!.bounds.y;
    const moves = bands.map((band) => {
      const dy = cursor - band.bounds.y;
      cursor += band.bounds.height;
      return { band, dy };
    });
    for (const { band, dy } of moves) {
      BandReordering.moveBand(drawing, band, members.get(band)!, dy);
    }
    BandReordering.growOverfullLanes(drawing, bands, members);
    return drawing.settle(this.before);
  }

  private laneSubtree(laneId: string): Set<string> {
    const subtree = new Set([laneId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [child, parent] of this.diagram.semantics.laneParent) {
        if (subtree.has(parent) && !subtree.has(child)) {
          subtree.add(child);
          grew = true;
        }
      }
    }
    return subtree;
  }

  private laneMembers(plane: Plane, bands: readonly DShape[]): Map<DShape, DShape[]> {
    const subtrees = new Map(bands.map((band) => [band, this.laneSubtree(band.id)]));
    const { poolId } = bands[0]!;
    const members = new Map<DShape, DShape[]>(bands.map((band) => [band, []]));
    for (const shape of [...plane.shapes.values()].filter(BandReordering.isCarried)) {
      const band = BandReordering.laneBandOf(shape, bands, subtrees, poolId);
      if (band) {
        members.get(band)!.push(shape);
      }
    }
    return members;
  }

  private orderPools(): string[] {
    const { document, planes } = this.diagram;
    const collaboration = document.tree.byId(this.operation.id);
    const ids = BandReordering.idsOf(collaboration?.list('participants') ?? []);
    const plane = planes.find((candidate) => candidate.rootId === this.operation.id);
    const bands = plane ? ids.flatMap((id) => plane.shapes.get(id) ?? []) : [];
    if (!plane || bands.length < 2) {
      if (planes.length) {
        this.notes.push('fewer than two pools are drawn: nothing to reorder in the diagram');
      }
      return [];
    }
    const byTop = BandReordering.byTop(bands);
    if (BandReordering.inOrder(bands, byTop) || !this.stacked(byTop)) {
      return [];
    }
    const gaps = byTop.slice(1).map((band, index) => band.bounds.y - byTop[index]!.bounds.bottom);
    const members = this.poolMembers(plane, bands);
    const drawing = this.diagram.drawing(plane);
    let cursor = byTop[0]!.bounds.y;
    for (const [index, band] of bands.entries()) {
      const dy = cursor - band.bounds.y;
      cursor += band.bounds.height + (gaps[index] ?? 0);
      BandReordering.moveBand(drawing, band, members.get(band)!, dy);
    }
    return drawing.settle(this.before);
  }

  private stacked(byTop: readonly DShape[]): boolean {
    for (let index = 0; index + 1 < byTop.length; index++) {
      const upper = byTop[index]!;
      const lower = byTop[index + 1]!;
      if (lower.bounds.y < upper.bounds.bottom - 1) {
        this.notes.push(`the pools are not stacked top to bottom (${upper.id} and ${lower.id} share rows): the drawing keeps their places`);
        return false;
      }
    }
    return true;
  }

  private poolMembers(plane: Plane, bands: readonly DShape[]): Map<DShape, DShape[]> {
    const members = new Map<DShape, DShape[]>(bands.map((band) => [band, []]));
    for (const shape of [...plane.shapes.values()].filter(BandReordering.isCarried)) {
      const pool = BandReordering.poolBandOf(shape, plane, bands);
      if (pool) {
        members.get(pool)?.push(shape);
      }
    }
    return members;
  }
}
