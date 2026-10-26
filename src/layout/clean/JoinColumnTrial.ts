import { LayoutDebug } from '../LayoutDebug.js';
import type { Box, GArtifact, GEdge, GNode, ScopeLayout } from '../../drawing/types.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { ChannelRouter, RISE_KEEP } from './ChannelRouter.js';
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
    const show = (candidateRoutes: Routes): string => this.showRoutes(candidateRoutes);
    let routed: Routes | undefined;
    let taken: Map<GNode, Array<GNode | undefined>> | undefined;
    for (;;) {
      const blocked = (taken ??= this.takenColumns());
      // joins first: a node entered from below may then move under a join already in place
      const open = layout.nodes.filter((node) => blocked.has(node) && !tried.has(node));
      const candidate = open.find((node) => ChannelRouter.entriesFromBelow(node).length) ?? open[0];
      if (!candidate) break;
      tried.add(candidate);
      const before = routed ?? route();
      // an entry drawn over the top enters the node's top and needs no column below
      if (before.above.size && !this.takenColumns(before.above).has(candidate)) {
        if (LayoutDebug.on()) LayoutDebug.log(`[joins] ${candidate.id} stays: entered over the top`);
        routed = before;
        continue;
      }
      const checkpoint = new ArrangementCheckpoint(layout);
      const kept = new Map(shifts);
      const step = (node: GNode): number => (shifts.get(node) ?? 0) - (kept.get(node) ?? 0);
      const reset = (to: ReadonlyMap<GNode, number>): void => {
        shifts.clear();
        for (const [node, shift] of to) shifts.set(node, shift);
      };
      /**
       * Better and nothing worse: more rises, fewer labels, or fewer crossings / cuts at as many
       * rises; or fewer cuts, each paying for at most one more crossing.
       */
      const keeps = (candidateRoutes: Routes): boolean =>
        ((candidateRoutes.rises.size > before.rises.size || candidateRoutes.labels < before.labels || ((candidateRoutes.crossings < before.crossings || candidateRoutes.hits < before.hits) && candidateRoutes.rises.size >= before.rises.size)) && candidateRoutes.crossings <= before.crossings && candidateRoutes.hits <= before.hits && candidateRoutes.labels <= before.labels) ||
        (candidateRoutes.hits < before.hits && candidateRoutes.labels <= before.labels && candidateRoutes.crossings - before.crossings <= before.hits - candidateRoutes.hits);
      const xs = new Map(layout.nodes.map((node) => [node, node.box.x]));
      const dx = (node: GNode): number => node.box.x - xs.get(node)!;
      /** The columns this trial took (something new or moved is there) whose nodes can move on. */
      const took = (cols: ReadonlyMap<GNode, Array<GNode | undefined>>): GNode[] =>
        [...cols].filter(([node, owners]) => (node === candidate || owners.some((owner) => !blocked.get(node)?.includes(owner) || (!!owner && dx(owner) !== dx(node)))) && step(node) < MAX_JOIN_SHIFT).map(([node]) => node);
      // right until the column is free (the chain that blocks it may go on)
      let now: Map<GNode, Array<GNode | undefined>>;
      do {
        shifts.set(candidate, (shifts.get(candidate) ?? 0) + 1);
        arrange(shifts);
        now = this.takenColumns();
      } while (step(candidate) < MAX_JOIN_SHIFT && now.has(candidate));
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
          for (const node of next) shifts.set(node, (shifts.get(node) ?? 0) + 1);
          // larger pushes never drew better, and each costs a routing
          if ([...shifts.keys()].filter((node) => node !== candidate && step(node)).length > MAX_PUSHED) {
            if (round) back();
            else reset(alone);
            return false;
          }
          arrange(shifts);
        }
        if (LayoutDebug.on()) others = layout.nodes.filter((node) => node !== candidate && step(node)).map((node) => `${node.id} ${step(node)}`).join(', ');
        return [...shifts].some(([node, shift]) => shift !== alone.get(node));
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
      const breaks = first.some((node) => ChannelRouter.risesInto(node).some((edge) => before.rises.has(edge)));
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
        if ((!keep || [...before.rises].some((edge) => !single.rises.has(edge))) && !breaks && push()) {
          together = route();
          if (keeps(together)) {
            after = together;
            keep = true;
          } else back();
        }
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[joins] ${candidate.id} ${keep ? `moves ${step(candidate)} right` : 'stays'}: ${show(before)} -> ${show(after)}${together ? ` (with ${others}${after === together ? '' : `: ${show(together)}`})` : ''}`);
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
    const entries = (node: GNode): GEdge[] => (over ? ChannelRouter.risesInto(node).filter((edge) => !over.has(edge)) : ChannelRouter.risesInto(node));
    const rising = layout.nodes.filter((node) => entries(node).length);
    if (!rising.length) return out;
    const index = new XIndex<[Box, GNode | undefined]>();
    const add = (box: Box, owner: GNode | undefined): void => index.add([box, owner], box.x, box.x + box.width);
    for (const node of layout.nodes) {
      add(node.box, node);
      for (const boundaryEvent of node.boundary) add(boundaryEvent.box, node);
    }
    const ownerOf = (artifact: GArtifact): GNode | undefined => artifact.anchorNode?.host ?? artifact.anchorNode;
    for (const artifact of routedArtifacts(layout)) add(artifact.box, ownerOf(artifact));
    const labels = new ScopeLabels(layout);
    for (const [box, node] of labels.ownShapes()) add(box, node);
    for (const [box, artifact] of labels.placedData()) add(box, ownerOf(artifact));
    for (const riser of rising) {
      const riseX = ChannelRouter.riseX(riser), top = riser.box.y + riser.box.height, low = Math.max(...entries(riser).map(ChannelRouter.riseFrom));
      const owners = index.near(riseX - RISE_KEEP, riseX + RISE_KEEP).filter(([box, owner]) => owner !== riser && box.x - RISE_KEEP < riseX && riseX < box.x + box.width + RISE_KEEP && box.y < low && top < box.y + box.height).map(([, owner]) => owner);
      if (owners.length) out.set(riser, owners);
    }
    return out;
  }
}
