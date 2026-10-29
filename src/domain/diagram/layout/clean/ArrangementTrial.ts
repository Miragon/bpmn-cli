import type { GEdge, ScopeLayout } from '../../di/types.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ChannelRouter } from './ChannelRouter.js';
import { ScopeLabels } from './ScopeLabels.js';

/**
 * How the routes of an arrangement run: faults, straight rises, one-segment flows, bends and,
 * on request, flows sharing a line.
 */
export type Routes = { crossings: number; hits: number; labels: number; rises: Set<GEdge>; above: Set<GEdge>; straight: Set<GEdge>; bends: number; shared: number; sharing: Set<GEdge> };

export abstract class ArrangementTrial {
  constructor(protected readonly layout: ScopeLayout) {}

  abstract run(): void;

  /** `look` sees the routed scope before it is left as it was. */
  protected routesOf(lines = false, look?: () => void): Routes {
    const { layout } = this;
    const checkpoint = new ArrangementCheckpoint(layout);
    const router = new ChannelRouter(layout);
    router.route();
    const straight = new Set<GEdge>();
    let bends = 0;
    for (const edge of layout.edges) {
      if (edge.points.length === 2) straight.add(edge);
      bends += Math.max(0, edge.points.length - 2);
    }
    const labels = new ScopeLabels(layout);
    const routes = { ...router.faults([...labels.shapes(), ...labels.data()]), rises: this.straightRises(), above: new Set(layout.edges.filter((edge) => edge.runsAbove)), straight, bends, ...(lines ? this.sharedLines() : { shared: 0, sharing: new Set<GEdge>() }) };
    look?.();
    checkpoint.restore();
    return routes;
  }

  protected showRoutes(routes: Routes, lines = false): string {
    return JSON.stringify({ crossings: routes.crossings, hits: routes.hits, labels: routes.labels, rises: routes.rises.size, ...(routes.above.size ? { above: routes.above.size } : {}), ...(lines ? { straight: routes.straight.size, bends: routes.bends, shared: routes.shared } : {}) });
  }

  /** Two segments on one line count as shared when they overlap by more than a point. */
  private sharedLines(): { shared: number; sharing: Set<GEdge> } {
    const { layout } = this;
    const lines = new Map<string, Array<[number, number, number]>>();
    layout.edges.forEach((edge, edgeIndex) => {
      for (let pointIndex = 0; pointIndex + 1 < edge.points.length; pointIndex++) {
        const start = edge.points[pointIndex]!, end = edge.points[pointIndex + 1]!;
        const key = start.y === end.y ? `h${start.y}` : start.x === end.x ? `v${start.x}` : undefined;
        if (!key) continue;
        const [lo, hi] = start.y === end.y ? [Math.min(start.x, end.x), Math.max(start.x, end.x)] : [Math.min(start.y, end.y), Math.max(start.y, end.y)];
        const list = lines.get(key);
        if (list) {
          list.push([lo, hi, edgeIndex]);
        } else {
          lines.set(key, [[lo, hi, edgeIndex]]);
        }
      }
    });
    const pairs = new Set<number>();
    const sharing = new Set<GEdge>();
    const edgeCount = layout.edges.length;
    for (const list of lines.values()) {
      list.sort((first, second) => first[0] - second[0]);
      for (let firstIndex = 0; firstIndex < list.length; firstIndex++) {
        const [, hi, firstEdge] = list[firstIndex]!;
        for (let secondIndex = firstIndex + 1; secondIndex < list.length && list[secondIndex]![0] < hi; secondIndex++) {
          const secondEdge = list[secondIndex]![2];
          if (firstEdge === secondEdge) continue;
          pairs.add(Math.min(firstEdge, secondEdge) * edgeCount + Math.max(firstEdge, secondEdge));
          sharing.add(layout.edges[firstEdge]!).add(layout.edges[secondEdge]!);
        }
      }
    }
    return { shared: pairs.size, sharing };
  }

  private straightRises(): Set<GEdge> {
    const out = new Set<GEdge>();
    for (const node of this.layout.nodes) {
      const xs = ChannelRouter.riseSlots(node).map(Math.round), nodeBottom = node.box.y + node.box.height;
      for (const edge of ChannelRouter.risesInto(node)) {
        const [beforeLast, last] = edge.points.slice(-2);
        if (beforeLast && last && (edge.source.host ? xs.includes(last.x) : last.x === xs[0]) && last.y === nodeBottom && beforeLast.x === last.x && (edge.source.host ? beforeLast.y >= ChannelRouter.riseFrom(edge) - 1 : Math.abs(beforeLast.y - ChannelRouter.riseFrom(edge)) <= 1)) {
          out.add(edge);
        }
      }
    }
    return out;
  }
}
