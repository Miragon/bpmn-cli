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
 * Moves a node right (with what follows it) when something blocks the column under it, so the
 * flows entering from below rise straight into its bottom. What blocks stays: left it cannot go,
 * right its own entry would cross the rise. A move is kept only when the routes draw better.
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
    let routed: Routes | undefined;
    let taken: Map<GNode, Array<GNode | undefined>> | undefined;
    for (;;) {
      const blocked = (taken ??= this.takenColumns());
      // joins first: a node entered from below may then move under a join already in place
      const open = layout.nodes.filter((n) => blocked.has(n) && !tried.has(n));
      const j = open.find((n) => EdgeRouter.entriesFromBelow(n).length) ?? open[0];
      if (!j) break;
      tried.add(j);
      const before = routed ?? route();
      // an entry drawn over the top enters the node's top and needs no column below
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
      /**
       * Better and nothing worse: more rises, fewer labels, or fewer crossings / cuts at as many
       * rises; or fewer cuts, each paying for at most one more crossing.
       */
      const keeps = (r: Routes): boolean =>
        ((r.rises.size > before.rises.size || r.labels < before.labels || ((r.crossings < before.crossings || r.hits < before.hits) && r.rises.size >= before.rises.size)) && r.crossings <= before.crossings && r.hits <= before.hits && r.labels <= before.labels) ||
        (r.hits < before.hits && r.labels <= before.labels && r.crossings - before.crossings <= before.hits - r.hits);
      const xs = new Map(layout.nodes.map((n) => [n, n.box.x]));
      const dx = (n: GNode): number => n.box.x - xs.get(n)!;
      /** The columns this trial took (something new or moved is there) whose nodes can move on. */
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
      // a kept trial's taken columns are the next trial's
      let last = now;
      let others = '';
      let together: Routes | undefined;
      /** The nodes whose column the move took move right too; false when there are none. */
      const push = (): boolean => {
        let next = first;
        for (let round = 0; next.length && round < 3 * MAX_JOIN_SHIFT; round++, next = took((last = this.takenColumns()))) {
          for (const n of next) shifts.set(n, (shifts.get(n) ?? 0) + 1);
          // larger pushes never drew better, and each costs a routing
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
      /**
       * Push the others first when the move breaks a straight rise; else only when the move alone
       * is not kept or loses a rise.
       */
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
   * Nodes with something within RISE_KEEP of their rise line, between them and their lowest
   * entry, mapped to the owners of what lies there. `over`: entries drawn over the top, ignored.
   */
  private takenColumns(over?: ReadonlySet<GEdge>): Map<GNode, Array<GNode | undefined>> {
    const { layout } = this;
    const out = new Map<GNode, Array<GNode | undefined>>();
    const entries = (n: GNode): GEdge[] => (over ? EdgeRouter.risesInto(n).filter((e) => !over.has(e)) : EdgeRouter.risesInto(n));
    const rising = layout.nodes.filter((n) => entries(n).length);
    if (!rising.length) return out;
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
