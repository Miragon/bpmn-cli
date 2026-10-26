import { LayoutDebug } from '../LayoutDebug.js';
import type { GEdge, GNode, ScopeLayout } from '../../di/types.js';
import { outgoingOf } from '../../utils/nodes.js';

interface Branch {
  /** origin node id; '#spine' / '#comp-*' for chains without origin */
  owner: string;
  from: number;
  to: number;
  row: number;
  originRow: number;
  dropColumn: number;
  nodes: GNode[];
  /** empty band: the skip edge it is reserved for */
  edge?: GEdge;
}

/** Keyed by the columns without JoinColumnTrial's moves, so every arrangement shares it. */
const reaches = new WeakMap<ReadonlyMap<GNode, number>, Map<GNode, number>>();

/**
 * Assigns rows: row 0 is the spine, the path reaching farthest by the columns without moves.
 * Every other branch becomes a band below its origin: the first free row its drop line reaches,
 * else a band inserted between rows, else the first row with a free interval.
 */
export class RowAssigner {
  private readonly placed = new Set<GNode>();
  private readonly branches: Branch[] = [];
  /** a placed branch only moves down, so the lowest row is the deepest one yet */
  private readonly rows = new Map<number, Branch[]>();
  private lowest = -1;
  private readonly byDrop = new Map<number, Branch[]>();
  /** without the moves: a moved node keeps its chain */
  private readonly reachMemo: Map<GNode, number>;
  private readonly chainNext = new Map<GNode, GNode>();
  private readonly queue: Array<{ origin: GNode; first: GNode }> = [];

  constructor(
    private readonly layout: ScopeLayout,
    private readonly groups: ReadonlyMap<string, readonly string[]> | undefined,
    private readonly natural: ReadonlyMap<GNode, number>,
  ) {
    this.reachMemo = reaches.get(natural) ?? new Map<GNode, number>();
    reaches.set(natural, this.reachMemo);
  }

  assign(): void {
    const { nodes } = this.layout;
    const { placed, queue } = this;
    const starts = nodes.filter((node) => node.kind === 'start');
    const sources = nodes.filter((node) => node.in.length === 0 && node.kind !== 'start');
    const roots = [...this.groupedOrder([...starts, ...sources], nodes, this.groups), ...nodes];
    const maxLayer = Math.max(0, ...nodes.map((node) => node.layer));
    let first = true;
    for (const root of roots) {
      if (placed.has(root)) continue;
      const rootChain = this.chain(root);
      if (first) {
        this.commit({ owner: '#spine', from: 0, to: maxLayer, row: 0, originRow: -1, dropColumn: -1, nodes: rootChain.nodes }, 0);
        first = false;
      } else {
        const from = Math.min(...rootChain.nodes.map((node) => node.layer));
        const to = Math.max(...rootChain.nodes.map((node) => node.layer), rootChain.join?.layer ?? 0);
        this.place({ owner: `#comp-${root.id}`, from, to, row: 0, originRow: -1, dropColumn: -1, nodes: rootChain.nodes });
      }
      this.enqueueBranches(rootChain.nodes);
      while (queue.length) {
        const { origin, first: firstNode } = queue.shift()!;
        if (placed.has(firstNode)) continue;
        const c2 = this.chain(firstNode);
        const from = origin.layer;
        const to = Math.max(...c2.nodes.map((node) => node.layer), c2.join?.layer ?? 0);
        this.place({ owner: origin.id, from, to, row: 0, originRow: origin.row, dropColumn: origin.layer, nodes: c2.nodes });
        this.enqueueBranches(c2.nodes);
      }
    }
    for (const node of nodes) for (const boundaryEvent of node.boundary) boundaryEvent.row = node.row;
  }

  private debug(msg: string): void {
    if (LayoutDebug.on()) LayoutDebug.log(`[rows] ${msg}`);
  }

  private overlapsRange(range: { from: number; to: number }, other: { from: number; to: number }): boolean {
    return range.from <= other.to && other.from <= range.to;
  }

  private loopsBackOnly(node: GNode): boolean {
    const out = outgoingOf(node);
    return out.length > 0 && out.every((edge) => edge.back);
  }

  private inRow(row: number): Branch[] {
    return this.rows.get(row) ?? [];
  }

  private maxRow(): number {
    return this.lowest;
  }

  private dropPasses(branch: Branch, row: number): boolean {
    return branch.originRow < row && row < branch.row;
  }

  private intervalFree(row: number, iv: Branch): boolean {
    return !this.inRow(row).some((other) => this.overlapsRange(other, iv));
  }

