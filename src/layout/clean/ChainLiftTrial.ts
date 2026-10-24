import { LayoutDebug } from '../../shared/LayoutDebug.js';
import type { GEdge, GNode, ScopeLayout } from '../../diagram/types.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';
import { EdgeRouter } from './EdgeRouter.js';

/**
 * In a process with lanes, after the rows are arranged by lane and the
 * columns freed (LaneArranger, after JoinColumnTrial): a node whose
 * flow comes from a node of its own lane on a row above (not a boundary
 * event's flow, not a loop) moves up onto that row when its cell there is
 * free: nothing of the lane in that row in its column or in a column
 * between the two, neither a node nor a flow between two nodes of the row
 * (the happy path's flow past the columns its nodes in other lanes leave
 * empty, an empty branch drawn straight). The nodes of its row and lane its
 * flows lead on to move with it, one after the other while their cells on
 * that row are free too (its chain). So the flow into it runs straight: a
 * split whose next column on its own row the happy path leaves empty (it
 * runs on in another lane) sends the branch whose first node is in its lane
 * out through its right vertex instead of dropping both from its bottom
 * vertex. A lane's rows are those of its nodes (`arrange`), so a row the
 * chain leaves empty closes. The move must draw better: the scope is routed
 * both ways (EdgeRouter) and the move is kept only when the flow
 * into the node is then one segment on no other flow's line, more flows are
 * one segment and no more bend, no more pairs of flows cross, share a piece
 * of line (sharedLines) or cut shapes, no more labels of shapes are run
 * through, every flow that rose straight into a node's bottom still does
 * or is one segment now (the rises JoinColumnTrial made stay), and every
 * flow of one segment not of a moved node stays one (so the happy path
 * stays straight); else it is undone exactly (ArrangementCheckpoint). A move that
 * certainly bends a flow rising straight now is not tried: one between a
 * node of the chain and a node of the new row past a node between them, or
 * one whose way up crosses the new row in the column of a node of the chain
 * (not a boundary event's: it may rise at another slot). One node at a
 * time, left to right (by column, then row, then the order of the nodes; of
 * a split's branches in its lane the upper one first, which takes the
 * cell), each tried once. `arrange` lays the rows of the scope out again by
 * lane (LaneArranger), from the nodes' rows; the scope is left
 * arranged as the last kept move left it (or as it came), not routed.
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
    /** the routes of the current arrangement, once measured */
    let routed: Routes | undefined;
    for (;;) {
      // the cells of each lane by row and column that hold a node, or that a flow between two nodes of the row runs through
      // (the happy path's flow past columns its nodes in other lanes leave empty, an empty branch drawn straight)
      const cells = new Set<string>();
      const cell = (lane: number, row: number, layer: number): string => `${lane}/${row}/${layer}`;
      for (const n of layout.nodes) cells.add(cell(lane(n), n.row, n.layer));
      const nodeCells = new Set(cells);
      for (const e of layout.edges) {
        const s = e.source, t = e.target;
        if (e.back || s.host || s.row !== t.row || lane(s) !== lane(t)) continue;
        for (let l = s.layer + 1; l < t.layer; l++) cells.add(cell(lane(s), s.row, l));
      }
      /** nothing of the lane in `row` from column `from` to `to` */
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
        // the nodes of its row and lane it leads on to, while their cells on the new row are free
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
      // a flow that rises straight now and that the move certainly bends (EdgeRouter): the move cannot be kept,
      // it is not tried. One between a node of the chain and one of the new row in its lane, past a node between the two
      // (a bypass); one from a node not below the new row into a node above it, in the column of a node of the chain
      // that moves between them (its way up cuts that node: a boundary event's may rise at another slot, not counted)
      const row = lift.row;
      /** lane, then row: the order of the rows from the top */
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
        const x = EdgeRouter.riseX(t);
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
