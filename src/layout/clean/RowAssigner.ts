import { LayoutDebug } from '../../shared/LayoutDebug.js';
import type { GEdge, GNode, ScopeLayout } from '../../diagram/types.js';
import { outgoingOf } from './utils/nodes.js';

interface Branch {
  /** id of the origin node (its column is the drop column); '#spine' / '#comp-*' for chains without origin */
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

/** the farthest layer reachable from each node, by the columns without the moves it is measured in. */
const reaches = new WeakMap<ReadonlyMap<GNode, number>, Map<GNode, number>>();

/**
 * Assigns rows. Row 0 is the spine (the path that reaches farthest, by the
 * columns without the moves of JoinColumnTrial: `natural`). Every
 * other branch (a chain of not yet placed nodes starting with a non-spine
 * outgoing flow) becomes a band below its origin:
 *  1. the first existing row below the origin where the column interval is
 *     free and the drop line from the origin passes no other band,
 *  2. else a new band inserted between existing ones, shifting down only the
 *     bands it collides with (transitively),
 *  3. else the first row where merely the interval is free (the router then
 *     bends the drop line around the obstacle).
 * A split flow that goes straight to an already placed node on the same row
 * (an empty branch, a skip) reserves an empty band the same way. Without
 * lanes the nodes between the two lie on that row, so the flow runs in its
 * band; in a laned scope they can lie in other lanes and the router draws
 * it straight when the row is free (EdgeRouter). There the band leaves no
 * strip: LaneArranger builds the rows of a lane from its nodes.
 */
export class RowAssigner {
  private readonly placed = new Set<GNode>();
  private readonly branches: Branch[] = [];
  /** the placed branches of each row (a placed branch only moves down: the lowest row is the deepest one yet) */
  private readonly rows = new Map<number, Branch[]>();
  private lowest = -1;
  /** the placed branches by their drop column */
  private readonly byDrop = new Map<number, Branch[]>();
  /**
   * farthest layer reachable from a node over forward edges (without the moves of JoinColumnTrial: a moved node keeps the
   * chains; the same for every arrangement of the scope, so kept with its columns without the moves)
   */
  private readonly reachMemo: Map<GNode, number>;
  /** the flow a node continues its chain with (the other flows are branches) */
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
    const starts = nodes.filter((n) => n.kind === 'start');
    const sources = nodes.filter((n) => n.in.length === 0 && n.kind !== 'start');
    const roots = [...this.groupedOrder([...starts, ...sources], nodes, this.groups), ...nodes];
    const maxLayer = Math.max(0, ...nodes.map((n) => n.layer));
    let first = true;
    for (const root of roots) {
      if (placed.has(root)) continue;
      const c = this.chain(root);
      if (first) {
        this.commit({ owner: '#spine', from: 0, to: maxLayer, row: 0, originRow: -1, dropColumn: -1, nodes: c.nodes }, 0);
        first = false;
      } else {
        const from = Math.min(...c.nodes.map((n) => n.layer));
        const to = Math.max(...c.nodes.map((n) => n.layer), c.join?.layer ?? 0);
        this.place({ owner: `#comp-${root.id}`, from, to, row: 0, originRow: -1, dropColumn: -1, nodes: c.nodes });
      }
      this.enqueueBranches(c.nodes);
      while (queue.length) {
        const { origin, first: firstNode } = queue.shift()!;
        if (placed.has(firstNode)) continue;
        const c2 = this.chain(firstNode);
        const from = origin.layer;
        const to = Math.max(...c2.nodes.map((n) => n.layer), c2.join?.layer ?? 0);
        this.place({ owner: origin.id, from, to, row: 0, originRow: origin.row, dropColumn: origin.layer, nodes: c2.nodes });
        this.enqueueBranches(c2.nodes);
      }
    }
    for (const n of nodes) for (const b of n.boundary) b.row = n.row;
  }

  private debug(msg: string): void {
    if (LayoutDebug.on()) LayoutDebug.log(`[rows] ${msg}`);
  }

  private overlapsRange(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
    return a.from <= b.to && b.from <= a.to;
  }

  /** True when every forward continuation of a node is a loop back (or the node has none but a loop). */
  private loopsBackOnly(n: GNode): boolean {
    const out = outgoingOf(n);
    return out.length > 0 && out.every((e) => e.back);
  }