  private dropFree(row: number, iv: Branch): boolean {
    for (let passedRow = iv.originRow + 1; passedRow < row; passedRow++) {
      if (this.inRow(passedRow).some((other) => other.owner !== iv.owner && other.from <= iv.dropColumn && iv.dropColumn <= other.to)) return false;
    }
    return true;
  }

  private setRow(iv: Branch, row: number): void {
    iv.row = row;
    for (const node of iv.nodes) node.row = row;
    if (iv.edge) iv.edge.bandRow = row;
  }

  private enter(iv: Branch): void {
    const list = this.rows.get(iv.row);
    if (list) list.push(iv);
    else this.rows.set(iv.row, [iv]);
    this.lowest = Math.max(this.lowest, iv.row);
  }

  private move(iv: Branch, row: number): void {
    const list = this.rows.get(iv.row)!;
    list.splice(list.indexOf(iv), 1);
    this.setRow(iv, row);
    this.enter(iv);
  }

  private commit(iv: Branch, row: number): void {
    this.setRow(iv, row);
    for (const node of iv.nodes) node.band = this.branches.length;
    this.branches.push(iv);
    const list = this.byDrop.get(iv.dropColumn);
    if (list) list.push(iv);
    else this.byDrop.set(iv.dropColumn, [iv]);
    this.enter(iv);
  }

  /** Shifts only the colliding bands down (transitively); false when a drop line would be cut. */
  private tryInsert(at: number, iv: Branch): boolean {
    const moving = new Map<Branch, number>(); // branch -> new row
    const queue: Branch[] = this.inRow(at).filter((other) => this.overlapsRange(other, iv));
    for (const other of queue) moving.set(other, at + 1);
    while (queue.length) {
      const moved = queue.shift()!;
      const newRow = moving.get(moved)!;
      for (const other of this.inRow(newRow)) {
        if (moving.has(other) || !this.overlapsRange(other, moved)) continue;
        moving.set(other, newRow + 1);
        queue.push(other);
      }
    }
    const cuts = (branch: Branch): boolean => !moving.has(branch) && this.dropPasses(branch, at) && iv.from <= branch.dropColumn && branch.dropColumn <= iv.to;
    if (iv.to - iv.from < this.branches.length) {
      for (let column = iv.from; column <= iv.to; column++) if (this.byDrop.get(column)?.some(cuts)) return false;
    } else if (this.branches.some(cuts)) return false;
    // a moved band's drop line now also passes row `at`
    for (const [branch] of moving) {
      if (branch.originRow < at && iv.from <= branch.dropColumn && branch.dropColumn <= iv.to) return false;
    }
    for (let passedRow = iv.originRow + 1; passedRow < at; passedRow++) {
      if (this.inRow(passedRow).some((other) => !moving.has(other) && other.owner !== iv.owner && other.from <= iv.dropColumn && iv.dropColumn <= other.to)) return false;
    }
    for (const [branch, newRow] of moving) this.move(branch, newRow);
    this.commit(iv, at);
    return true;
  }

  private place(iv: Branch): void {
    const limit = this.maxRow() + 1;
    for (let row = iv.originRow + 1; row <= limit; row++) {
      if (this.intervalFree(row, iv) && this.dropFree(row, iv)) {
        this.commit(iv, row);
        this.debug(`${iv.owner} [${iv.from}..${iv.to}] from row ${iv.originRow} -> row ${row}`);
        return;
      }
    }
    for (let at = iv.originRow + 1; at <= limit; at++) {
      if (this.tryInsert(at, iv)) {
        this.debug(`${iv.owner} [${iv.from}..${iv.to}] from row ${iv.originRow} -> inserted row ${at}`);
        return;
      }
    }
    for (let row = iv.originRow + 1; ; row++) {
      if (this.intervalFree(row, iv)) {
        this.commit(iv, row);
        this.debug(`${iv.owner} [${iv.from}..${iv.to}] from row ${iv.originRow} -> fallback row ${row}`);
        return;
      }
    }
  }

  private reach(node: GNode): number {
    const known = this.reachMemo.get(node);
    if (known !== undefined) return known;
    const layer = this.natural.get(node) ?? node.layer;
    this.reachMemo.set(node, layer);
    let best = layer;
    for (const edge of outgoingOf(node)) if (!edge.back) best = Math.max(best, this.reach(edge.target));
    this.reachMemo.set(node, best);
    return best;
  }

