import { LayoutDebug } from '../../shared/LayoutDebug.js';
import { titleBox } from '../../diagram/utils/text.js';
import { boxesOverlap, center, equalBoxes, segmentHitsBox } from '../../diagram/utils/geom.js';
import type { Box, GEdge, GNode, LaneBandInfo, LinkEnd, Point, ScopeLayout } from '../../diagram/types.js';
import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { LinkRouter } from './LinkRouter.js';
import { ScopeGrid } from './ScopeGrid.js';
import { ScopeLabels } from './ScopeLabels.js';
import { XIndex } from './XIndex.js';
import { hitCount, segmentsCross, toSegments, type Segment } from './utils/geometry.js';
import { nameOf } from './utils/names.js';
import { obstacles, routedArtifacts } from './utils/scope.js';

/**
 * Boundary events on the top border of their host (GNode.onTop): an event
 * whose flows all go forward to targets above it in its host's lane (or in a
 * scope without lanes) moves to its host's top border (ScopeGrid.placeBoundaryEvents:
 * at its right end, the host's other events keep their places; its label
 * goes above the host, ScopeLabels.of) and its flows leave it straight
 * up over the top (EdgeRouter), when that draws better. The scope is routed
 * both ways (EdgeRouter; the links as LinkRouter then draws them)
 * and the move is kept only when every flow of the event then leaves it
 * upwards over the top; no other line runs through the event (a flow into
 * or out of the host's top there, a link); its label lies clear of the
 * shapes, the other labels (of shapes, data and flows) and every line, to
 * the upper right of the event, else to its upper left (GNode.labelLeft);
 * every flow that rose straight into a node's bottom still does, every other
 * flow of one segment stays one and the other flows bend no more; no more
 * pairs of lines cross (flows, and flows with links), no more shapes are cut
 * and no more labels of shapes are run through, and fewer of one of them,
 * or as many and the event's flows are shorter with fewer bends. So an event
 * whose way the bottom border sends over the top (round its host, past the
 * flow into it) takes the top border, and one with a way below its host's
 * row that is as clean stays. Not tried: a compensation event, an event with
 * data or a note (placed below the host for the event as it is), the end of
 * a message flow (the message routes come later), one that would sit on the
 * title of an expanded sub-process, and one whose flows, drawn from the
 * bottom border, neither go over the top nor bend three times nor cross a
 * flow, cut a shape or run through a label of a shape or data (the way up
 * cannot draw better). One event at a time, in the order of the nodes and
 * their events, each tried once; a move not kept is undone exactly
 * (ArrangementCheckpoint). Runs on the final arrangement (after JoinColumnTrial
 * and ChainLiftTrial), before the routing that draws it.
 */
