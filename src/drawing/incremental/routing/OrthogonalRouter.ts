import { Point, Polyline, type Box } from '../../../model/index.js';
import { ShapeSides, type Side } from '../../plane/ShapeSides.js';
import { JogCentring } from './JogCentring.js';
import { RouteGridBuilder } from '../grid/RouteGridBuilder.js';
import type { Port } from './RoutePorts.js';
import { RouteScene, type RouteRequest } from './RouteScene.js';
import { RouteSearch, type FoundRoute } from '../grid/RouteSearch.js';
import { RouteCosts } from './RouteCosts.js';

export type { RouteRequest } from './RouteScene.js';

interface Attempt extends FoundRoute {
  hits: number;
}

export class OrthogonalRouter {
  private constructor(private readonly scene: RouteScene) {}

  static route(request: RouteRequest): Point[] {
    const scene = RouteScene.of(request);
    const router = new OrthogonalRouter(scene);
    const frame = request.frame && RouteScene.isFinite(request.frame) ? request.frame.union(scene.source.union(scene.target)) : undefined;
    const thin = scene.margin > RouteCosts.THIN_MARGIN ? new OrthogonalRouter(scene.thinned()) : undefined;
    const best = router.bestRoute(thin, frame);
    return new JogCentring(scene).centred(best ? best.points : router.directRoute());
  }

  private static better(first: Attempt | undefined, second: Attempt | undefined): Attempt | undefined {
    if (!first || !second) {
      return first ?? second;
    }
    return second.hits < first.hits || (second.hits === first.hits && second.cost < first.cost) ? second : first;
  }

  private static clean(attempt: Attempt | undefined): attempt is Attempt {
    return !!attempt && attempt.hits === 0;
  }

  private static portOrMiddle(ports: readonly Port[], box: Box, side: Side): Port {
    const { x, y } = ShapeSides.pointOn(box, side, box.center.y);
    return ports[0] ?? { x, y, side, cost: 0 };
  }

  private bestRoute(thin: OrthogonalRouter | undefined, frame: Box | undefined): Attempt | undefined {
    let best = this.attempt(false, frame);
    if (!OrthogonalRouter.clean(best)) {
      best = OrthogonalRouter.better(best, this.attempt(true, frame));
    }
    if (thin && !OrthogonalRouter.clean(best)) {
      best = OrthogonalRouter.better(best, thin.attempt(true, frame));
    }
    if (frame && !OrthogonalRouter.clean(best)) {
      const free = OrthogonalRouter.better(this.attempt(true, undefined), thin?.attempt(true, undefined));
      best = OrthogonalRouter.clean(free) ? free : best;
    }
    return best;
  }

  private attempt(wide: boolean, frame: Box | undefined): Attempt | undefined {
    const { src, tgt } = this.scene;
    const found = new RouteSearch(new RouteGridBuilder(this.scene, frame).grid(wide)).find(src, tgt);
    return found && { ...found, hits: this.scene.score(found.points).hits };
  }

  private directRoute(): Point[] {
    const { src, tgt, source, target } = this.scene;
    const sourcePort = OrthogonalRouter.portOrMiddle(src, source, 'right');
    const targetPort = OrthogonalRouter.portOrMiddle(tgt, target, 'left');
    const start = new Point(sourcePort.x, sourcePort.y), end = new Point(targetPort.x, targetPort.y);
    return new Polyline(this.directPoints(start, end, sourcePort.side, targetPort.side)).simplified();
  }

  private directPoints(start: Point, end: Point, sourceSide: Side, targetSide: Side): Point[] {
    if (start.x === end.x || start.y === end.y) {
      return [start, end];
    }
    const leavesSideways = sourceSide === 'left' || sourceSide === 'right';
    const entersSideways = targetSide === 'left' || targetSide === 'right';
    if (leavesSideways && entersSideways) {
      const middleX = Math.round((start.x + end.x) / 2);
      return [start, new Point(middleX, start.y), new Point(middleX, end.y), end];
    }
    if (!leavesSideways && !entersSideways) {
      const middleY = Math.round((start.y + end.y) / 2);
      return [start, new Point(start.x, middleY), new Point(end.x, middleY), end];
    }
    return leavesSideways ? [start, new Point(end.x, start.y), end] : [start, new Point(start.x, end.y), end];
  }
}
