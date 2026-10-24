import { LayoutDebug } from '../../shared/LayoutDebug.js';
import type { Box, GArtifact, GEdge, GNode, ScopeLayout } from '../../diagram/types.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { EdgeRouter, RISE_KEEP } from './EdgeRouter.js';
import { ScopeLabels } from './ScopeLabels.js';
import { XIndex } from './XIndex.js';
import { routedArtifacts } from './utils/scope.js';

/** How many columns a trial moves a node right at most. */
const MAX_JOIN_SHIFT = 3;

/** How many other nodes a trial moves with the node at most. */
const MAX_PUSHED = 4;

/**
 * Keeps the column under a node free between the node and the flows that
 * enter it from below (EdgeRouter.risesInto: a join's entries, a boundary
 * path's way into its handler in the lane or row above, any forward flow
 * from a source below), so that they rise straight into its bottom
 * (EdgeRouter.riseX: a join's bottom vertex), the node right above their line
 * (else they hook in from the column gap). What lies there (a node, a
 * boundary event, a data object or store, a note on a boundary event, or
 * the label of one of them, unless it moves with the node: the end of a
 * boundary path or of a dead-end branch, the task after a boundary event's
 * host, say) is not moved: it cannot go left of its predecessors, and right
 * of the column its incoming flow would cross the rise. The node moves right
 * instead, with what follows it: one column, and further while its column is
 * still taken (the blocking chain goes on), at most MAX_JOIN_SHIFT. The move
 * must draw better: the scope is routed both ways (EdgeRouter) and
 * the move is kept only when more flows then rise straight into the bottom
 * of the node they enter or fewer labels of shapes lie on a flow (a label
 * only in the way: the entries rise through it), and no more pairs of flows
 * cross, no more shapes are cut and no more such labels are run through (a
 * shape in an entry's own row, or a flow its run would cross, is in the way
 * in either column). When the move alone is not kept, or a flow that rose
 * straight no longer does, the nodes whose column it took (something is
 * there that was not, or it moved there: the end of the moved chain now
 * under a join, say) move right too, as far as they need (each at most
 * MAX_JOIN_SHIFT), and that is kept when it draws better, else the move
 * alone when that does. One node at a time, the joins first (a node entered
 * from below may then move under a join that is already where it goes),
 * else in the order of the nodes, each once (a later trial that takes its
 * column again moves it on as above). The chains, and so the happy path,
 * stay as without the moves (RowAssigner). `arrange` lays the scope out again with the nodes
 * moved (ScopeGrid and the attached artifacts; in a process with lanes the
 * rows by lane, the empty bands kept where the earlier passes moved them,
 * LaneArranger). A trial measures the routes the scope is then drawn
 * with: every routing for it starts from the state the scope came with
 * (EdgeRouter reads the tops its last run marked used) and leaves
 * the scope as it was. A move that is not kept is undone exactly
 * (ArrangementCheckpoint): the scope is left arranged as it came or as the last
 * kept move left it, not routed. Entries from above end on a join's left
 * vertex (EdgeRouter), so a top vertex needs no room; a boundary event's way
 * over the top (EdgeRouter) enters its target's top from a run above all
 * between them, so a node whose column only the entries the routes draw that
 * way would need is not moved (no trial).
 */
export class JoinColumnTrial extends ArrangementTrial {
  constructor(
    layout: ScopeLayout,
    private readonly arrange: (shifts: ReadonlyMap<GNode, number>) => void,
  ) {
    super(layout);
  }

