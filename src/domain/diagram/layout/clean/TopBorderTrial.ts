import { LayoutDebug } from '../LayoutDebug.js';
import { titleBox } from '../../utils/text.js';
import { center, equalBoxes, overlaps, segmentHitsBox, hitCount, properCross, toSegments, type Segment } from '../../utils/geom.js';
import type { Box, GEdge, GNode, LaneBandInfo, LinkEnd, Point } from '../../di/types.js';
import { is, many, type El, idOf } from '../../../document/utils/moddle.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { LinkRouter } from './LinkRouter.js';
import { ScopeGrid } from './ScopeGrid.js';
import { ScopeLabels } from './ScopeLabels.js';
import { XIndex } from './XIndex.js';
import { nameOf } from '../../utils/names.js';
import { obstacles, routedArtifacts } from '../../utils/scope.js';
import { isAnnotationLine } from '../../utils/annotations.js';

/**
 * Moves a boundary event whose flows all lead up to its host's top border when that draws
 * better: its flows then leave straight up and nothing gets worse. Message flow ends,
 * compensation events and events with data or a note stay put; a rejected move is undone.
 */
export class TopBorderTrial extends ArrangementTrial {
  /**
   * Events with data or a note attached keep their place below the host. Links of notes other than
   * a boundary event's do not count, as those are placed later. A way below the host's row as clean
   * as a way up (two bends, no fault) is not worth trying; on the top border the label goes to the
   * upper left where the upper right is taken.
   */
  run(): void {
    const { layout } = this;
    const lanes = layout.laneBands;
    const laneOf = (node: GNode): LaneBandInfo | undefined => lanes?.find((band) => band.nodes.has(node));
    const attached = new Set<GNode>();
    for (const artifact of layout.artifacts) {
      const ends: Array<LinkEnd | GNode | undefined> = [artifact.anchorNode, ...artifact.links.flatMap((link) => [link.from, link.to])];
      for (const end of ends) {
        if (end && 'host' in end && (end as GNode).host) attached.add(end as GNode);
      }
    }
    let messages: Set<string> | undefined;
    const events = layout.nodes.flatMap((node) =>
      node.boundary.filter((boundaryEvent) => !boundaryEvent.onTop && !boundaryEvent.compensationHandler && !attached.has(boundaryEvent) && boundaryEvent.out.length && boundaryEvent.out.every((edge) => !edge.back && edge.target !== node && center(edge.target.box).y < center(boundaryEvent.box).y - 1 && laneOf(edge.target) === laneOf(node)) && !(messages ??= this.messageEnds(layout.el)).has(boundaryEvent.id)),
    );
    if (!events.length) return;
    /** `box`: no other line runs through the event */
    const ways = new Map<GNode, { length: number; bends: number; up: boolean; box: boolean; label: boolean; worth: boolean }>();
    let linkCrossings = 0;
    const look = (): void => {
      new LinkRouter(layout).route();
      const artifactLinks = routedArtifacts(layout).flatMap((artifact) => artifact.links);
      const compensations = layout.compensations.map((compensation) => compensation.points);
      const links = [...compensations, ...artifactLinks.map((link) => link.points)];
      linkCrossings = this.crossingPairs(layout.edges.map((edge) => edge.points), [...compensations, ...artifactLinks.filter((link) => !isAnnotationLine(link.el)).map((link) => link.points)]);
      const segments = [...layout.edges.map((edge) => [edge, edge.points] as const), ...links.map((pts) => [undefined, pts] as const)].map(([edge, pts]) => [edge, pts.slice(1).map((point, index): [Point, Point] => [pts[index]!, point])] as const);
      const shapes = layout.nodes.flatMap((node) => [node.box, ...node.boundary.map((boundaryEvent) => boundaryEvent.box)]).concat(routedArtifacts(layout).map((artifact) => artifact.box));
      const scopeLabels = new ScopeLabels(layout);
      const labels = [...scopeLabels.shapes(), ...scopeLabels.data()];
      const flowLabels = layout.edges.flatMap((edge) => (edge.label ? [edge.label] : []));
      for (const boundaryEvent of events) {
        const mine = new Set(boundaryEvent.out);
        let length = 0, bends = 0;
        for (const edge of boundaryEvent.out) {
          for (let index = 0; index + 1 < edge.points.length; index++) {
            length += Math.abs(edge.points[index + 1]!.x - edge.points[index]!.x) + Math.abs(edge.points[index + 1]!.y - edge.points[index]!.y);
          }
          bends += Math.max(0, edge.points.length - 2);
        }
        if (boundaryEvent.onTop) {
          const up = boundaryEvent.out.every((edge) => edge.runsAbove && edge.points.length > 1 && edge.points[1]!.y < edge.points[0]!.y);
          const label = ScopeLabels.of(boundaryEvent, 'boundary');
          const box = !segments.some(([edge, pieces]) => (!edge || !mine.has(edge)) && pieces.some(([start, end]) => segmentHitsBox(start, end, boundaryEvent.box)));
          const clear =
            !label ||
            (!shapes.some((shape) => shape !== boundaryEvent.box && overlaps(shape, label, 2)) &&
              !labels.some((otherLabel) => !equalBoxes(otherLabel, label) && overlaps(otherLabel, label, 2)) &&
              !flowLabels.some((flowLabel) => overlaps(flowLabel, label, 2)) &&
              !segments.some(([, pieces]) => pieces.some(([start, end]) => segmentHitsBox(start, end, label))));
          ways.set(boundaryEvent, { length, bends, up, box, label: clear, worth: false });
          continue;
        }
        const worth = boundaryEvent.out.some((edge) => edge.runsAbove || edge.points.length >= 5) || this.faultyFlows(boundaryEvent.out, labels).size > 0;
        ways.set(boundaryEvent, { length, bends, up: false, box: false, label: false, worth });
      }
    };
    const measure = (): Routes => {
      const routes = this.routesOf(false, look);
      return { ...routes, crossings: routes.crossings + linkCrossings };
    };
    let before = measure();
    for (const boundaryEvent of events) {
      const host = boundaryEvent.host!;
      const was = ways.get(boundaryEvent)!;
      if (!was.worth) continue;
      const checkpoint = new ArrangementCheckpoint(layout);
      boundaryEvent.onTop = true;
      ScopeGrid.placeBoundaryEvents(host);
      const title = host.child ? titleBox(host.box, nameOf(host)) : undefined;
      if (title && overlaps(title, boundaryEvent.box, 2)) {
        if (LayoutDebug.on()) {
          LayoutDebug.log(`[boundary] ${boundaryEvent.id} stays on the bottom border: the title of ${host.id} is in the way`);
        }
        checkpoint.restore();
        continue;
      }
      const kept = new Map(ways);
      let after = measure();
      let now = ways.get(boundaryEvent)!;
      if (now.up && now.box && !now.label) {
        boundaryEvent.labelLeft = true;
        after = measure();
        now = ways.get(boundaryEvent)!;
      }
      const mine = new Set(boundaryEvent.out);
      const keep =
        now.up &&
        now.box &&
        now.label &&
        [...before.rises].every((edge) => after.rises.has(edge) || mine.has(edge)) &&
        [...before.straight].every((edge) => after.straight.has(edge) || mine.has(edge)) &&
        after.bends - now.bends <= before.bends - was.bends &&
        after.crossings <= before.crossings &&
        after.hits <= before.hits &&
        after.labels <= before.labels &&
        (after.crossings < before.crossings || after.hits < before.hits || after.labels < before.labels || (now.length < was.length && now.bends < was.bends));
      if (LayoutDebug.on()) {
        const why = [now.up ? '' : 'not up', now.box ? '' : 'a line through it', now.label ? '' : 'its label not clear', boundaryEvent.labelLeft ? 'label left' : ''].filter(Boolean).join(', ');
        LayoutDebug.log(`[boundary] ${boundaryEvent.id} ${keep ? 'moves to the top border' : 'stays on the bottom border'}: ${this.showRoutes(before)} ${was.length} px ${was.bends} bends -> ${this.showRoutes(after)} ${now.length} px ${now.bends} bends${why ? ` (${why})` : ''}`);
      }
      if (keep) {
        before = after;
      } else {
        checkpoint.restore();
        ways.clear();
        for (const [node, way] of kept) {
          ways.set(node, way);
        }
      }
    }
  }

