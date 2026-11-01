import type { GNode, ScopeLayout } from '../scopes/GNode.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';
import type { Routes } from './ArrangementTrial.js';
import { TakenColumns, type Columns } from './TakenColumns.js';

export interface JoinMoveWork {
  layout: ScopeLayout;
  arrange: (shifts: ReadonlyMap<GNode, number>) => void;
  route: () => Routes;
  shifts: Map<GNode, number>;
}

export class JoinMove {
  private static readonly MAX_SHIFT = 3;
  private static readonly MAX_PUSHED = 4;

  private readonly columns: TakenColumns;
  private readonly kept: ReadonlyMap<GNode, number>;
  private readonly startX: ReadonlyMap<GNode, number>;
  private alone: ReadonlyMap<GNode, number> = new Map();
  private first: GNode[] = [];
  private movedOnce: Columns = new Map();
  private last: Columns = new Map();

  constructor(
    private readonly work: JoinMoveWork,
    private readonly candidate: GNode,
    private readonly blocked: Columns,
    private readonly before: Routes,
  ) {
    this.columns = new TakenColumns(work.layout);
    this.kept = new Map(work.shifts);
    this.startX = new Map(work.layout.nodes.map((node) => [node, node.box.x]));
  }

  private static keeps(after: Routes, before: Routes): boolean {
    const noWorse = after.crossings <= before.crossings && after.hits <= before.hits && after.labels <= before.labels;
    const fewerFaults = (after.crossings < before.crossings || after.hits < before.hits) && after.rises.size >= before.rises.size;
    if (noWorse && (after.rises.size > before.rises.size || after.labels < before.labels || fewerFaults)) {
      return true;
    }
    return after.hits < before.hits && after.labels <= before.labels && after.crossings - before.crossings <= before.hits - after.hits;
  }

  attempt(): { routes: Routes; taken: Columns } | undefined {
    const checkpoint = new ArrangementCheckpoint(this.work.layout);
    this.moveAlone();
    const routes = this.keptRoutes();
    if (routes) {
      return { routes, taken: this.last };
    }
    this.reset(this.kept);
    checkpoint.restore();
    return undefined;
  }

  private step(node: GNode): number {
    return (this.work.shifts.get(node) ?? 0) - (this.kept.get(node) ?? 0);
  }

  private reset(to: ReadonlyMap<GNode, number>): void {
    const { shifts } = this.work;
    shifts.clear();
    for (const [node, shift] of to) {
      shifts.set(node, shift);
    }
  }

  private shiftOnce(node: GNode): void {
    this.work.shifts.set(node, (this.work.shifts.get(node) ?? 0) + 1);
  }

  private movedBy(node: GNode): number {
    return node.box.x - this.startX.get(node)!;
  }

  private took(columns: Columns): GNode[] {
    const isNew = (node: GNode, owner: GNode | undefined): boolean => !this.blocked.get(node)?.includes(owner) || (!!owner && this.movedBy(owner) !== this.movedBy(node));
    return [...columns].filter(([node, owners]) => (node === this.candidate || owners.some((owner) => isNew(node, owner))) && this.step(node) < JoinMove.MAX_SHIFT).map(([node]) => node);
  }

  private moveAlone(): void {
    let now: Columns;
    do {
      this.shiftOnce(this.candidate);
      this.work.arrange(this.work.shifts);
      now = this.columns.of();
    } while (this.step(this.candidate) < JoinMove.MAX_SHIFT && now.has(this.candidate));
    this.alone = new Map(this.work.shifts);
    this.first = this.took(now);
    this.movedOnce = now;
    this.last = now;
  }

  private back(): void {
    this.reset(this.alone);
    this.work.arrange(this.work.shifts);
    this.last = this.movedOnce;
  }

  private pushedTooMany(): boolean {
    return [...this.work.shifts.keys()].filter((node) => node !== this.candidate && this.step(node)).length > JoinMove.MAX_PUSHED;
  }

  private push(): boolean {
    const { shifts } = this.work;
    let next = this.first;
    for (let round = 0; next.length && round < 3 * JoinMove.MAX_SHIFT; round++) {
      for (const node of next) {
        this.shiftOnce(node);
      }
      if (this.pushedTooMany()) {
        if (round) {
          this.back();
        } else {
          this.reset(this.alone);
        }
        return false;
      }
      this.work.arrange(shifts);
      this.last = this.columns.of();
      next = this.took(this.last);
    }
    return [...shifts].some(([node, shift]) => shift !== this.alone.get(node));
  }

  private keptRoutes(): Routes | undefined {
    const { before, work } = this;
    const breaks = this.first.some((node) => node.risesInto().some((edge) => before.rises.has(edge)));
    if (breaks && this.push()) {
      const together = work.route();
      if (JoinMove.keeps(together, before)) {
        return together;
      }
      this.back();
    }
    const single = work.route();
    const singleKept = JoinMove.keeps(single, before);
    const losesRise = [...before.rises].some((edge) => !single.rises.has(edge));
    if ((!singleKept || losesRise) && !breaks && this.push()) {
      const together = work.route();
      if (JoinMove.keeps(together, before)) {
        return together;
      }
      this.back();
    }
    return singleKept ? single : undefined;
  }
}
