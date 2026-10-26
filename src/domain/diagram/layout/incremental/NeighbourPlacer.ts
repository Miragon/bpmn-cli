import { LayoutDebug } from '../LayoutDebug.js';
import { SIZES } from '../../utils/sizes.js';
import { is } from '../../../document/utils/moddle.js';
import { bottom, cx, cy, overlaps, right, type Box } from '../../utils/geom.js';
import { defaultLabelSide, hasExternalLabel, labelSideOf } from '../../utils/labels.js';
import { idOf, raw } from '../../utils/raw.js';
import { DiagramReader } from '../../di/DiagramReader.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import { Semantics } from '../../di/Semantics.js';

import type { DShape, Plane } from '../../di/types.js';
import { attachedSide } from '../../utils/sides.js';
import { labelSize } from '../../utils/text.js';
import type { NodePlacer, Probe } from './NodePlacer.js';
import type { PlacementObstacles } from './PlacementObstacles.js';
import { TOP_ROW, type Cand, type RowChooser } from './RowChooser.js';
import type { BoundaryPlacer } from './BoundaryPlacer.js';

/** What a label above or below its shape reaches out beyond the shape's left and right edge. */
interface LabelReach {
  side: 'above' | 'below';
  left: number;
  right: number;
}

/**
 * A flow node next to its placed neighbours: spliced into a flow, continuing its anchor's row, a
 * new branch or exception path on the cheapest row, left of its successor, or (unconnected)
 * below its frame's content.
 */
export class NeighbourPlacer {
  constructor(
    private readonly placer: NodePlacer,
    private readonly obstacles: PlacementObstacles,
    private readonly rows: RowChooser,
    private readonly boundaries: BoundaryPlacer,
  ) {}

  /**
   * Places at a chosen candidate, opening its row (or seating the event on top) first.
   * The event is seated after the room was made.
   */
  private placeCand(plane: Plane, id: string, probe: Probe, cand: Cand, anchor: DShape): void {
    if (cand.insert) {
      const { line, delta, within, frame } = cand.insert;
      this.placer.recordSpace(this.placer.drawing(plane).makeSpace({ axis: 'y', line, delta, anchors: [anchor.id, probe.parentId], ...(within ? { within } : {}), ...(frame ? { frame } : {}) }));
    }
    if (cand.top) this.boundaries.seatOnTop(plane, anchor, cand.top);
    this.placer.placeAt(plane, id, cand.x, this.rows.intoOwnLane(plane, probe, cand.x, cand.centre, cand.size, [], anchor), cand.size);
  }

  /**
   * Room the new nodes that follow `id` in a simple chain need on its row. A node without any
   * successor yet keeps room for one event: the next command mostly ends its branch there, so a
   * batch and the same ops as single commands choose the same row.
   */
  private chainExtent(plane: Plane, id: string, pending: ReadonlySet<string>, gap: number): number {
    if (!this.placer.sem.successors(id).length && !is(this.placer.sem.byId.get(id), 'bpmn:EndEvent')) return SIZES.event.width + gap;
    let extent = 0;
    let cur = id;
    for (let step = 0; step < 4; step++) {
      const next = this.placer.sem.successors(cur).filter((successor) => pending.has(successor) && successor !== id);
      if (next.length !== 1) break;
      cur = next[0]!;
      extent += this.placer.sizeFor(plane, cur).width + gap;
    }
    return extent;
  }

  /**
   * The successor S a node is spliced before (the flow into it ended at S before the ops), also
   * through a chain of new nodes, branches included; a new branch that never reaches S is none.
   * Inside the chain the predecessor was spliced before S in this run, and S still follows.
   */
  private spliceTarget(plane: Plane, id: string, pred: string): string | undefined {
    const el = this.placer.sem.byId.get(id);
    const join = this.placer.joins?.get(id);
    if (join) return join;
    const before = this.placer.placed.has(pred) ? this.placer.spliced?.get(pred) : undefined;
    if (before && before !== id && this.chainReaches(plane, id, before)) return before;
    const succ = new Set(this.placer.sem.successors(id));
    for (const flow of Semantics.sequenceFlows(el, 'incoming')) {
      const fid = idOf(flow);
      if (!fid || idOf(raw(flow, 'sourceRef')) !== pred) continue;
      const old = this.placer.oldTarget.get(fid);
      if (old && old !== id && (succ.has(old) || this.chainReaches(plane, id, old))) return old;
    }
    for (const flow of Semantics.sequenceFlows(el, 'outgoing')) {
      const fid = idOf(flow);
      const target = idOf(raw(flow, 'targetRef'));
      if (!fid || !target) continue;
      const old = this.placer.oldSource.get(fid);
      if (old === pred) return target;
    }
    return undefined;
  }