  private inRow(row: number): Branch[] {
    return this.rows.get(row) ?? [];
  }

  private maxRow(): number {
    return this.lowest;
  }

  /** the drop line of `b` (excluding its ends) passes row `row` at its drop column */
  private dropPasses(b: Branch, row: number): boolean {
    return b.originRow < row && row < b.row;
  }

  private intervalFree(row: number, iv: Branch): boolean {
    return !this.inRow(row).some((o) => this.overlapsRange(o, iv));
  }

  private dropFree(row: number, iv: Branch): boolean {
    for (let r = iv.originRow + 1; r < row; r++) {
      if (this.inRow(r).some((o) => o.owner !== iv.owner && o.from <= iv.dropColumn && iv.dropColumn <= o.to)) return false;
    }
    return true;
  }

  private setRow(iv: Branch, row: number): void {
    iv.row = row;
    for (const n of iv.nodes) n.row = row;
    if (iv.edge) iv.edge.bandRow = row;
  }

  private enter(iv: Branch): void {
    const list = this.rows.get(iv.row);
    if (list) list.push(iv);
    else this.rows.set(iv.row, [iv]);
    this.lowest = Math.max(this.lowest, iv.row);
  }

  /** a placed branch moves to another row */
  private move(iv: Branch, row: number): void {
    const list = this.rows.get(iv.row)!;
    list.splice(list.indexOf(iv), 1);
    this.setRow(iv, row);
    this.enter(iv);
  }

  private commit(iv: Branch, row: number): void {
    this.setRow(iv, row);
    for (const n of iv.nodes) n.band = this.branches.length;
    this.branches.push(iv);
    const list = this.byDrop.get(iv.dropColumn);
    if (list) list.push(iv);
    else this.byDrop.set(iv.dropColumn, [iv]);
    this.enter(iv);
  }

