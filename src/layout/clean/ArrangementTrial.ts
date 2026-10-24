import type { GEdge, ScopeLayout } from '../../diagram/types.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { EdgeRouter } from './EdgeRouter.js';
import { ScopeLabels } from './ScopeLabels.js';

/**
 * How the routes of an arrangement run (JoinColumnTrial, ChainLiftTrial): EdgeRouter.faults, the straight rises, the
 * boundary events' ways over the top (GEdge.runsAbove), the flows of one segment, the bends of all and, when asked for (sharedLines), the pairs of flows that run on one line
 * (`shared`) and the flows that do (`sharing`).
 */
export type Routes = { crossings: number; hits: number; labels: number; rises: Set<GEdge>; above: Set<GEdge>; straight: Set<GEdge>; bends: number; shared: number; sharing: Set<GEdge> };

export abstract class ArrangementTrial {
  constructor(protected readonly layout: ScopeLayout) {}

  abstract run(): void;

  /**
   * The faults (crossings, cut shapes, labels of shapes and data run through) and straight rises of the routes the
   * current arrangement gets, the flows drawn as one segment and the bends of all, with `lines` the flows that share a
   * piece of line (sharedLines; else none); `look` sees the routed scope before it is left as it was.
   */
  protected routesOf(lines = false, look?: () => void): Routes {
    const { layout } = this;
    const checkpoint = new ArrangementCheckpoint(layout);
    const router = new EdgeRouter(layout);
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

  /** Routes as a debug line shows them: the counts (with `lines` those of the flows of one segment, the bends and the shared lines too). */
  protected showRoutes(r: Routes, lines = false): string {
    return JSON.stringify({ crossings: r.crossings, hits: r.hits, labels: r.labels, rises: r.rises.size, ...(r.above.size ? { above: r.above.size } : {}), ...(lines ? { straight: r.straight.size, bends: r.bends, shared: r.shared } : {}) });
  }

  /**
   * The pairs of routed flows that run on one line for a piece (two horizontal segments at one y, or two vertical ones
   * at one x, overlapping by more than a point: two branches out of one vertex, say, or the entries of a join on its
   * shared way in), and the flows of those pairs.
   */
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
      // by where they start: every piece that starts before one ends overlaps it
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

  /**
   * The routed flows that rise straight into a node's bottom (EdgeRouter.risesInto, riseX; a boundary event's also at
   * another of riseSlots), from their row or band (a boundary event's: from its run below the host's row; no hook).
   */
  private straightRises(): Set<GEdge> {
    const out = new Set<GEdge>();
    for (const j of this.layout.nodes) {
      const xs = EdgeRouter.riseSlots(j).map(Math.round), y = j.box.y + j.box.height;
      for (const e of EdgeRouter.risesInto(j)) {
        const [p, q] = e.points.slice(-2);
        if (p && q && (e.source.host ? xs.includes(q.x) : q.x === xs[0]) && q.y === y && p.x === q.x && (e.source.host ? p.y >= EdgeRouter.riseFrom(e) - 1 : Math.abs(p.y - EdgeRouter.riseFrom(e)) <= 1)) out.add(e);
      }
    }
    return out;
  }
}
