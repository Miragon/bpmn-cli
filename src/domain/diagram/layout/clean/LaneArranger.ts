import { cy } from '../../utils/geom.js';
import { many, type El, idOf } from '../../../document/utils/moddle.js';
import { METRICS, SIZES } from '../../utils/sizes.js';
import type { GEdge, GNode, LaneBox, Point, ScopeLayout } from '../../di/types.js';
import { ScopeArtifactPlacer } from './ScopeArtifactPlacer.js';
import { ChainLiftTrial } from './ChainLiftTrial.js';
import { ChannelRouter } from './ChannelRouter.js';
import { JoinColumnTrial } from './JoinColumnTrial.js';
import { LinkRouter } from './LinkRouter.js';
import { DATA_ROW_EXTRA, ScopeGrid } from './ScopeGrid.js';
import { ScopeLabels } from './ScopeLabels.js';
import { TopBorderTrial } from './TopBorderTrial.js';
import { growToFit, shiftNode } from '../../utils/scope.js';

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
    const byId = new Map(scope.nodes.map((node) => [node.id, node]));
    const subsById = new Map(scope.eventSubs.map((eventSub) => [eventSub.id, eventSub]));
    const build = (laneSet: El): LaneBand[] =>
      many(laneSet, 'lanes').map((lane) => {
        const child = lane.get<El | undefined>('childLaneSet');
        const band: LaneBand = { el: lane, id: idOf(lane), nodes: [], subs: [], children: child ? build(child) : [], y: 0, height: 0 };
        if (!band.children.length) {
          for (const ref of lane.get<El[] | undefined>('flowNodeRef') ?? []) {
            const node = byId.get(idOf(ref));
            if (node) band.nodes.push(node);
            const sub = subsById.get(idOf(ref));
            if (sub) band.subs.push(sub);
          }
        }
        return band;
      });
    const top = build(laneSets[0]!);
    const leaves: LaneBand[] = [];
    const collect = (laneBand: LaneBand): void => (laneBand.children.length ? laneBand.children.forEach(collect) : void leaves.push(laneBand));
    top.forEach(collect);
    if (!leaves.length) return;
    this.leaves = leaves;
    // nodes not in any lane go to the first lane
    const assigned = new Set(leaves.flatMap((lane) => lane.nodes));
    for (const node of scope.nodes) if (!assigned.has(node)) leaves[0]!.nodes.push(node);

    const dataRow = new Set(scope.artifacts.filter((artifact) => artifact.kind !== 'annotation' && artifact.anchorNode).map((artifact) => artifact.anchorNode!));
    const arrange = (): void => {
      let laneTop = 0;
      for (const lane of leaves) {
        const rows = [...new Set(lane.nodes.map((node) => node.row))].sort((first, second) => first - second);
        let rowY = laneTop + SIZES.lanePadding;
        rows.forEach((row) => {
          const inRow = lane.nodes.filter((node) => node.row === row);
          const rh = Math.max(0, ...inRow.map((node) => node.height + ScopeGrid.boundaryExtra(node)));
          for (const node of inRow) shiftNode(node, 0, Math.round(rowY + rh / 2 - node.height / 2 - node.box.y));
          rowY += rh + METRICS.vGap + (inRow.some((node) => dataRow.has(node)) ? DATA_ROW_EXTRA : 0);
        });
        const content = rows.length ? rowY - METRICS.vGap - (laneTop + SIZES.lanePadding) : 0;
        lane.y = laneTop;
        lane.height = Math.max(60 + 2 * SIZES.lanePadding, content + 2 * SIZES.lanePadding);
        laneTop += lane.height;
      }
      scope.height = laneTop;
      new ScopeArtifactPlacer(scope).placeAttached();
      scope.laneBands = leaves.map((lane) => ({ nodes: new Set(lane.nodes), top: lane.y, bottom: lane.y + lane.height }));
    };
    arrange();
    /**
     * Empty bands keep the offset ScopePlacer's passes gave them (a loop over the top, a strip for
     * notes moved the content down), which ScopeGrid's y lacks.
     */
    const band = scope.edges.find((edge) => edge.bandY !== undefined);
    const drawnBandY = band?.bandY;
    let bandShift: number | undefined;
    const grid = new ScopeGrid(scope, groups);
    new JoinColumnTrial(scope, (shifts) => {
      if (bandShift === undefined) {
        grid.arrange();
        bandShift = band?.bandY !== undefined && drawnBandY !== undefined ? drawnBandY - band.bandY : 0;
      }
      grid.arrange(shifts);
      for (const edge of scope.edges) if (edge.bandY !== undefined) edge.bandY += bandShift;
      arrange();
    }).run();
    new ChainLiftTrial(scope, arrange).run();
    new TopBorderTrial(scope).run();
    // undoing a trial puts back the scope's lane bands, not these
    leaves.forEach((lane, index) => {
      const laneBand = scope.laneBands![index]!;
      lane.y = laneBand.top;
      lane.height = laneBand.bottom - laneBand.top;
    });
    const ref = scope.nodes[0];
    const yOf = (): number => ref?.box.y ?? 0;
    // a loop drawn over the top (its label above y 0) moves the content down: the bands follow
    const beforeRouting = yOf();
    new ChannelRouter(scope).route();
    this.growFirstLane(yOf() - beforeRouting, true);
    this.fitLaneLoops();
    // annotations may open a strip above the content too
    const beforeNotes = yOf();
    new ScopeArtifactPlacer(scope).placeAnnotations();
    this.growFirstLane(yOf() - beforeNotes, false);
    new LinkRouter(scope).route();
    growToFit(scope);
    // event sub-processes of the last lane or of none go below everything
    const last = leaves[leaves.length - 1]!;
    for (const lane of leaves) if (lane !== last && lane.subs.length) this.placeLaneEventSubs(lane);
    const placed = new Set(leaves.filter((lane) => lane !== last).flatMap((lane) => lane.subs));
    let extraY = last.y + last.height - SIZES.lanePadding;
    for (const es of scope.eventSubs.filter((eventSub) => !placed.has(eventSub))) {
      es.box.y = extraY + METRICS.vGap;
      extraY = es.box.y + es.box.height;
    }
    const labels = new ScopeLabels(scope);
    const contentBottom = Math.max(extraY, ...scope.nodes.map((node) => node.box.y + node.box.height), ...scope.artifacts.map((artifact) => artifact.box.y + artifact.box.height), ...scope.edges.flatMap((edge) => edge.points.map((point) => point.y)), ...labels.all().map((label) => label.y + label.height));
    if (contentBottom > last.y + last.height - SIZES.lanePadding) last.height = Math.round(contentBottom + SIZES.lanePadding - last.y);
    scope.height = last.y + last.height;
    const finalize = (laneBand: LaneBand): void => {
      if (laneBand.children.length) {
        laneBand.children.forEach(finalize);
        laneBand.y = laneBand.children[0]!.y;
        const end = laneBand.children[laneBand.children.length - 1]!;
        laneBand.height = end.y + end.height - laneBand.y;
      }
    };
    top.forEach(finalize);
    const width = Math.max(scope.width, ...scope.artifacts.map((artifact) => artifact.box.x + artifact.box.width), ...scope.nodes.map((node) => node.box.x + node.box.width), ...scope.eventSubs.map((eventSub) => eventSub.box.x + eventSub.box.width), ...labels.all().map((label) => label.x + label.width)) + 2 * SIZES.lanePadding;
    const depth = (bands: LaneBand[]): number => (bands.length ? 1 + Math.max(...bands.map((laneBand) => depth(laneBand.children))) : 0);
    const totalDepth = depth(top);
    const toBox = (laneBand: LaneBand, level: number): LaneBox => ({
      el: laneBand.el,
      id: laneBand.id,
      box: { x: level * SIZES.laneHeader, y: laneBand.y, width: width + (totalDepth - level) * SIZES.laneHeader, height: laneBand.height },
      children: laneBand.children.map((child) => toBox(child, level + 1)),
    });
    scope.lanes = top.map((laneBand) => toBox(laneBand, 0));
  }

  /**
   * The content moved down by `shift`: the first lane grows up over the strip, the others move
   * down. `bandsMoved`: ChannelRouter already shifted the scope's lane bands.
   */
  private growFirstLane(shift: number, bandsMoved: boolean): void {
    const { scope, leaves } = this;
    if (!shift) return;
    for (const lane of leaves) lane.y += shift;
    leaves[0]!.y -= shift;
    leaves[0]!.height += shift;
    const bands = scope.laneBands ?? [];
    if (!bandsMoved) {
      for (const band of bands) {
        band.top += shift;
        band.bottom += shift;
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
    const move = (point: Point): void => {
      if (point.y >= cut) point.y += dy;
    };
    for (const node of [...scope.nodes, ...scope.eventSubs]) if (node.box.y >= cut) shiftNode(node, 0, dy);
    for (const artifact of scope.artifacts) {
      if (artifact.box.y >= cut) artifact.box.y += dy;
      for (const link of artifact.links) link.points.forEach(move);
    }
    for (const edge of scope.edges) {
      if (keep.has(edge)) continue;
      edge.points.forEach(move);
      if (edge.label && edge.label.y >= cut) edge.label.y += dy;
    }
    for (const compensation of scope.compensations) compensation.points.forEach(move);
    for (const lane of leaves) if (lane.y >= cut) lane.y += dy;
    scope.height += dy;
  }

  private stripX(cut: number, width: number): number {
    const crossing: number[] = [];
    for (const edge of this.scope.edges) {
      for (let index = 0; index + 1 < edge.points.length; index++) {
        const start = edge.points[index]!, end = edge.points[index + 1]!;
        if (start.x === end.x && Math.min(start.y, end.y) < cut && Math.max(start.y, end.y) > cut) crossing.push(start.x);
      }
    }
    const candidates = [0, ...crossing.map((left) => left + 20)].sort((first, second) => first - second);
    return candidates.find((left) => !crossing.some((crossingX) => crossingX > left - 20 && crossingX < left + width + 20)) ?? 0;
  }

  /**
   * Grows each lane around the runs of its loops, boundary ways and their labels that the
   * router laid closer than CHANNEL_KEEP to its border: a channel runs loopGap off the rows,
   * which is the lane padding, so on the border.
   */
  private fitLaneLoops(): void {
    const { scope, leaves } = this;
    const bands = scope.laneBands ?? [];
    leaves.forEach((lane, laneIndex) => {
      const band = bands[laneIndex];
      if (!band) return;
      const inside = scope.edges.filter((edge) => band.nodes.has(edge.source.host ?? edge.source) && band.nodes.has(edge.target));
      const loops = inside.filter((edge) => edge.back || edge.runsAbove);
      const runs = loops.flatMap((edge) => edge.points.filter((point, index) => index > 0 && edge.points[index - 1]!.y === point.y).map((point) => point.y));
      const ups = scope.edges.filter((edge) => edge.runsBelow && band.nodes.has(edge.source.host ?? edge.source));
      const downs = ups.map((edge) => edge.points[1]!.y);
      if (!runs.length && !downs.length) return;
      const top = Math.min(...runs.map((pointY) => pointY - CHANNEL_KEEP), ...loops.flatMap((edge) => (edge.label ? [edge.label.y] : [])));
      // a self loop's label below its run holds the lane open like the run does
      const low = Math.max(...[...runs, ...downs].map((pointY) => pointY + CHANNEL_KEEP), ...loops.flatMap((edge) => (edge.label ? [edge.label.y + edge.label.height] : [])));
      const above = Math.max(0, Math.ceil(lane.y - top));
      if (above) {
        // the lane's own flows move whole: a run over the top may lie in the lane before
        const cut = lane.y;
        this.openStrip(cut, above);
        for (const edge of inside) {
          for (const point of edge.points) if (point.y < cut) point.y += above;
          if (edge.label && edge.label.y < cut) edge.label.y += above;
        }
        lane.y -= above;
        lane.height += above;
      }
      const bottom = lane.y + lane.height;
      const below = Math.ceil(low + above - bottom);
      if (below > 0 && laneIndex < leaves.length - 1) {
        this.openStrip(bottom, below, new Set([...inside, ...ups].filter((edge) => edge.points.every((point) => point.y < bottom + below))));
        lane.height += below;
      }
    });
    bands.forEach((band, laneIndex) => {
      band.top = leaves[laneIndex]!.y;
      band.bottom = leaves[laneIndex]!.y + leaves[laneIndex]!.height;
    });
  }

  /** Stacks them below the lane's content; the lane grows and the lanes below move down. */
  private placeLaneEventSubs(lane: LaneBand): void {
    const { scope } = this;
    const top = lane.y, bottom = lane.y + lane.height;
    const inBand = (pointY: number): boolean => pointY > top && pointY <= bottom;
    // a label starting on the bottom border is a loop label of the lane below
    const labelIn = (pointY: number): boolean => pointY >= top && pointY < bottom;
    let content = bottom - SIZES.lanePadding;
    for (const node of lane.nodes) content = Math.max(content, node.box.y + node.box.height, ...node.boundary.map((event) => event.box.y + event.box.height));
    for (const artifact of scope.artifacts) if (inBand(cy(artifact.box))) content = Math.max(content, artifact.box.y + artifact.box.height);
    for (const edge of scope.edges) {
      for (const point of edge.points) if (inBand(point.y)) content = Math.max(content, point.y);
      if (edge.label && labelIn(edge.label.y)) content = Math.max(content, edge.label.y + edge.label.height);
    }
    let stackBottom = content;
    const stack = lane.subs.map((es) => {
      const at = stackBottom + METRICS.vGap;
      stackBottom = at + es.height;
      return { es, at };
    });
    const dy = Math.max(0, Math.round(stackBottom + SIZES.lanePadding - bottom));
    const left = this.stripX(bottom, Math.max(...lane.subs.map((es) => es.width)));
    if (dy) this.openStrip(bottom, dy);
    lane.height += dy;
    for (const { es, at } of stack) {
      es.box = { x: left, y: Math.round(at), width: es.width, height: es.height };
      scope.width = Math.max(scope.width, left + es.width);
    }
  }
}
