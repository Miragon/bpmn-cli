import { many, type El, idOf } from '../../model/utils/moddle.js';
import { METRICS, SIZES } from '../../diagram/utils/sizes.js';
import type { GEdge, GNode, LaneBox, Point, ScopeLayout } from '../../diagram/types.js';
import { ArtifactPlacer } from './ArtifactPlacer.js';
import { ChainLiftTrial } from './ChainLiftTrial.js';
import { EdgeRouter } from './EdgeRouter.js';
import { JoinColumnTrial } from './JoinColumnTrial.js';
import { LinkRouter } from './LinkRouter.js';
import { DATA_ROW_EXTRA, ScopeGrid } from './ScopeGrid.js';
import { ScopeLabels } from './ScopeLabels.js';
import { TopBorderTrial } from './TopBorderTrial.js';
import { growToFit, shiftNode } from './utils/scope.js';

interface LaneBand {
  el: El;
  id: string;
  nodes: GNode[];
  subs: GNode[];
  children: LaneBand[];
  y: number;
  height: number;
}

/** How close a loop inside a lane may come to the lane's top or bottom border. */
const CHANNEL_KEEP = METRICS.loopGap / 2;

/**
 * Re-arranges a scope's rows into lane bands (leaf lanes in declaration order) and lays it out
 * again inside them: nodes keep their column, artifacts stay with their node, loops stay inside
 * their lane. Runs the join, chain-lift and top-border trials on the rows by lane.
 */
export class LaneArranger {
  private leaves: LaneBand[] = [];

