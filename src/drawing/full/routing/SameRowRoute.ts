import { Polyline } from '../../../model/index.js';
import type { GEdge } from '../scopes/GNode.js';
import type { FlowPaths } from './FlowPaths.js';
import { RoutingArea, type Route } from './RoutingArea.js';

export class SameRowRoute {
  constructor(
    private readonly area: RoutingArea,
    private readonly paths: FlowPaths,
  ) {}

  of(edge: GEdge): Route {
    const { source, target } = edge;
    const straight = RoutingArea.straightLine(edge);
    if (edge.bandY !== undefined) {
      return { points: this.inBandOrStraight(edge, edge.bandY, straight) };
    }
    if (new Polyline(straight).hitsAny(this.area.boxes, [source.box, target.box])) {
      return { points: this.paths.channelRoute(source, target) };
    }
    return { points: straight };
  }

  private inBandOrStraight(edge: GEdge, bandY: number, straight: Route['points']): Route['points'] {
    const { source, target } = edge;
    const { area } = this;
    const band = this.paths.throughChannel(source, target, bandY);
    if (area.openRow.has(edge) && area.lineFree(straight) && RoutingArea.crossingsOf(straight, area.routed) <= RoutingArea.crossingsOf(band, area.routed)) {
      area.leftTaken.add(target);
      return straight;
    }
    area.usedBottom.take(source, source.exitX, true);
    return band;
  }
}