export class TopBorderTrial extends ArrangementTrial {
  run(): void {
    const { layout } = this;
    const lanes = layout.laneBands;
    const laneOf = (n: GNode): LaneBandInfo | undefined => lanes?.find((b) => b.nodes.has(n));
    // the boundary events with data or a note
    const attached = new Set<GNode>();
    for (const a of layout.artifacts) {
      const ends: Array<LinkEnd | GNode | undefined> = [a.anchorNode, ...a.links.flatMap((l) => [l.from, l.to])];
      for (const end of ends) if (end && 'host' in end && (end as GNode).host) attached.add(end as GNode);
    }
    let messages: Set<string> | undefined;
    const events = layout.nodes.flatMap((n) =>
      n.boundary.filter((b) => !b.onTop && !b.compensationHandler && !attached.has(b) && b.out.length && b.out.every((e) => !e.back && e.target !== n && center(e.target.box).y < center(b.box).y - 1 && laneOf(e.target) === laneOf(n)) && !(messages ??= this.messageEnds(layout.el)).has(b.id)),
    );
    if (!events.length) return;
    /**
     * what the routes of an arrangement give each event: its flows' length and bends, whether they leave it upwards over
     * the top, no other line runs through the event (`box`) and its label is clear, and it is worth a trial
     */
    const ways = new Map<GNode, { length: number; bends: number; up: boolean; box: boolean; label: boolean; worth: boolean }>();
    /** the pairs of a flow and a link that cross in the routes of the arrangement `look` saw last */
    let linkCrossings = 0;
    const look = (): void => {
      // the flows and the links as LinkRouter draws them after the flows (compensation links, data associations; notes
      // other than a boundary event's are placed later: not theirs)
      new LinkRouter(layout).route();
      const links = [...layout.compensations.map((c) => c.points), ...routedArtifacts(layout).flatMap((a) => a.links.map((l) => l.points))];
      linkCrossings = this.crossingPairs(layout.edges.map((e) => e.points), links);
      const segments = [...layout.edges.map((e) => [e, e.points] as const), ...links.map((pts) => [undefined, pts] as const)].map(([e, pts]) => [e, pts.slice(1).map((p, i): [Point, Point] => [pts[i]!, p])] as const);
      const shapes = layout.nodes.flatMap((n) => [n.box, ...n.boundary.map((b) => b.box)]).concat(routedArtifacts(layout).map((a) => a.box));
      const scopeLabels = new ScopeLabels(layout);
      const labels = [...scopeLabels.shapes(), ...scopeLabels.data()];
      const flowLabels = layout.edges.flatMap((e) => (e.label ? [e.label] : []));
      for (const b of events) {
        const mine = new Set(b.out);
        let length = 0, bends = 0;
        for (const e of b.out) {
          for (let i = 0; i + 1 < e.points.length; i++) length += Math.abs(e.points[i + 1]!.x - e.points[i]!.x) + Math.abs(e.points[i + 1]!.y - e.points[i]!.y);
          bends += Math.max(0, e.points.length - 2);
        }
        if (b.onTop) {
          const up = b.out.every((e) => e.runsAbove && e.points.length > 1 && e.points[1]!.y < e.points[0]!.y);
          const label = ScopeLabels.of(b, 'boundary');
          const box = !segments.some(([e, s]) => (!e || !mine.has(e)) && s.some(([p, q]) => segmentHitsBox(p, q, b.box)));
          const clear =
            !label ||
            (!shapes.some((s) => s !== b.box && boxesOverlap(s, label, 2)) &&
              !labels.some((l) => !equalBoxes(l, label) && boxesOverlap(l, label, 2)) &&
              !flowLabels.some((l) => boxesOverlap(l, label, 2)) &&
              !segments.some(([, s]) => s.some(([p, q]) => segmentHitsBox(p, q, label))));
          ways.set(b, { length, bends, up, box, label: clear, worth: false });
          continue;
        }
        // a way below its host's row as clean as a way up (two bends, no fault) cannot be beaten
        const worth = b.out.some((e) => e.runsAbove || e.points.length >= 5) || this.faultyFlows(b.out, labels).size > 0;
        ways.set(b, { length, bends, up: false, box: false, label: false, worth });
      }
    };
    /** the routes of the arrangement, their crossings with those of the links */
    const measure = (): Routes => {
      const r = this.routesOf(false, look);
      return { ...r, crossings: r.crossings + linkCrossings };
    };
    let before = measure();
    for (const b of events) {
      const host = b.host!;
      const was = ways.get(b)!;
      if (!was.worth) continue;
      const checkpoint = new ArrangementCheckpoint(layout);
      b.onTop = true;
      ScopeGrid.placeBoundaryEvents(host);
      const title = host.child ? titleBox(host.box, nameOf(host)) : undefined;
      if (title && boxesOverlap(title, b.box, 2)) {
        if (LayoutDebug.on()) LayoutDebug.log(`[boundary] ${b.id} stays on the bottom border: the title of ${host.id} is in the way`);
        checkpoint.restore();
        continue;
      }
      const kept = new Map(ways);
      let after = measure();
      let now = ways.get(b)!;
      // the label to the upper left where the upper right is taken
      if (now.up && now.box && !now.label) {
        b.labelLeft = true;
        after = measure();
        now = ways.get(b)!;
      }
      const mine = new Set(b.out);
      const keep =
        now.up &&
        now.box &&
        now.label &&
        [...before.rises].every((e) => after.rises.has(e) || mine.has(e)) &&
        [...before.straight].every((e) => after.straight.has(e) || mine.has(e)) &&
        after.bends - now.bends <= before.bends - was.bends &&
        after.crossings <= before.crossings &&
        after.hits <= before.hits &&
        after.labels <= before.labels &&
        (after.crossings < before.crossings || after.hits < before.hits || after.labels < before.labels || (now.length < was.length && now.bends < was.bends));
      if (LayoutDebug.on()) {
        const why = [now.up ? '' : 'not up', now.box ? '' : 'a line through it', now.label ? '' : 'its label not clear', b.labelLeft ? 'label left' : ''].filter(Boolean).join(', ');
        LayoutDebug.log(`[boundary] ${b.id} ${keep ? 'moves to the top border' : 'stays on the bottom border'}: ${this.showRoutes(before)} ${was.length} px ${was.bends} bends -> ${this.showRoutes(after)} ${now.length} px ${now.bends} bends${why ? ` (${why})` : ''}`);
      }
      if (keep) before = after;
      else {
        checkpoint.restore();
        ways.clear();
        for (const [k, v] of kept) ways.set(k, v);
      }
    }
  }

  /** The ids of the elements message flows connect, in the collaborations of the definitions of `scope`. */
  private messageEnds(scope: El): Set<string> {
    let root = scope;
    while (root.$parent) root = root.$parent as El;
    const ids = new Set<string>();
    for (const c of many(root, 'rootElements')) {
      if (!is(c, 'bpmn:Collaboration')) continue;
      for (const mf of many(c, 'messageFlows')) {
        for (const end of [mf.get<El | undefined>('sourceRef'), mf.get<El | undefined>('targetRef')]) if (end) ids.add(idOf(end));
      }
    }
    return ids;
  }

  /**
   * The flows of `flows` that, as routed, cross another flow of the scope, cut a shape (not their own ends, nor the
   * host of the boundary event they leave; EdgeRouter.faults alike) or run through one of `labels`.
   */
  private faultyFlows(flows: readonly GEdge[], labels: readonly Box[]): Set<GEdge> {
    const { layout } = this;
    const boxes = obstacles(layout);
    const cuts = (e: GEdge): boolean => hitCount(e.points, boxes, [e.source.box, e.target.box, ...(e.source.host ? [e.source.host.box] : [])]) > 0;
    const crosses = (e: GEdge): boolean => this.crossingPairs([e.points], layout.edges.filter((o) => o !== e).map((o) => o.points)) > 0;
    return new Set(flows.filter((e) => cuts(e) || crosses(e) || labels.some((l) => toSegments(e.points).some(([a, b]) => segmentHitsBox(a, b, l)))));
  }

  /** How many pairs of a line of `a` and a line of `b` cross (proper crossings, EdgeRouter.faults alike). */
  private crossingPairs(a: readonly Point[][], b: readonly Point[][]): number {
    const index = new XIndex<[Segment, number]>();
    b.forEach((pts, j) => {
      for (const s of toSegments(pts)) index.add([s, j], Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x));
    });
    let n = 0;
    for (const pts of a) {
      const met = new Set<number>();
      for (const s of toSegments(pts)) {
        index.each(Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x), ([q, j]) => {
          if (!met.has(j) && segmentsCross(s, q)) met.add(j);
        });
      }
      n += met.size;
    }
    return n;
  }
}
