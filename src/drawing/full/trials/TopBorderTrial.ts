import type { BpmnElement } from '../../../model/index.js';
import { Frames } from '../../plane/Frames.js';
import { GNode, type LaneBandInfo, type LinkEnd } from '../scopes/GNode.js';
import { ScopeGrid } from '../scopes/ScopeGrid.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { TopWays, type TopWay } from './TopWays.js';

export class TopBorderTrial extends ArrangementTrial {
  private static readonly TITLE_KEEP = 2;

  private ways!: TopWays;

  private static messageEnds(scope: BpmnElement): Set<string> {
    let root = scope;
    while (root.parent) {
      root = root.parent;
    }
    const ids = new Set<string>();
    for (const collaboration of root.list('rootElements').filter((element) => element.is('bpmn:Collaboration'))) {
      for (const flow of collaboration.list('messageFlows')) {
        for (const end of [flow.peek<BpmnElement>('sourceRef'), flow.peek<BpmnElement>('targetRef')]) {
          if (end) {
            ids.add(end.id);
          }
        }
      }
    }
    return ids;
  }

  private static keeps(event: GNode, was: TopWay, now: TopWay, before: Routes, after: Routes): boolean {
    const mine = new Set(event.out);
    const clean = now.up && now.clearOfLines && now.labelClear;
    const stays = [...before.rises].every((edge) => after.rises.has(edge) || mine.has(edge)) && [...before.straight].every((edge) => after.straight.has(edge) || mine.has(edge));
    const noWorse = after.bends - now.bends <= before.bends - was.bends && after.crossings <= before.crossings && after.hits <= before.hits && after.labels <= before.labels;
    const better = after.crossings < before.crossings || after.hits < before.hits || after.labels < before.labels || (now.length < was.length && now.bends < was.bends);
    return clean && stays && noWorse && better;
  }

  run(): void {
    const events = this.movableEvents();
    if (!events.length) {
      return;
    }
    this.ways = new TopWays(this.layout, events);
    let before = this.measure();
    for (const event of events) {
      before = this.tryOnTop(event, before);
    }
  }

  private laneOf(node: GNode): LaneBandInfo | undefined {
    return this.layout.laneBands?.find((band) => band.nodes.has(node));
  }

  private withLines(): Set<GNode> {
    const attached = new Set<GNode>();
    for (const artifact of this.layout.artifacts) {
      const ends: Array<LinkEnd | GNode | undefined> = [artifact.anchorNode, ...artifact.links.flatMap((link) => [link.from, link.to])];
      for (const end of ends) {
        if (end instanceof GNode && end.host) {
          attached.add(end);
        }
      }
    }
    return attached;
  }

  private leadsUp(event: GNode, host: GNode): boolean {
    return event.out.length > 0 && event.out.every((edge) => !edge.back && edge.target !== host && edge.target.box.center.y < event.box.center.y - 1 && this.laneOf(edge.target) === this.laneOf(host));
  }

  private movableEvents(): GNode[] {
    const { layout } = this;
    const attached = this.withLines();
    let messages: Set<string> | undefined;
    const isMessageEnd = (event: GNode): boolean => {
      messages ??= TopBorderTrial.messageEnds(layout.el);
      return messages.has(event.id);
    };
    return layout.nodes.flatMap((node) => node.boundary.filter((event) => !event.onTop && !event.compensationHandler && !attached.has(event) && this.leadsUp(event, node) && !isMessageEnd(event)));
  }

  private measure(): Routes {
    const routes = this.routesOf(false, () => this.ways.look());
    return { ...routes, crossings: routes.crossings + this.ways.linkCrossings };
  }

  private topBorderFull(host: GNode): boolean {
    return host.boundary.filter((event) => event.onTop).length >= ScopeGrid.borderSpots(host);
  }

  private tryOnTop(event: GNode, before: Routes): Routes {
    const { ways } = this.ways;
    const host = event.host!;
    const was = ways.get(event)!;
    if (!was.worth || this.topBorderFull(host)) {
      return before;
    }
    const checkpoint = new ArrangementCheckpoint(this.layout);
    event.onTop = true;
    ScopeGrid.placeBoundaryEvents(host);
    const title = host.child ? Frames.titleBox(host.box, host.el.name) : undefined;
    if (title?.overlaps(event.box, TopBorderTrial.TITLE_KEEP)) {
      checkpoint.restore();
      return before;
    }
    const kept = new Map(ways);
    let after = this.measure();
    let now = ways.get(event)!;
    if (now.up && now.clearOfLines && !now.labelClear) {
      event.labelLeft = true;
      after = this.measure();
      now = ways.get(event)!;
    }
    if (TopBorderTrial.keeps(event, was, now, before, after)) {
      return after;
    }
    checkpoint.restore();
    ways.clear();
    for (const [node, way] of kept) {
      ways.set(node, way);
    }
    return before;
  }
}
