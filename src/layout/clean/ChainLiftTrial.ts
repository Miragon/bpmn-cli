import { LayoutDebug } from '../LayoutDebug.js';
import type { GEdge, GNode, ScopeLayout } from '../../drawing/types.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { ChannelRouter } from './ChannelRouter.js';

/**
 * In a laned process, lifts a node and the chain after it onto the row of its predecessor in
 * the same lane when those cells are free, so the flow into it runs straight. A lift is kept
 * only when the routes draw better and the happy path stays straight; otherwise it is undone.
 */
export class ChainLiftTrial extends ArrangementTrial {
  constructor(
    layout: ScopeLayout,
    private readonly arrange: () => void,
  ) {
    super(layout);
  }

  run(): void {
    const { layout, arrange } = this;
    const lanes = layout.laneBands;
    if (!lanes?.length) return;
    const laneOf = new Map<GNode, number>();
    lanes.forEach((b, i) => {
      for (const n of b.nodes) laneOf.set(n, i);
    });
    const lane = (n: GNode): number => laneOf.get(n) ?? 0;
    const tried = new Set<GNode>();
    const show = (r: Routes): string => this.showRoutes(r, true);
    const setRow = (n: GNode, row: number): void => {
      n.row = row;
      for (const b of n.boundary) b.row = row;
    };
    let routed: Routes | undefined;
    for (;;) {
      // a flow along a row occupies the cells it passes, like a node
      const cells = new Set<string>();
      const cell = (lane: number, row: number, layer: number): string => `${lane}/${row}/${layer}`;
      for (const n of layout.nodes) cells.add(cell(lane(n), n.row, n.layer));
      const nodeCells = new Set(cells);
      for (const e of layout.edges) {
        const s = e.source, t = e.target;
        if (e.back || s.host || s.row !== t.row || lane(s) !== lane(t)) continue;
        for (let l = s.layer + 1; l < t.layer; l++) cells.add(cell(lane(s), s.row, l));
      }
      const free = (lane: number, row: number, from: number, to: number): boolean => {
        for (let l = from; l <= to; l++) if (cells.has(cell(lane, row, l))) return false;
        return true;
      };
      const open = layout.nodes.filter((n) => !tried.has(n) && !n.compensatedBy).sort((a, b) => a.layer - b.layer || a.row - b.row);
      let lift: { chain: GNode[]; row: number; flow: GEdge } | undefined;
      for (const n of open) {
        const flow = n.in.find((e) => !e.back && !e.source.host && lane(e.source) === lane(n) && e.source.row < n.row && e.source.layer < n.layer && free(lane(n), e.source.row, e.source.layer + 1, n.layer));
        if (!flow) continue;
        const row = flow.source.row;
        const chain = [n];
        for (let cur: GNode | undefined = n; cur; ) {
          const from: GNode = cur;
          cur = undefined;
          for (const e of from.out) {
            const t = e.target;
            if (e.back || t.row !== n.row || lane(t) !== lane(n) || t.layer <= from.layer || t.compensatedBy || chain.includes(t) || !free(lane(n), row, from.layer + 1, t.layer)) continue;
            if (!cur || t.layer < cur.layer) cur = t;
          }
          if (cur) chain.push(cur);
        }
        lift = { chain, row, flow };
        break;
      }
      if (!lift) break;
      const n = lift.chain[0]!;
      tried.add(n);
      const before = (routed ??= this.routesOf(true));
      const moved = new Set(lift.chain);
      /**
       * A lift that certainly bends a straight rise could never be kept, so it is not tried.
       * A boundary event's rise does not count: it may rise at another slot.
       */
      const row = lift.row;
      const above = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
      const to: [number, number] = [lane(n), row];
      const bent = [...before.rises].find((e) => {
        const s = e.source, t = e.target;
        if (s.host || e.bandY !== undefined) return false;
        if (moved.has(s) !== moved.has(t)) {
          const o = moved.has(s) ? t : s, m = o === s ? t : s;
          if (lane(o) !== lane(n) || o.row !== row) return false;
          for (let l = Math.min(m.layer, o.layer) + 1; l < Math.max(m.layer, o.layer); l++) if (nodeCells.has(cell(lane(n), row, l))) return true;
          return false;
        }
        if (moved.has(s)) return false;
        const x = ChannelRouter.riseX(t);
        return lift.chain.some((m) => m.box.x < x && x < m.box.x + m.box.width) && above([lane(t), t.row], to) && !above([lane(s), s.row], to);
      });
      if (bent) {
        if (LayoutDebug.on()) LayoutDebug.log(`[lifts] ${n.id} stays: ${bent.id} would no longer rise straight`);
        continue;
      }
      const checkpoint = new ArrangementCheckpoint(layout);
      for (const m of lift.chain) setRow(m, lift.row);
      arrange();
      const after = this.routesOf(true);
      const keep =
        after.straight.has(lift.flow) &&
        after.straight.size > before.straight.size &&
        after.bends <= before.bends &&
        after.crossings <= before.crossings &&
        after.hits <= before.hits &&
        after.labels <= before.labels &&
        after.shared <= before.shared &&
        !after.sharing.has(lift.flow) &&
        [...before.rises].every((e) => after.rises.has(e) || after.straight.has(e)) &&
        [...before.straight].every((e) => after.straight.has(e) || moved.has(e.source) || moved.has(e.target));
      if (LayoutDebug.on()) LayoutDebug.log(`[lifts] ${n.id} ${keep ? `moves up onto row ${lift.row}` : 'stays'}${lift.chain.length > 1 ? ` (with ${lift.chain.slice(1).map((m) => m.id).join(', ')})` : ''}: ${show(before)} -> ${show(after)}`);
      if (keep) routed = after;
      else checkpoint.restore();
    }
  }
}