  private messageEnds(scope: El): Set<string> {
    let root = scope;
    while (root.$parent) {
      root = root.$parent as El;
    }
    const ids = new Set<string>();
    for (const rootElement of many(root, 'rootElements')) {
      if (!is(rootElement, 'bpmn:Collaboration')) continue;
      for (const mf of many(rootElement, 'messageFlows')) {
        for (const end of [mf.get<El | undefined>('sourceRef'), mf.get<El | undefined>('targetRef')]) {
          if (end) ids.add(idOf(end));
        }
      }
    }
    return ids;
  }

  private faultyFlows(flows: readonly GEdge[], labels: readonly Box[]): Set<GEdge> {
    const { layout } = this;
    const boxes = obstacles(layout);
    const cuts = (flow: GEdge): boolean => hitCount(flow.points, boxes, [flow.source.box, flow.target.box, ...(flow.source.host ? [flow.source.host.box] : [])]) > 0;
    const crosses = (flow: GEdge): boolean => this.crossingPairs([flow.points], layout.edges.filter((other) => other !== flow).map((other) => other.points)) > 0;
    return new Set(flows.filter((flow) => cuts(flow) || crosses(flow) || labels.some((labelBox) => toSegments(flow.points).some(([start, end]) => segmentHitsBox(start, end, labelBox)))));
  }

  private crossingPairs(lines: readonly Point[][], otherLines: readonly Point[][]): number {
    const index = new XIndex<[Segment, number]>();
    otherLines.forEach((pts, lineIndex) => {
      for (const segment of toSegments(pts)) {
        index.add([segment, lineIndex], Math.min(segment[0].x, segment[1].x), Math.max(segment[0].x, segment[1].x));
      }
    });
    let count = 0;
    for (const pts of lines) {
      const met = new Set<number>();
      for (const segment of toSegments(pts)) {
        index.each(Math.min(segment[0].x, segment[1].x), Math.max(segment[0].x, segment[1].x), ([otherSegment, lineIndex]) => {
          if (!met.has(lineIndex) && properCross(segment, otherSegment)) {
            met.add(lineIndex);
          }
        });
      }
      count += met.size;
    }
    return count;
  }
}
