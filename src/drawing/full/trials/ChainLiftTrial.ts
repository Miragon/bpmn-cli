import type { GEdge, GNode, ScopeLayout } from '../scopes/GNode.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import { ArrangementTrial, type Routes } from './ArrangementTrial.js';

interface Lift {
  chain: GNode[];
  row: number;
  flow: GEdge;
}

interface Cells {
  all: Set<string>;
  nodes: Set<string>;
}

type LanePlace = [lane: number, row: number];

export class ChainLiftTrial extends ArrangementTrial {
  private readonly laneOf = new Map<GNode, number>();
  private readonly tried = new Set<GNode>();

  constructor(
    layout: ScopeLayout,
    private readonly arrange: () => void,
  ) {
    super(layout);
  }

  private static cell(lane: number, row: number, layer: number): string {
    return `${lane}/${row}/${layer}`;
  }

  private static isAbove(upper: LanePlace, lower: LanePlace): boolean {
    return upper[0] < lower[0] || (upper[0] === lower[0] && upper[1] < lower[1]);
  }

  private static setRow(node: GNode, row: number): void {
    node.row = row;
    for (const event of node.boundary) {
      event.row = row;
    }
  }

  run(): void {
    const { layout } = this;
    if (!layout.laneBands?.length) {
      return;
    }
    layout.laneBands.forEach((band, laneIndex) => {
      for (const node of band.nodes) {
        this.laneOf.set(node, laneIndex);
      }
    });
    let routed: Routes | undefined;
    for (;;) {
      const cells = this.occupied();
      const lift = this.nextLift(cells.all);
      if (!lift) {
        return;
      }
      this.tried.add(lift.chain[0]!);
      routed ??= this.routesOf(true);
      if (!this.bendsRise(lift, routed, cells.nodes)) {
        routed = this.attempt(lift, routed);
      }
    }
  }

  private lane(node: GNode): number {
    return this.laneOf.get(node) ?? 0;
  }

  private occupied(): Cells {
    const { nodes, edges } = this.layout;
    const all = new Set(nodes.map((node) => ChainLiftTrial.cell(this.lane(node), node.row, node.layer)));
    const nodeCells = new Set(all);
    for (const { back, source, target } of edges) {
      if (!back && !source.host && source.row === target.row && this.lane(source) === this.lane(target)) {
        for (let layer = source.layer + 1; layer < target.layer; layer++) {
          all.add(ChainLiftTrial.cell(this.lane(source), source.row, layer));
        }
      }
    }
    return { all, nodes: nodeCells };
  }

  private static isFree(cells: ReadonlySet<string>, lane: number, row: number, from: number, to: number): boolean {
    for (let layer = from; layer <= to; layer++) {
      if (cells.has(ChainLiftTrial.cell(lane, row, layer))) {
        return false;
      }
    }
    return true;
  }

  private nextLift(cells: ReadonlySet<string>): Lift | undefined {
    const open = this.layout.nodes.filter((node) => !this.tried.has(node) && !node.compensatedBy).sort((first, second) => first.layer - second.layer || first.row - second.row);
    for (const candidate of open) {
      const flow = candidate.in.find((edge) => this.liftsAlong(edge, candidate, cells));
      if (flow) {
        return { chain: this.chainOf(candidate, flow.source.row, cells), row: flow.source.row, flow };
      }
    }
    return undefined;
  }

  private liftsAlong(edge: GEdge, candidate: GNode, cells: ReadonlySet<string>): boolean {
    const { source } = edge;
    const lane = this.lane(candidate);
    return !edge.back && !source.host && this.lane(source) === lane && source.row < candidate.row && source.layer < candidate.layer && ChainLiftTrial.isFree(cells, lane, source.row, source.layer + 1, candidate.layer);
  }

  private chainOf(candidate: GNode, row: number, cells: ReadonlySet<string>): GNode[] {
    const chain = [candidate];
    for (let next = this.nextInChain(candidate, candidate, row, chain, cells); next; next = this.nextInChain(next, candidate, row, chain, cells)) {
      chain.push(next);
    }
    return chain;
  }

  private nextInChain(from: GNode, candidate: GNode, row: number, chain: readonly GNode[], cells: ReadonlySet<string>): GNode | undefined {
    const lane = this.lane(candidate);
    let next: GNode | undefined;
    for (const { back, target } of from.out) {
      const follows = !back && target.row === candidate.row && this.lane(target) === lane && target.layer > from.layer && !target.compensatedBy && !chain.includes(target);
      if (follows && ChainLiftTrial.isFree(cells, lane, row, from.layer + 1, target.layer) && (!next || target.layer < next.layer)) {
        next = target;
      }
    }
    return next;
  }

  private bendsRise(lift: Lift, before: Routes, nodeCells: ReadonlySet<string>): boolean {
    const moved = new Set(lift.chain);
    return [...before.rises].some((edge) => {
      if (edge.source.host || edge.bandY !== undefined) {
        return false;
      }
      return moved.has(edge.source) === moved.has(edge.target) ? !moved.has(edge.source) && this.chainCoversRise(edge, lift) : this.rowBlocksEnds(edge, lift, moved, nodeCells);
    });
  }

  private rowBlocksEnds({ source, target }: GEdge, { chain, row }: Lift, moved: ReadonlySet<GNode>, nodeCells: ReadonlySet<string>): boolean {
    const lane = this.lane(chain[0]!);
    const stayer = moved.has(source) ? target : source;
    const mover = stayer === source ? target : source;
    if (this.lane(stayer) !== lane || stayer.row !== row) {
      return false;
    }
    for (let layer = Math.min(mover.layer, stayer.layer) + 1; layer < Math.max(mover.layer, stayer.layer); layer++) {
      if (nodeCells.has(ChainLiftTrial.cell(lane, row, layer))) {
        return true;
      }
    }
    return false;
  }

  private chainCoversRise({ source, target }: GEdge, { chain, row }: Lift): boolean {
    const riseX = target.riseX();
    const to: LanePlace = [this.lane(chain[0]!), row];
    return chain.some((member) => member.box.x < riseX && riseX < member.box.right) && ChainLiftTrial.isAbove([this.lane(target), target.row], to) && !ChainLiftTrial.isAbove([this.lane(source), source.row], to);
  }

  private attempt(lift: Lift, before: Routes): Routes {
    const checkpoint = new ArrangementCheckpoint(this.layout);
    for (const member of lift.chain) {
      ChainLiftTrial.setRow(member, lift.row);
    }
    this.arrange();
    const after = this.routesOf(true);
    if (this.keeps(lift, before, after)) {
      return after;
    }
    checkpoint.restore();
    return before;
  }

  private keeps({ chain, flow }: Lift, before: Routes, after: Routes): boolean {
    const moved = new Set(chain);
    const noFault = after.crossings <= before.crossings && after.hits <= before.hits && after.labels <= before.labels && after.shared <= before.shared;
    const flowIsFreed = after.straight.has(flow) && !after.sharing.has(flow);
    const risesStay = [...before.rises].every((edge) => after.rises.has(edge) || after.straight.has(edge));
    const straightStay = [...before.straight].every((edge) => after.straight.has(edge) || moved.has(edge.source) || moved.has(edge.target));
    return flowIsFreed && after.straight.size > before.straight.size && after.bends <= before.bends && noFault && risesStay && straightStay;
  }
}
