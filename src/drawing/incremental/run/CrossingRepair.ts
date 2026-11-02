import { CrossingReroutes } from './CrossingReroutes.js';
import type { LayoutRun } from './LayoutRun.js';
import { RepairGuard } from './RepairGuard.js';
import type { Checkpoint, RunCheckpoint } from './RunCheckpoint.js';

interface ChainRetry {
  head: string;
  rank: number;
}

type Redraw = () => Promise<string[]>;

export class CrossingRepair {
  private static readonly CHAIN_RETRIES = 2;
  private static readonly HEAD_SEARCH = 30;

  constructor(
    private readonly run: LayoutRun,
    private readonly checkpoints: RunCheckpoint,
  ) {}

  async repair(rerouted: string[], start: Checkpoint, redraw: Redraw): Promise<string[]> {
    const guard = new RepairGuard(this.run);
    const routes = new CrossingReroutes(this.run, guard);
    if (!routes.crossings().length) {
      return rerouted;
    }
    routes.reroute(rerouted);
    return this.retryChains(rerouted, start, redraw, guard, routes);
  }

  private async retryChains(rerouted: string[], start: Checkpoint, redraw: Redraw, guard: RepairGuard, routes: CrossingReroutes): Promise<string[]> {
    const tried = new Map<string, number>();
    let current = rerouted;
    for (let retries = 0; retries < CrossingRepair.CHAIN_RETRIES && !guard.exhausted && !this.run.fromEngine.size && this.run.planes.length === start.planes.length; retries++) {
      const next = this.nextRetry(routes, tried);
      if (!next) {
        break;
      }
      guard.begin();
      tried.set(next.head, next.rank);
      const again = await this.placeChainAgain(next, start, redraw, guard);
      if (again) {
        current = again;
        this.run.notes.push(`${next.head} placed at another row: at the first one its path crossed a line`);
        routes.reroute(current);
      }
    }
    return current;
  }

  private nextRetry(routes: CrossingReroutes, tried: ReadonlyMap<string, number>): ChainRetry | undefined {
    const { skip, heads } = this.run.place;
    for (const [fresh] of routes.crossings()) {
      const head = this.chainHead([fresh.targetId, fresh.sourceId]);
      if (head) {
        const rank = Math.max(skip.get(head) ?? 0, tried.get(head) ?? 0) + 1;
        if (rank < (heads.get(head) ?? 0)) {
          return { head, rank };
        }
      }
    }
    return undefined;
  }

  private chainHead(from: ReadonlyArray<string | undefined>): string | undefined {
    const { heads, placed } = this.run.place;
    if (!heads.size) {
      return undefined;
    }
    const seen = new Set<string>();
    const queue = from.filter((id): id is string => !!id && placed.has(id));
    while (queue.length && seen.size < CrossingRepair.HEAD_SEARCH) {
      const id = queue.shift()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      if (heads.has(id)) {
        return id;
      }
      queue.push(...this.run.semantics.predecessors(id).filter((predecessor) => placed.has(predecessor)));
    }
    return undefined;
  }

  private async placeChainAgain({ head, rank }: ChainRetry, start: Checkpoint, redraw: Redraw, guard: RepairGuard): Promise<string[] | undefined> {
    const kept = this.checkpoints.take();
    const members = this.membersOf();
    const skip = new Map(this.run.place.skip).set(head, rank);
    this.checkpoints.restore(start);
    skip.forEach((candidate, id) => this.run.place.skip.set(id, candidate));
    const again = await redraw().catch(() => undefined);
    if (again && this.membersOf() === members && guard.keeps()) {
      return again;
    }
    this.checkpoints.restore(kept);
    return undefined;
  }

  private membersOf(): string {
    return this.run.planes.map((plane) => `${plane.rootId}:${[...plane.shapes.keys()].sort().join(',')}|${[...plane.edges.keys()].sort().join(',')}`).join(';');
  }
}