  run(): void {
    const { layout, arrange } = this;
    const shifts = new Map<GNode, number>();
    const tried = new Set<GNode>();
    const route = (): Routes => this.routesOf();
    const show = (r: Routes): string => this.showRoutes(r);
    /** the routes of the current arrangement, once measured */
    let routed: Routes | undefined;
    /** the nodes whose column the current arrangement leaves taken, with what takes it (a kept move's from its trial) */
    let taken: Map<GNode, Array<GNode | undefined>> | undefined;
    for (;;) {
      const blocked = (taken ??= this.takenColumns());
      // the joins first: a node entered from below may then move under a join that is already where it goes
      const open = layout.nodes.filter((n) => blocked.has(n) && !tried.has(n));
      const j = open.find((n) => EdgeRouter.entriesFromBelow(n).length) ?? open[0];
      if (!j) break;
      tried.add(j);
      const before = routed ?? route();
      // an entry the routes draw over the top enters the node's top: the column below it is not taken for that one
      if (before.above.size && !this.takenColumns(before.above).has(j)) {
        if (LayoutDebug.on()) LayoutDebug.log(`[joins] ${j.id} stays: entered over the top`);
        routed = before;
        continue;
      }
      const checkpoint = new ArrangementCheckpoint(layout);
      const kept = new Map(shifts);
      const step = (n: GNode): number => (shifts.get(n) ?? 0) - (kept.get(n) ?? 0);
      const reset = (to: ReadonlyMap<GNode, number>): void => {
        shifts.clear();
        for (const [n, k] of to) shifts.set(n, k);
      };
      // more straight rises or fewer labels run through, or fewer crossings or cut shapes with as many rises, and nothing
      // worse; or fewer cut shapes, each paying for at most one more crossing, and no more labels run through
      const keeps = (r: Routes): boolean =>
        ((r.rises.size > before.rises.size || r.labels < before.labels || ((r.crossings < before.crossings || r.hits < before.hits) && r.rises.size >= before.rises.size)) && r.crossings <= before.crossings && r.hits <= before.hits && r.labels <= before.labels) ||
        (r.hits < before.hits && r.labels <= before.labels && r.crossings - before.crossings <= before.hits - r.hits);
      const xs = new Map(layout.nodes.map((n) => [n, n.box.x]));
      const dx = (n: GNode): number => n.box.x - xs.get(n)!;
      /** of the taken columns, those the trial took (something is there that was not, or moved there) that can move on, and the moved node's while it is taken */
      const took = (cols: ReadonlyMap<GNode, Array<GNode | undefined>>): GNode[] =>
        [...cols].filter(([n, owners]) => (n === j || owners.some((o) => !blocked.get(n)?.includes(o) || (!!o && dx(o) !== dx(n)))) && step(n) < MAX_JOIN_SHIFT).map(([n]) => n);
      // right until the column is free (the chain that blocks it may go on)
      let now: Map<GNode, Array<GNode | undefined>>;
      do {
        shifts.set(j, (shifts.get(j) ?? 0) + 1);
        arrange(shifts);
        now = this.takenColumns();
      } while (step(j) < MAX_JOIN_SHIFT && now.has(j));
      const alone = new Map(shifts);
      const first = took(now);
      /** takenColumns of the arrangement the trial is in (that of a kept trial is the next one's) */
      let last = now;
      /** what else moved with it in the trial and the routes that got, for the debug line */
      let others = '';
      let together: Routes | undefined;
      /** the nodes whose column the move took move right too, as far as they need; false when there are none */
      const push = (): boolean => {
        let next = first;
        for (let round = 0; next.length && round < 3 * MAX_JOIN_SHIFT; round++, next = took((last = this.takenColumns()))) {
          for (const n of next) shifts.set(n, (shifts.get(n) ?? 0) + 1);
          // a push that moves more than MAX_PUSHED other nodes is not tried (no such one draws better, each costs a routing)
          if ([...shifts.keys()].filter((n) => n !== j && step(n)).length > MAX_PUSHED) {
            if (round) back();
            else reset(alone);
            return false;
          }
          arrange(shifts);
        }
        if (LayoutDebug.on()) others = layout.nodes.filter((n) => n !== j && step(n)).map((n) => `${n.id} ${step(n)}`).join(', ');
        return [...shifts].some(([n, k]) => k !== alone.get(n));
      };
      const back = (): void => {
        reset(alone);
        arrange(shifts);
        last = now;
      };
      // with them first when the move takes the column of a node a flow rose straight into (the end of the moved chain
      // now under a join, say), else only when the move alone is not kept or a flow that rose straight no longer does;
      // the move alone when that is kept and they are not
      const breaks = first.some((n) => EdgeRouter.risesInto(n).some((e) => before.rises.has(e)));
      let after = before;
      let keep = false;
      if (breaks && push()) {
        after = together = route();
        keep = keeps(after);
        if (!keep) back();
      }
      if (!keep) {
        const single = route();
        after = single;
        keep = keeps(single);
        if ((!keep || [...before.rises].some((e) => !single.rises.has(e))) && !breaks && push()) {
          together = route();
          if (keeps(together)) {
            after = together;
            keep = true;
          } else back();
        }
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[joins] ${j.id} ${keep ? `moves ${step(j)} right` : 'stays'}: ${show(before)} -> ${show(after)}${together ? ` (with ${others}${after === together ? '' : `: ${show(together)}`})` : ''}`);
      if (keep) {
        routed = after;
        taken = last;
      } else {
        reset(kept);
        checkpoint.restore();
        routed = before;
      }
    }
  }

  /**
   * The nodes whose column is taken, each with the nodes that what lies there
   * moves with (undefined: an artifact of none): something that does not move
   * with the node (a node, a boundary event, a routed artifact or the label of
   * one of them) lies on the vertical line its flows from below rise on into
   * its bottom (EdgeRouter.risesInto, riseX), or closer to it than RISE_KEEP (a
   * gateway's vertex on it), between it and the lowest of them (`over`: flows
   * drawn over the top, which enter its top instead, not among them).
   */
  private takenColumns(over?: ReadonlySet<GEdge>): Map<GNode, Array<GNode | undefined>> {
    const { layout } = this;
    const out = new Map<GNode, Array<GNode | undefined>>();
    const entries = (n: GNode): GEdge[] => (over ? EdgeRouter.risesInto(n).filter((e) => !over.has(e)) : EdgeRouter.risesInto(n));
    const rising = layout.nodes.filter((n) => entries(n).length);
    if (!rising.length) return out;
    // each box with the node it moves with
    const index = new XIndex<[Box, GNode | undefined]>();
    const add = (b: Box, owner: GNode | undefined): void => index.add([b, owner], b.x, b.x + b.width);
    for (const n of layout.nodes) {
      add(n.box, n);
      for (const b of n.boundary) add(b.box, n);
    }
    const ownerOf = (a: GArtifact): GNode | undefined => a.anchorNode?.host ?? a.anchorNode;
    for (const a of routedArtifacts(layout)) add(a.box, ownerOf(a));
    const labels = new ScopeLabels(layout);
    for (const [b, n] of labels.ownShapes()) add(b, n);
    for (const [b, a] of labels.placedData()) add(b, ownerOf(a));
    for (const j of rising) {
      const x = EdgeRouter.riseX(j), top = j.box.y + j.box.height, low = Math.max(...entries(j).map(EdgeRouter.riseFrom));
      const owners = index.near(x - RISE_KEEP, x + RISE_KEEP).filter(([b, owner]) => owner !== j && b.x - RISE_KEEP < x && x < b.x + b.width + RISE_KEEP && b.y < low && top < b.y + b.height).map(([, owner]) => owner);
      if (owners.length) out.set(j, owners);
    }
    return out;
  }
}