  constructor(
    private readonly scope: ScopeLayout,
    private readonly process: El,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  apply(): void {
    const { scope, process, groups } = this;
    const laneSets = many(process, 'laneSets');
    if (!laneSets.length) return;
    const byId = new Map(scope.nodes.map((n) => [n.id, n]));
    const subsById = new Map(scope.eventSubs.map((n) => [n.id, n]));
    const build = (laneSet: El): LaneBand[] =>
      many(laneSet, 'lanes').map((lane) => {
        const child = lane.get<El | undefined>('childLaneSet');
        const band: LaneBand = { el: lane, id: idOf(lane), nodes: [], subs: [], children: child ? build(child) : [], y: 0, height: 0 };
        if (!band.children.length) {
          for (const ref of lane.get<El[] | undefined>('flowNodeRef') ?? []) {
            const n = byId.get(idOf(ref));
            if (n) band.nodes.push(n);
            const sub = subsById.get(idOf(ref));
            if (sub) band.subs.push(sub);
          }
        }
        return band;
      });
    const top = build(laneSets[0]!);
    const leaves: LaneBand[] = [];
    const collect = (b: LaneBand): void => (b.children.length ? b.children.forEach(collect) : void leaves.push(b));
    top.forEach(collect);
    if (!leaves.length) return;
    this.leaves = leaves;
    // nodes not in any lane go to the first lane
    const assigned = new Set(leaves.flatMap((l) => l.nodes));
    for (const n of scope.nodes) if (!assigned.has(n)) leaves[0]!.nodes.push(n);

    const dataRow = new Set(scope.artifacts.filter((a) => a.kind !== 'annotation' && a.anchorNode).map((a) => a.anchorNode!));
    const arrange = (): void => {
      let y = 0;
      for (const lane of leaves) {
        const rows = [...new Set(lane.nodes.map((n) => n.row))].sort((a, b) => a - b);
        let rowY = y + SIZES.lanePadding;
        rows.forEach((r) => {
          const inRow = lane.nodes.filter((n) => n.row === r);
          const rh = Math.max(0, ...inRow.map((n) => n.height + ScopeGrid.boundaryExtra(n)));
          for (const n of inRow) shiftNode(n, 0, Math.round(rowY + rh / 2 - n.height / 2 - n.box.y));
          rowY += rh + METRICS.vGap + (inRow.some((n) => dataRow.has(n)) ? DATA_ROW_EXTRA : 0);
        });
        const content = rows.length ? rowY - METRICS.vGap - (y + SIZES.lanePadding) : 0;
        lane.y = y;
        lane.height = Math.max(60 + 2 * SIZES.lanePadding, content + 2 * SIZES.lanePadding);
        y += lane.height;
      }
      scope.height = y;
      new ArtifactPlacer(scope).placeAttached();
      scope.laneBands = leaves.map((l) => ({ nodes: new Set(l.nodes), top: l.y, bottom: l.y + l.height }));
    };
    arrange();
    /**
     * Empty bands keep the offset ScopePlacer's passes gave them (a loop over the top, a strip for
     * notes moved the content down), which ScopeGrid's y lacks.
     */
    const band = scope.edges.find((e) => e.bandY !== undefined);
    const drawnBandY = band?.bandY;
    let bandShift: number | undefined;
    const grid = new ScopeGrid(scope, groups);
    new JoinColumnTrial(scope, (shifts) => {
      if (bandShift === undefined) {
        grid.arrange();
        bandShift = band?.bandY !== undefined && drawnBandY !== undefined ? drawnBandY - band.bandY : 0;
      }
      grid.arrange(shifts);
      for (const e of scope.edges) if (e.bandY !== undefined) e.bandY += bandShift;
      arrange();
    }).run();
    new ChainLiftTrial(scope, arrange).run();
    new TopBorderTrial(scope).run();
    // undoing a trial puts back the scope's lane bands, not these
    leaves.forEach((l, i) => {
      const b = scope.laneBands![i]!;
      l.y = b.top;
      l.height = b.bottom - b.top;
    });
    const ref = scope.nodes[0];
    const yOf = (): number => ref?.box.y ?? 0;
    // a loop drawn over the top (its label above y 0) moves the content down: the bands follow
    const beforeRouting = yOf();
    new EdgeRouter(scope).route();
    this.growFirstLane(yOf() - beforeRouting, true);
    this.fitLaneLoops();
    // annotations may open a strip above the content too
    const beforeNotes = yOf();
    new ArtifactPlacer(scope).placeAnnotations();
    this.growFirstLane(yOf() - beforeNotes, false);
    new LinkRouter(scope).route();
    growToFit(scope);
    // event sub-processes of the last lane or of none go below everything
    const last = leaves[leaves.length - 1]!;
    for (const lane of leaves) if (lane !== last && lane.subs.length) this.placeLaneEventSubs(lane);
    const placed = new Set(leaves.filter((l) => l !== last).flatMap((l) => l.subs));
    let extraY = last.y + last.height - SIZES.lanePadding;
    for (const es of scope.eventSubs.filter((e) => !placed.has(e))) {
      es.box.y = extraY + METRICS.vGap;
      extraY = es.box.y + es.box.height;
    }
    const labels = new ScopeLabels(scope);
    const contentBottom = Math.max(extraY, ...scope.nodes.map((n) => n.box.y + n.box.height), ...scope.artifacts.map((a) => a.box.y + a.box.height), ...scope.edges.flatMap((e) => e.points.map((p) => p.y)), ...labels.all().map((l) => l.y + l.height));
    if (contentBottom > last.y + last.height - SIZES.lanePadding) last.height = Math.round(contentBottom + SIZES.lanePadding - last.y);
    scope.height = last.y + last.height;
    const finalize = (b: LaneBand): void => {
      if (b.children.length) {
        b.children.forEach(finalize);
        b.y = b.children[0]!.y;
        const end = b.children[b.children.length - 1]!;
        b.height = end.y + end.height - b.y;
      }
    };
    top.forEach(finalize);
    const width = Math.max(scope.width, ...scope.artifacts.map((a) => a.box.x + a.box.width), ...scope.nodes.map((n) => n.box.x + n.box.width), ...scope.eventSubs.map((n) => n.box.x + n.box.width), ...labels.all().map((l) => l.x + l.width)) + 2 * SIZES.lanePadding;
    const depth = (bands: LaneBand[]): number => (bands.length ? 1 + Math.max(...bands.map((b) => depth(b.children))) : 0);
    const totalDepth = depth(top);
    const toBox = (b: LaneBand, level: number): LaneBox => ({
      el: b.el,
      id: b.id,
      box: { x: level * SIZES.laneHeader, y: b.y, width: width + (totalDepth - level) * SIZES.laneHeader, height: b.height },
      children: b.children.map((c) => toBox(c, level + 1)),
    });
    scope.lanes = top.map((b) => toBox(b, 0));
  }

  /**
   * The content moved down by `shift`: the first lane grows up over the strip, the others move
   * down. `bandsMoved`: EdgeRouter already shifted the scope's lane bands.
   */
  private growFirstLane(shift: number, bandsMoved: boolean): void {
    const { scope, leaves } = this;
    if (!shift) return;
    for (const l of leaves) l.y += shift;
    leaves[0]!.y -= shift;
    leaves[0]!.height += shift;
    const bands = scope.laneBands ?? [];
    if (!bandsMoved) {
      for (const b of bands) {
        b.top += shift;
        b.bottom += shift;
      }
    }
    if (bands[0]) bands[0].top -= shift;
  }

  /**
   * Moves everything at or below `cut` down by `dy`, except the edges in `keep`. Routes are
   * orthogonal, so a segment across the cut stays vertical.
   */
  private openStrip(cut: number, dy: number, keep: ReadonlySet<GEdge> = new Set()): void {
    const { scope, leaves } = this;
    const move = (p: Point): void => {
      if (p.y >= cut) p.y += dy;
    };
    for (const n of [...scope.nodes, ...scope.eventSubs]) if (n.box.y >= cut) shiftNode(n, 0, dy);
    for (const a of scope.artifacts) {
      if (a.box.y >= cut) a.box.y += dy;
      for (const link of a.links) link.points.forEach(move);
    }
    for (const e of scope.edges) {
      if (keep.has(e)) continue;
      e.points.forEach(move);
      if (e.label && e.label.y >= cut) e.label.y += dy;
    }
    for (const c of scope.compensations) c.points.forEach(move);
    for (const l of leaves) if (l.y >= cut) l.y += dy;
    scope.height += dy;
  }

  private stripX(cut: number, width: number): number {
    const crossing: number[] = [];
    for (const e of this.scope.edges) {
      for (let i = 0; i + 1 < e.points.length; i++) {
        const p = e.points[i]!, q = e.points[i + 1]!;
        if (p.x === q.x && Math.min(p.y, q.y) < cut && Math.max(p.y, q.y) > cut) crossing.push(p.x);
      }
    }
    const candidates = [0, ...crossing.map((x) => x + 20)].sort((a, b) => a - b);
    return candidates.find((x) => !crossing.some((c) => c > x - 20 && c < x + width + 20)) ?? 0;
  }

  /**
   * Grows each lane around the runs of its loops, boundary ways and their labels that the
   * router laid closer than CHANNEL_KEEP to its border: a channel runs loopGap off the rows,
   * which is the lane padding, so on the border.
   */
  private fitLaneLoops(): void {
    const { scope, leaves } = this;
    const bands = scope.laneBands ?? [];
    leaves.forEach((lane, k) => {
      const band = bands[k];
      if (!band) return;
      const inside = scope.edges.filter((e) => band.nodes.has(e.source.host ?? e.source) && band.nodes.has(e.target));
      const loops = inside.filter((e) => e.back || e.runsAbove);
      const runs = loops.flatMap((e) => e.points.filter((p, i) => i > 0 && e.points[i - 1]!.y === p.y).map((p) => p.y));
      const ups = scope.edges.filter((e) => e.runsBelow && band.nodes.has(e.source.host ?? e.source));
      const downs = ups.map((e) => e.points[1]!.y);
      if (!runs.length && !downs.length) return;
      const top = Math.min(...runs.map((y) => y - CHANNEL_KEEP), ...loops.flatMap((e) => (e.label ? [e.label.y] : [])));
      // a self loop's label below its run holds the lane open like the run does
      const low = Math.max(...[...runs, ...downs].map((y) => y + CHANNEL_KEEP), ...loops.flatMap((e) => (e.label ? [e.label.y + e.label.height] : [])));
      const above = Math.max(0, Math.ceil(lane.y - top));
      if (above) {
        // the lane's own flows move whole: a run over the top may lie in the lane before
        const cut = lane.y;
        this.openStrip(cut, above);
        for (const e of inside) {
          for (const p of e.points) if (p.y < cut) p.y += above;
          if (e.label && e.label.y < cut) e.label.y += above;
        }
        lane.y -= above;
        lane.height += above;
      }
      const bottom = lane.y + lane.height;
      const below = Math.ceil(low + above - bottom);
      if (below > 0 && k < leaves.length - 1) {
        this.openStrip(bottom, below, new Set([...inside, ...ups].filter((e) => e.points.every((p) => p.y < bottom + below))));
        lane.height += below;
      }
    });
    bands.forEach((b, k) => {
      b.top = leaves[k]!.y;
      b.bottom = leaves[k]!.y + leaves[k]!.height;
    });
  }

  /** Stacks them below the lane's content; the lane grows and the lanes below move down. */
  private placeLaneEventSubs(lane: LaneBand): void {
    const { scope } = this;
    const top = lane.y, bottom = lane.y + lane.height;
    const inBand = (y: number): boolean => y > top && y <= bottom;
    // a label starting on the bottom border is a loop label of the lane below
    const labelIn = (y: number): boolean => y >= top && y < bottom;
    let content = bottom - SIZES.lanePadding;
    for (const n of lane.nodes) content = Math.max(content, n.box.y + n.box.height, ...n.boundary.map((b) => b.box.y + b.box.height));
    for (const a of scope.artifacts) if (inBand(a.box.y + a.box.height / 2)) content = Math.max(content, a.box.y + a.box.height);
    for (const e of scope.edges) {
      for (const p of e.points) if (inBand(p.y)) content = Math.max(content, p.y);
      if (e.label && labelIn(e.label.y)) content = Math.max(content, e.label.y + e.label.height);
    }
    let y = content;
    const stack = lane.subs.map((es) => {
      const at = y + METRICS.vGap;
      y = at + es.height;
      return { es, at };
    });
    const dy = Math.max(0, Math.round(y + SIZES.lanePadding - bottom));
    const x = this.stripX(bottom, Math.max(...lane.subs.map((es) => es.width)));
    if (dy) this.openStrip(bottom, dy);
    lane.height += dy;
    for (const { es, at } of stack) {
      es.box = { x, y: Math.round(at), width: es.width, height: es.height };
      scope.width = Math.max(scope.width, x + es.width);
    }
  }
}
