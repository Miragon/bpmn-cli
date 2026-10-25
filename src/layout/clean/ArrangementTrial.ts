import type { GEdge, ScopeLayout } from '../../drawing/types.js';
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
    for (const e of layout.edges) {
      if (e.points.length === 2) straight.add(e);
      bends += Math.max(0, e.points.length - 2);
    }
    const labels = new ScopeLabels(layout);
    const routes = { ...router.faults([...labels.shapes(), ...labels.data()]), rises: this.straightRises(), above: new Set(layout.edges.filter((e) => e.runsAbove)), straight, bends, ...(lines ? this.sharedLines() : { shared: 0, sharing: new Set<GEdge>() }) };
    look?.();
    checkpoint.restore();
    return routes;
  }

  protected showRoutes(r: Routes, lines = false): string {
    return JSON.stringify({ crossings: r.crossings, hits: r.hits, labels: r.labels, rises: r.rises.size, ...(r.above.size ? { above: r.above.size } : {}), ...(lines ? { straight: r.straight.size, bends: r.bends, shared: r.shared } : {}) });
  }

  /** Two segments on one line count as shared when they overlap by more than a point. */
  private sharedLines(): { shared: number; sharing: Set<GEdge> } {
    const { layout } = this;
    const lines = new Map<string, Array<[number, number, number]>>();
    layout.edges.forEach((e, i) => {
      for (let k = 0; k + 1 < e.points.length; k++) {
        const p = e.points[k]!, q = e.points[k + 1]!;
        const key = p.y === q.y ? `h${p.y}` : p.x === q.x ? `v${p.x}` : undefined;
        if (!key) continue;
        const [lo, hi] = p.y === q.y ? [Math.min(p.x, q.x), Math.max(p.x, q.x)] : [Math.min(p.y, q.y), Math.max(p.y, q.y)];
        const list = lines.get(key);
        if (list) list.push([lo, hi, i]);
        else lines.set(key, [[lo, hi, i]]);
      }
    });
    const pairs = new Set<number>();
    const sharing = new Set<GEdge>();
    const n = layout.edges.length;
    for (const list of lines.values()) {
      list.sort((a, b) => a[0] - b[0]);
      for (let a = 0; a < list.length; a++) {
        const [, hi, i] = list[a]!;
        for (let b = a + 1; b < list.length && list[b]![0] < hi; b++) {
          const j = list[b]![2];
          if (i === j) continue;
          pairs.add(Math.min(i, j) * n + Math.max(i, j));
          sharing.add(layout.edges[i]!).add(layout.edges[j]!);
        }
      }
    }
    return { shared: pairs.size, sharing };
  }

  private straightRises(): Set<GEdge> {
    const out = new Set<GEdge>();
    for (const j of this.layout.nodes) {
      const xs = ChannelRouter.riseSlots(j).map(Math.round), y = j.box.y + j.box.height;
      for (const e of ChannelRouter.risesInto(j)) {
        const [p, q] = e.points.slice(-2);
        if (p && q && (e.source.host ? xs.includes(q.x) : q.x === xs[0]) && q.y === y && p.x === q.x && (e.source.host ? p.y >= ChannelRouter.riseFrom(e) - 1 : Math.abs(p.y - ChannelRouter.riseFrom(e)) <= 1)) out.add(e);
      }
    }
    return out;
  }
}