  /** inserts a new band at `at` for `iv`, shifting only colliding bands down; false when a drop line would be cut */
  private tryInsert(at: number, iv: Branch): boolean {
    // bands that must move: those in row `at` overlapping the new band, then transitively the ones below them
    const moving = new Map<Branch, number>(); // branch -> new row
    const queue: Branch[] = this.inRow(at).filter((o) => this.overlapsRange(o, iv));
    for (const o of queue) moving.set(o, at + 1);
    while (queue.length) {
      const m = queue.shift()!;
      const newRow = moving.get(m)!;
      for (const o of this.inRow(newRow)) {
        if (moving.has(o) || !this.overlapsRange(o, m)) continue;
        moving.set(o, newRow + 1);
        queue.push(o);
      }
    }
    // a drop line of a band that stays must not be cut by the new band (those dropping in its columns)
    const cuts = (b: Branch): boolean => !moving.has(b) && this.dropPasses(b, at) && iv.from <= b.dropColumn && b.dropColumn <= iv.to;
    if (iv.to - iv.from < this.branches.length) {
      for (let c = iv.from; c <= iv.to; c++) if (this.byDrop.get(c)?.some(cuts)) return false;
    } else if (this.branches.some(cuts)) return false;
    // a moved band's drop line now also passes row `at`
    for (const [b] of moving) {
      if (b.originRow < at && iv.from <= b.dropColumn && b.dropColumn <= iv.to) return false;
    }
    // the own drop line must not be cut by bands staying between the origin and `at`
    for (let r = iv.originRow + 1; r < at; r++) {
      if (this.inRow(r).some((o) => !moving.has(o) && o.owner !== iv.owner && o.from <= iv.dropColumn && iv.dropColumn <= o.to)) return false;
    }
    for (const [b, newRow] of moving) this.move(b, newRow);
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

  private reach(n: GNode): number {
    const known = this.reachMemo.get(n);
    if (known !== undefined) return known;
    const layer = this.natural.get(n) ?? n.layer;
    this.reachMemo.set(n, layer);
    let best = layer;
    for (const e of outgoingOf(n)) if (!e.back) best = Math.max(best, this.reach(e.target));
    this.reachMemo.set(n, best);
    return best;
  }

  /** Follows unplaced forward flows from `start` (farthest reach first); returns the chain and the join it ran into. */
  private chain(start: GNode): { nodes: GNode[]; join?: GNode } {
    const { placed, chainNext } = this;
    const out: GNode[] = [];
    let cur: GNode | undefined = start;
    while (cur && !placed.has(cur)) {
      out.push(cur);
      placed.add(cur);
      // only the node's own flows continue the chain: boundary handlers are always bands below the host
      const candidates: GEdge[] = cur.out.filter((e) => !e.back && !placed.has(e.target));
      let next: GNode | undefined;
      let bestReach = -1;
      for (const e of candidates) {
        const r = this.loopsBackOnly(e.target) ? -0.5 : this.reach(e.target);
        if (r > bestReach) {
          bestReach = r;
          next = e.target;
        }
      }
      if (!next) {
        const join = cur.out.find((e) => !e.back && placed.has(e.target))?.target;
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
    // regular branches first (they get the rows right below the chain), boundary handlers afterwards
    for (const n of chainNodes) {
      for (const e of n.out) {
        if (e.back) continue;
        if (!placed.has(e.target)) queue.push({ origin: n, first: e.target });
        else if (e.target !== this.chainNext.get(n) && e.target.row === n.row && e.target.layer > n.layer + 1 && n.out.length > 1) {
          // empty branch / skip: reserve a band so the flow gets its own strip and enters the join from below
          const iv: Branch = { owner: n.id, from: n.layer, to: e.target.layer, row: 0, originRow: n.row, dropColumn: n.layer, nodes: [], edge: e };
          this.place(iv);
        }
      }
    }
    for (const n of chainNodes) {
      for (const e of n.boundary.flatMap((b) => b.out)) {
        if (e.back || placed.has(e.target)) continue;
        queue.push({ origin: n, first: e.target });
      }
      for (const b of n.boundary) {
        if (b.compensationHandler && !placed.has(b.compensationHandler)) queue.push({ origin: n, first: b.compensationHandler });
      }
    }
  }

  /**
   * The groups of each part of the scope no flow connects to another (weakly
   * connected over sequence flows, boundary events with their host, a
   * compensation handler with its event): those of the part's first node
   * (declaration order, boundary events after their host) a group box held.
   */
  private partGroups(nodes: GNode[], groups: ReadonlyMap<string, readonly string[]>): Map<GNode, readonly string[]> {
    const unit = (n: GNode): GNode => n.host ?? n;
    const partOf = new Map<GNode, GNode[]>();
    for (const n of nodes) {
      if (partOf.has(n)) continue;
      const part: GNode[] = [n];
      partOf.set(n, part);
      for (let i = 0; i < part.length; i++) {
        const m = part[i]!;
        const next = [...m.out.map((e) => e.target), ...m.in.map((e) => e.source)];
        for (const b of m.boundary) next.push(...b.out.map((e) => e.target), ...(b.compensationHandler ? [b.compensationHandler] : []));
        if (m.compensatedBy) next.push(m.compensatedBy);
        for (const o of next.map(unit)) {
          if (partOf.has(o)) continue;
          partOf.set(o, part);
          part.push(o);
        }
      }
    }
    const out = new Map<GNode, readonly string[]>();
    const found = new Set<GNode[]>();
    for (const n of nodes) {
      const part = partOf.get(n)!;
      if (found.has(part)) continue;
      const path = [n, ...n.boundary].map((m) => groups.get(m.id)).find((p) => p?.length);
      if (!path) continue;
      found.add(part);
      for (const m of part) out.set(m, path);
    }
    return out;
  }

  /**
   * `list` (the roots of the parts) with the roots of one group moved up
   * behind the group's first root (groups inside a group likewise, see the
   * conventions of ScopePlacer); stable, and `list` itself without groups.
   */
  private groupedOrder(list: GNode[], nodes: GNode[], groups: ReadonlyMap<string, readonly string[]> | undefined): GNode[] {
    if (!groups?.size || list.length < 2) return list;
    const pathOf = this.partGroups(nodes, groups);
    const first = new Map<string, number>();
    const keys = new Map<GNode, number[]>();
    list.forEach((n, i) => {
      let path = '';
      const key: number[] = [];
      for (const g of pathOf.get(n.host ?? n) ?? []) {
        path += `/${g}`;
        if (!first.has(path)) first.set(path, i);
        key.push(first.get(path)!);
      }
      keys.set(n, [...key, i]);
    });
    const compare = (a: number[], b: number[]): number => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
      return a.length - b.length;
    };
    return [...list].sort((a, b) => compare(keys.get(a)!, keys.get(b)!));
  }
}