  /** Follows unplaced forward flows, farthest reach first, up to the join it runs into. */
  private chain(start: GNode): { nodes: GNode[]; join?: GNode } {
    const { placed, chainNext } = this;
    const out: GNode[] = [];
    let cur: GNode | undefined = start;
    while (cur && !placed.has(cur)) {
      out.push(cur);
      placed.add(cur);
      // only the node's own flows continue the chain: boundary handlers are bands below the host
      const candidates: GEdge[] = cur.out.filter((edge) => !edge.back && !placed.has(edge.target));
      let next: GNode | undefined;
      let bestReach = -1;
      for (const edge of candidates) {
        const targetReach = this.loopsBackOnly(edge.target) ? -0.5 : this.reach(edge.target);
        if (targetReach > bestReach) {
          bestReach = targetReach;
          next = edge.target;
        }
      }
      if (!next) {
        const join = cur.out.find((edge) => !edge.back && placed.has(edge.target))?.target;
        if (join) chainNext.set(cur, join);
        return { nodes: out, join };
      }
      chainNext.set(cur, next);
      cur = next;
    }
    return { nodes: out, join: cur };
  }

  private enqueueBranches(chainNodes: GNode[]): void {
    const { placed, queue } = this;
    // regular branches first, so they get the rows right below the chain
    for (const node of chainNodes) {
      for (const edge of node.out) {
        if (edge.back) continue;
        if (!placed.has(edge.target)) queue.push({ origin: node, first: edge.target });
        else if (edge.target !== this.chainNext.get(node) && edge.target.row === node.row && edge.target.layer > node.layer + 1 && node.out.length > 1) {
          // empty branch / skip: a band of its own, entering the join from below
          const iv: Branch = { owner: node.id, from: node.layer, to: edge.target.layer, row: 0, originRow: node.row, dropColumn: node.layer, nodes: [], edge };
          this.place(iv);
        }
      }
    }
    for (const node of chainNodes) {
      for (const edge of node.boundary.flatMap((boundaryEvent) => boundaryEvent.out)) {
        if (edge.back || placed.has(edge.target)) continue;
        queue.push({ origin: node, first: edge.target });
      }
      for (const boundaryEvent of node.boundary) {
        if (boundaryEvent.compensationHandler && !placed.has(boundaryEvent.compensationHandler)) queue.push({ origin: node, first: boundaryEvent.compensationHandler });
      }
    }
  }

  /** Each weakly connected part takes the groups of its first node a group box held. */
  private partGroups(nodes: GNode[], groups: ReadonlyMap<string, readonly string[]>): Map<GNode, readonly string[]> {
    const unit = (node: GNode): GNode => node.host ?? node;
    const partOf = new Map<GNode, GNode[]>();
    for (const node of nodes) {
      if (partOf.has(node)) continue;
      const part: GNode[] = [node];
      partOf.set(node, part);
      for (let index = 0; index < part.length; index++) {
        const member = part[index]!;
        const next = [...member.out.map((edge) => edge.target), ...member.in.map((edge) => edge.source)];
        for (const boundaryEvent of member.boundary) next.push(...boundaryEvent.out.map((edge) => edge.target), ...(boundaryEvent.compensationHandler ? [boundaryEvent.compensationHandler] : []));
        if (member.compensatedBy) next.push(member.compensatedBy);
        for (const neighbour of next.map(unit)) {
          if (partOf.has(neighbour)) continue;
          partOf.set(neighbour, part);
          part.push(neighbour);
        }
      }
    }
    const out = new Map<GNode, readonly string[]>();
    const found = new Set<GNode[]>();
    for (const node of nodes) {
      const part = partOf.get(node)!;
      if (found.has(part)) continue;
      const path = [node, ...node.boundary].map((member) => groups.get(member.id)).find((groupPath) => groupPath?.length);
      if (!path) continue;
      found.add(part);
      for (const member of part) out.set(member, path);
    }
    return out;
  }

  /** Moves the roots of one group up behind its first root, nested groups likewise; stable. */
  private groupedOrder(list: GNode[], nodes: GNode[], groups: ReadonlyMap<string, readonly string[]> | undefined): GNode[] {
    if (!groups?.size || list.length < 2) return list;
    const pathOf = this.partGroups(nodes, groups);
    const first = new Map<string, number>();
    const keys = new Map<GNode, number[]>();
    list.forEach((node, index) => {
      let path = '';
      const key: number[] = [];
      for (const group of pathOf.get(node.host ?? node) ?? []) {
        path += `/${group}`;
        if (!first.has(path)) first.set(path, index);
        key.push(first.get(path)!);
      }
      keys.set(node, [...key, index]);
    });
    const compare = (leftKey: number[], rightKey: number[]): number => {
      for (let index = 0; index < Math.min(leftKey.length, rightKey.length); index++) if (leftKey[index] !== rightKey[index]) return leftKey[index]! - rightKey[index]!;
      return leftKey.length - rightKey.length;
    };
    return [...list].sort((leftNode, rightNode) => compare(keys.get(leftNode)!, keys.get(rightNode)!));
  }
}
