import { LayoutDebug } from '../LayoutDebug.js';
import type { GEdge, GNode, ScopeLayout } from '../../di/types.js';
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
    lanes.forEach((band, laneIndex) => {
      for (const node of band.nodes) laneOf.set(node, laneIndex);
    });
    const lane = (node: GNode): number => laneOf.get(node) ?? 0;
    const tried = new Set<GNode>();
    const show = (routes: Routes): string => this.showRoutes(routes, true);
    const setRow = (node: GNode, row: number): void => {
      node.row = row;
      for (const boundaryEvent of node.boundary) boundaryEvent.row = row;
    };
    let routed: Routes | undefined;
    for (;;) {
      // a flow along a row occupies the cells it passes, like a node
      const cells = new Set<string>();
      const cell = (lane: number, row: number, layer: number): string => `${lane}/${row}/${layer}`;
      for (const node of layout.nodes) cells.add(cell(lane(node), node.row, node.layer));
      const nodeCells = new Set(cells);
      for (const edge of layout.edges) {
        const source = edge.source, target = edge.target;
        if (edge.back || source.host || source.row !== target.row || lane(source) !== lane(target)) continue;
        for (let layer = source.layer + 1; layer < target.layer; layer++) cells.add(cell(lane(source), source.row, layer));
      }
      const free = (lane: number, row: number, from: number, to: number): boolean => {
        for (let layer = from; layer <= to; layer++) if (cells.has(cell(lane, row, layer))) return false;
        return true;
      };
      const open = layout.nodes.filter((node) => !tried.has(node) && !node.compensatedBy).sort((first, second) => first.layer - second.layer || first.row - second.row);
      let lift: { chain: GNode[]; row: number; flow: GEdge } | undefined;
      for (const candidate of open) {
        const flow = candidate.in.find((edge) => !edge.back && !edge.source.host && lane(edge.source) === lane(candidate) && edge.source.row < candidate.row && edge.source.layer < candidate.layer && free(lane(candidate), edge.source.row, edge.source.layer + 1, candidate.layer));
        if (!flow) continue;
        const row = flow.source.row;
        const chain = [candidate];
        for (let cur: GNode | undefined = candidate; cur; ) {
          const from: GNode = cur;
          cur = undefined;
          for (const edge of from.out) {
            const target = edge.target;
            if (edge.back || target.row !== candidate.row || lane(target) !== lane(candidate) || target.layer <= from.layer || target.compensatedBy || chain.includes(target) || !free(lane(candidate), row, from.layer + 1, target.layer)) continue;
            if (!cur || target.layer < cur.layer) cur = target;
          }
          if (cur) chain.push(cur);
        }
        lift = { chain, row, flow };
        break;
      }
      if (!lift) break;
      const head = lift.chain[0]!;
      tried.add(head);
      const before = (routed ??= this.routesOf(true));
      const moved = new Set(lift.chain);
      /**
       * A lift that certainly bends a straight rise could never be kept, so it is not tried.
       * A boundary event's rise does not count: it may rise at another slot.
       */
      const row = lift.row;
      const above = (upper: [number, number], lower: [number, number]): boolean => upper[0] < lower[0] || (upper[0] === lower[0] && upper[1] < lower[1]);
      const to: [number, number] = [lane(head), row];
      const bent = [...before.rises].find((edge) => {
        const source = edge.source, target = edge.target;
        if (source.host || edge.bandY !== undefined) return false;
        if (moved.has(source) !== moved.has(target)) {
          const stayer = moved.has(source) ? target : source, mover = stayer === source ? target : source;
          if (lane(stayer) !== lane(head) || stayer.row !== row) return false;
          for (let layer = Math.min(mover.layer, stayer.layer) + 1; layer < Math.max(mover.layer, stayer.layer); layer++) if (nodeCells.has(cell(lane(head), row, layer))) return true;
          return false;
        }
        if (moved.has(source)) return false;
        const riseX = ChannelRouter.riseX(target);
        return lift.chain.some((member) => member.box.x < riseX && riseX < member.box.x + member.box.width) && above([lane(target), target.row], to) && !above([lane(source), source.row], to);
      });
      if (bent) {
        if (LayoutDebug.on()) LayoutDebug.log(`[lifts] ${head.id} stays: ${bent.id} would no longer rise straight`);
        continue;
      }
      const checkpoint = new ArrangementCheckpoint(layout);
      for (const member of lift.chain) setRow(member, lift.row);
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
        [...before.rises].every((edge) => after.rises.has(edge) || after.straight.has(edge)) &&
        [...before.straight].every((edge) => after.straight.has(edge) || moved.has(edge.source) || moved.has(edge.target));
      if (LayoutDebug.on()) LayoutDebug.log(`[lifts] ${head.id} ${keep ? `moves up onto row ${lift.row}` : 'stays'}${lift.chain.length > 1 ? ` (with ${lift.chain.slice(1).map((member) => member.id).join(', ')})` : ''}: ${show(before)} -> ${show(after)}`);
      if (keep) routed = after;
      else checkpoint.restore();
    }
  }
}
