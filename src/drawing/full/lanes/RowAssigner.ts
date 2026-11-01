import type { GEdge, GNode, ScopeLayout } from '../scopes/GNode.js';
import { RowBranches } from './RowBranches.js';
import { RowGroups } from './RowGroups.js';

interface Chain {
  nodes: GNode[];
  join?: GNode | undefined;
}

export class RowAssigner {
  private static readonly reaches = new WeakMap<ReadonlyMap<GNode, number>, Map<GNode, number>>();
  private static readonly LOOP_BACK_REACH = -0.5;

  private readonly placed = new Set<GNode>();
  private readonly branches = new RowBranches();
  private readonly reachMemo: Map<GNode, number>;
  private readonly chainNext = new Map<GNode, GNode>();
  private readonly queue: Array<{ origin: GNode; first: GNode }> = [];

  constructor(
    private readonly layout: ScopeLayout,
    private readonly groups: ReadonlyMap<string, readonly string[]> | undefined,
    private readonly natural: ReadonlyMap<GNode, number>,
  ) {
    this.reachMemo = RowAssigner.reaches.get(natural) ?? new Map<GNode, number>();
    RowAssigner.reaches.set(natural, this.reachMemo);
  }

  private static loopsBackOnly(node: GNode): boolean {
    const out = node.outgoing;
    return out.length > 0 && out.every((edge) => edge.back);
  }

  private static farthest({ nodes, join }: Chain): number {
    return Math.max(...nodes.map((node) => node.layer), join?.layer ?? 0);
  }

  assign(): void {
    const { nodes } = this.layout;
    const starts = nodes.filter((node) => node.kind === 'start');
    const sources = nodes.filter((node) => node.in.length === 0 && node.kind !== 'start');
    const roots = [...new RowGroups(nodes, this.groups).ordered([...starts, ...sources]), ...nodes];
    let spineLeft = true;
    for (const root of roots) {
      if (!this.placed.has(root)) {
        this.placeRoot(root, spineLeft);
        spineLeft = false;
      }
    }
    for (const node of nodes) {
      for (const event of node.boundary) {
        event.row = node.row;
      }
    }
  }

  private placeRoot(root: GNode, spine: boolean): void {
    const chain = this.chain(root);
    if (spine) {
      const maxLayer = Math.max(0, ...this.layout.nodes.map((node) => node.layer));
      this.branches.commit({ owner: '#spine', from: 0, to: maxLayer, row: 0, originRow: -1, dropColumn: -1, nodes: chain.nodes }, 0);
    } else {
      const from = Math.min(...chain.nodes.map((node) => node.layer));
      this.branches.place({ owner: `#comp-${root.id}`, from, to: RowAssigner.farthest(chain), row: 0, originRow: -1, dropColumn: -1, nodes: chain.nodes });
    }
    this.enqueueBranches(chain.nodes);
    this.placeQueued();
  }

  private placeQueued(): void {
    const { queue, placed } = this;
    while (queue.length) {
      const { origin, first } = queue.shift()!;
      if (!placed.has(first)) {
        const chain = this.chain(first);
        this.branches.place({ owner: origin.id, from: origin.layer, to: RowAssigner.farthest(chain), row: 0, originRow: origin.row, dropColumn: origin.layer, nodes: chain.nodes });
        this.enqueueBranches(chain.nodes);
      }
    }
  }

  private reach(node: GNode): number {
    const known = this.reachMemo.get(node);
    if (known !== undefined) {
      return known;
    }
    const layer = this.natural.get(node) ?? node.layer;
    this.reachMemo.set(node, layer);
    let best = layer;
    for (const edge of node.outgoing) {
      if (!edge.back) {
        best = Math.max(best, this.reach(edge.target));
      }
    }
    this.reachMemo.set(node, best);
    return best;
  }

  private nextInChain(node: GNode): GNode | undefined {
    let next: GNode | undefined;
    let bestReach = -1;
    for (const { back, target } of node.out) {
      if (!back && !this.placed.has(target)) {
        const targetReach = RowAssigner.loopsBackOnly(target) ? RowAssigner.LOOP_BACK_REACH : this.reach(target);
        if (targetReach > bestReach) {
          bestReach = targetReach;
          next = target;
        }
      }
    }
    return next;
  }

  private chain(start: GNode): Chain {
    const { placed, chainNext } = this;
    const nodes: GNode[] = [];
    let current: GNode | undefined = start;
    while (current && !placed.has(current)) {
      nodes.push(current);
      placed.add(current);
      const next = this.nextInChain(current);
      if (!next) {
        const join = current.out.find((edge) => !edge.back && placed.has(edge.target))?.target;
        if (join) {
          chainNext.set(current, join);
        }
        return { nodes, join };
      }
      chainNext.set(current, next);
      current = next;
    }
    return { nodes, join: current };
  }

  private enqueueBranches(chainNodes: readonly GNode[]): void {
    for (const node of chainNodes) {
      for (const edge of node.out) {
        if (!edge.back) {
          this.enqueueFlow(node, edge);
        }
      }
    }
    for (const node of chainNodes) {
      this.enqueueBoundaryWays(node);
    }
  }

  private enqueueFlow(node: GNode, edge: GEdge): void {
    const { target } = edge;
    if (!this.placed.has(target)) {
      this.queue.push({ origin: node, first: target });
    } else if (target !== this.chainNext.get(node) && target.row === node.row && target.layer > node.layer + 1 && node.out.length > 1) {
      this.branches.place({ owner: node.id, from: node.layer, to: target.layer, row: 0, originRow: node.row, dropColumn: node.layer, nodes: [], edge });
    }
  }

  private enqueueBoundaryWays(node: GNode): void {
    const { placed, queue } = this;
    for (const edge of node.boundary.flatMap((event) => event.out)) {
      if (!edge.back && !placed.has(edge.target)) {
        queue.push({ origin: node, first: edge.target });
      }
    }
    for (const { compensationHandler } of node.boundary) {
      if (compensationHandler && !placed.has(compensationHandler)) {
        queue.push({ origin: node, first: compensationHandler });
      }
    }
  }
}