  /** Whether `target` follows `id` through nodes new in this run, all branches (at most 50). */
  private chainReaches(plane: Plane, id: string, target: string): boolean {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length && seen.size <= 50) {
      for (const successor of this.placer.sem.successors(queue.shift()!)) {
        if (successor === target) return true;
        if (seen.has(successor) || (plane.shapes.has(successor) && !this.placer.placed.has(successor))) continue;
        seen.add(successor);
        queue.push(successor);
      }
    }
    return false;
  }

  /**
   * How far the space tool at `line` has to push for `box` when part of the room is free already:
   * what is in the way must end right of it, `S` one gap further. Undefined when something in the
   * way starts before the line: the caller makes a full column of room.
   */
  private localShift(plane: Plane, box: Box, line: number, obs: { boxes: Box[]; labels: Box[] }, successor: DShape | undefined, gap: number): number | undefined {
    let need = 0;
    const clear = (obstacle: Box, room: number): boolean => {
      if (!overlaps(obstacle, box, room)) return true;
      if (obstacle.x < line) return false;
      need = Math.max(need, right(box) + room - obstacle.x);
      return true;
    };
    for (const obstacle of obs.boxes) if (!clear(obstacle, 20)) return undefined;
    for (const label of obs.labels) if (!clear(label, 4)) return undefined;
    for (const edge of plane.edges.values()) {
      for (const point of edge.points.slice(1, -1)) if (!clear({ x: point.x, y: point.y, width: 0, height: 0 }, 10)) return undefined;
    }
    if (successor && successor.bounds.x >= line && Math.abs(cy(successor.bounds) - cy(box)) <= box.height / 2 + successor.bounds.height / 2) need = Math.max(need, right(box) + gap - successor.bounds.x);
    return Math.ceil(need);
  }

  /** The reach of a drawn shape's label (undefined: none, or beside or on the shape). */
  private reachOf(shape: DShape): LabelReach | undefined {
    const side = labelSideOf(shape);
    if (!shape.label || (side !== 'above' && side !== 'below')) return undefined;
    return { side, left: shape.bounds.x - shape.label.x, right: right(shape.label) - right(shape.bounds) };
  }

  /** The reach of the label a new node gets on its default side (undefined: no external label). */
  private newReach(id: string, size: { width: number; height: number }): LabelReach | undefined {
    const el = this.placer.sem.byId.get(id);
    const kind = el ? DiagramReader.shapeKind(el) : undefined;
    const name = raw<string>(el, 'name')?.trim();
    if (!kind || !name || kind === 'boundary' || !hasExternalLabel({ kind })) return undefined;
    const side = defaultLabelSide(kind);
    const over = (labelSize(name).width - size.width) / 2;
    return side === 'above' || side === 'below' ? { side, left: over, right: over } : undefined;
  }

  /** The gap two neighbours on a row need so that their labels on one side keep 4 px apart. */
  private labelRoom(leftReach: LabelReach | undefined, rightReach: LabelReach | undefined): number {
    return leftReach && rightReach && leftReach.side === rightReach.side ? Math.ceil(Math.max(0, leftReach.right) + Math.max(0, rightReach.left) + 4) : 0;
  }

  /**
   * A splice or continuation goes on the anchor's row, or S's; when S's row lies in another lane
   * than the node's own the row follows the node's lane (audit #14). Gaps grow so labels of
   * neighbours on one side (events below, gateways above) keep apart. A new branch takes the
   * cheapest free row below the anchor's branches in its own frame (one into another lane does not
   * count), or a row above an anchor without a branch above, which wins only when every row below
   * crosses.
   */
  placeAfter(plane: Plane, id: string, preds: DShape[], pending: ReadonlySet<string>): void {
    const sp = this.placer.spacingFor(plane);
    const size = this.placer.sizeFor(plane, id);
    const probe = this.placer.probeOf(plane, id);
    const frame = Frames.of(plane, probe);
    const main = preds[0]!;
    const exclude = new Set([id, ...this.obstacles.homeGroups(plane, [main, main.hostId ? plane.shapes.get(main.hostId) : undefined])]);
    const kind = DiagramReader.shapeKind(this.placer.sem.byId.get(id)!);
    if (main.kind === 'boundary') {
      const host = main.hostId ? plane.shapes.get(main.hostId) : undefined;
      const anchor = host ?? main;
      const extent = this.chainExtent(plane, id, pending, sp.gap);
      const start = cy(anchor.bounds) + sp.row;
      const xs = [right(anchor.bounds) + sp.gap, Math.round(cx(main.bounds) - size.width / 2)];
      /**
       * an event on the top border: its path runs above the host (rows below cost TOP_ROW more),
       * and the host's own row is never in the way of a row below it
       */
      const onTop = !!host && attachedSide(main.bounds, host.bounds) === 'top';
      const floor = Math.max(bottom(main.bounds), host ? bottom(host.bounds) : -Infinity);
      const cands = xs.flatMap((left, xi) => this.rows.rowCandidates(plane, probe, frame, left, size, extent, start, sp.row, floor, exclude, 40 * xi + (onTop ? TOP_ROW : 0), anchor, cx(main.bounds)));
      if (host && onTop) cands.push(...xs.flatMap((left, xi) => this.rows.rowsAbove(plane, probe, frame, main, left, size, extent, cy(host.bounds) - sp.row, sp.row, exclude, 40 * xi)));
      else if (host) cands.push(...this.boundaries.topCandidates(plane, id, probe, main, host, frame, size, extent, exclude));
      this.placeCand(plane, id, probe, this.rows.cheapest(id, plane, main, kind, cands), main);
      return;
    }
    const succShapes = this.placer.sem.successors(main.id)
      .filter((successor) => successor !== id && plane.shapes.has(successor))
      .map((successor) => plane.shapes.get(successor)!);
    const spliced = this.spliceTarget(plane, id, main.id);
    const successor = spliced ? plane.shapes.get(spliced) : undefined;
    if (successor) (this.placer.spliced ??= new Map()).set(id, successor.id);
    const maxRight = Math.max(...preds.map((predecessor) => right(predecessor.bounds)));
    if (successor || !succShapes.length) {
      const sameRow = successor && Math.abs(cy(successor.bounds) - cy(main.bounds)) <= sp.rowTol;
      /**
       * a branching anchor: another branch is drawn, or was drawn before the ops and leads to a
       * node a later op of the batch spliced into it (a single command would see it drawn)
       */
      const branching = succShapes.length > 0 || Semantics.sequenceFlows(this.placer.sem.byId.get(main.id), 'outgoing').some((flow) => idOf(raw(flow, 'targetRef')) !== id && this.placer.oldTarget.has(idOf(flow) ?? ''));
      const onS = !!successor && (sameRow || branching);
      let center = onS ? cy(successor.bounds) : cy(main.bounds);
      const ownRow = !!successor && onS && !!probe.laneId && successor.laneId !== probe.laneId;
      const reach = this.newReach(id, size);
      const gap = Math.max(sp.gap, this.labelRoom(this.reachOf(main), reach));
      const sGap = successor ? this.labelRoom(reach, this.reachOf(successor)) : 0;
      center = this.rows.intoOwnLane(plane, probe, maxRight + gap, center, size, successor ? [Math.round(cy(successor.bounds))] : [], ownRow ? undefined : main);
      const left = maxRight + gap;
      const box = { x: left, y: center - size.height / 2, ...size };
      const blockers = this.obstacles.of(plane, frame, exclude);
      const succRoom = !successor || Math.abs(cy(successor.bounds) - center) > size.height / 2 + successor.bounds.height / 2 || successor.bounds.x >= right(box) + Math.max(Math.min(sp.gap, 40), sGap);
      if (!this.obstacles.isFree(box, blockers) || !succRoom) {
        const full = size.width + gap + Math.max(sp.gap, sGap) - sp.gap;
        const delta = Math.min(full, this.localShift(plane, box, maxRight + 1, blockers, successor, Math.max(sp.gap, sGap)) ?? full);
        this.placer.recordSpace(this.placer.drawing(plane).makeSpace({ axis: 'x', line: maxRight + 1, delta, anchors: [main.id, probe.parentId], ...this.obstacles.spaceBand(plane, probe, main) }));
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[place] ${id} after ${main.id}: ${successor ? `splice before ${successor.id}` : 'continuation'} at x=${left} c=${center}`);
      this.placer.placeAt(plane, id, left, center, size);
      if (!successor) (this.placer.continued ??= new Set()).add(id);
      return;
    }
    const left = right(main.bounds) + sp.gap;
    const below = succShapes.filter((shape) => cy(shape.bounds) >= cy(main.bounds) - sp.rowTol && Frames.of(plane, shape) === frame);
    const base = Math.max(cy(main.bounds), ...below.map((shape) => cy(shape.bounds)));
    const floor = Math.max(bottom(main.bounds), ...below.map((shape) => cy(shape.bounds)));
    const extent = this.chainExtent(plane, id, pending, sp.gap);
    const cands = this.rows.rowCandidates(plane, probe, frame, left, size, extent, base + sp.row, sp.row, floor, exclude, 0, main, cx(main.bounds));
    if (!succShapes.some((shape) => cy(shape.bounds) < cy(main.bounds) - sp.rowTol && Frames.of(plane, shape) === frame)) cands.push(...this.rows.rowsAbove(plane, probe, frame, main, left, size, extent, cy(main.bounds) - sp.row, sp.row, exclude, TOP_ROW));
    this.placeCand(plane, id, probe, this.rows.cheapest(id, plane, main, kind, cands), main);
  }

  placeBefore(plane: Plane, id: string, succ: DShape): void {
    const sp = this.placer.spacingFor(plane);
    const size = this.placer.sizeFor(plane, id);
    const probe = this.placer.probeOf(plane, id);
    const frame = Frames.of(plane, probe);
    const exclude = new Set([id, ...this.obstacles.homeGroups(plane, [succ])]);
    const inner = frame ? Frames.interior(frame, 10) : undefined;
    const left = succ.bounds.x - sp.gap - size.width;
    const obs = this.obstacles.of(plane, frame, exclude);
    if (!inner || left >= inner.x) {
      for (let rowStep = 0; rowStep < 3; rowStep++) {
        const center = cy(succ.bounds) + rowStep * sp.row;
        const box = { x: left, y: center - size.height / 2, ...size };
        if (this.obstacles.isFree(box, obs)) {
          this.placer.placeAt(plane, id, left, this.rows.intoOwnLane(plane, probe, left, center, size, [], succ), size);
          return;
        }
      }
    }
    this.placer.recordSpace(this.placer.drawing(plane).makeSpace({ axis: 'x', line: succ.bounds.x - 0.5, delta: size.width + sp.gap, anchors: [succ.id, probe.parentId], ...this.obstacles.spaceBand(plane, probe, succ) }));
    const center = this.rows.intoOwnLane(plane, probe, succ.bounds.x - sp.gap - size.width, cy(succ.bounds), size, [], succ);
    this.placer.placeAt(plane, id, succ.bounds.x - sp.gap - size.width, center, size);
  }

  /** Below the content of the node's frame, at the frame's first column. */
  placeUnconnected(plane: Plane, id: string): DShape {
    const sp = this.placer.spacingFor(plane);
    const size = this.placer.sizeFor(plane, id);
    const probe = this.placer.probeOf(plane, id);
    const frame = Frames.of(plane, probe);
    const exclude = new Set([id]);
    const members = [...plane.shapes.values()].filter((shape) => shape.id !== id && PlaneQuery.isLeaf(shape) && shape.kind !== 'boundary' && shape.kind !== 'annotation' && shape.kind !== 'data' && this.obstacles.within(plane, shape, frame) && shape !== frame);
    const inner = frame ? Frames.interior(frame, frame.kind === 'subProcess' ? 20 : 15) : undefined;
    let left: number;
    let center: number;
    if (members.length) {
      left = Math.min(...members.map((shape) => shape.bounds.x));
      const below = this.obstacles.contentBottom(plane, frame, exclude) ?? Math.max(...members.map((shape) => bottom(shape.bounds)));
      center = below + Math.max(30, sp.row - 80) + size.height / 2;
      center = this.rows.freeRows(plane, frame, left, size.width, size.height, center, sp.row / 2, exclude, 1)[0]!.centre;
    } else if (inner) {
      left = inner.x + (frame!.kind === 'subProcess' ? 10 : 20);
      center = frame!.kind === 'subProcess' ? inner.y + 20 + size.height / 2 : cy(inner);
    } else {
      const all = [...plane.shapes.values()].filter((shape) => shape.id !== id);
      const box = all.length ? all.reduce((extremes, shape) => ({ x: Math.min(extremes.x, shape.bounds.x), y: Math.max(extremes.y, bottom(shape.bounds)) }), { x: Infinity, y: -Infinity }) : { x: 160, y: 40 };
      left = Number.isFinite(box.x) ? box.x : 160;
      center = (Number.isFinite(box.y) ? box.y : 40) + 60 + size.height / 2;
    }
    return this.placer.placeAt(plane, id, left, center, size);
  }
}
