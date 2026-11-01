import type { Point } from '../../../model/index.js';
import { RouteCosts } from '../routing/RouteCosts.js';
import type { RouteGrid } from './RouteGrid.js';
import type { Port } from '../routing/RoutePorts.js';
import { SearchHeap } from './SearchHeap.js';

export interface FoundRoute {
  points: Point[];
  cost: number;
}

interface Visit {
  state: number;
  cost: number;
  layer: number;
  direction: number;
  node: number;
  column: number;
  row: number;
}

interface Arrival {
  x: number;
  y: number;
  inward: number;
}

export class RouteSearch {
  private static readonly OVERLAPPED = 1;
  private static readonly MERGED = 2;
  private static readonly TURNS: readonly number[] = [0, 1, 3];

  private readonly layers: number;
  private readonly goalNode: Uint8Array;
  private readonly goals = new Map<number, number>();
  private readonly arrivals: Arrival[] = [];
  private readonly costs: Float64Array;
  private readonly parent: Int32Array;
  private readonly heap = new SearchHeap();

  constructor(private readonly grid: RouteGrid) {
    const { nx, ny, anyOv, anyMg } = grid;
    this.layers = RouteSearch.layerCount(anyOv, anyMg);
    this.goalNode = new Uint8Array(nx * ny);
    this.costs = new Float64Array(nx * ny * 4 * this.layers).fill(Number.POSITIVE_INFINITY);
    this.parent = new Int32Array(this.costs.length).fill(-2);
  }

  private static layerCount(overlaps: boolean, merges: boolean): number {
    if (merges) {
      return 3;
    }
    return overlaps ? 2 : 1;
  }

  private static ahead(inward: number, x: number, y: number, { x: arrivalX, y: arrivalY }: Arrival): boolean {
    switch (inward) {
      case 0:
        return y === arrivalY && arrivalX >= x;
      case 1:
        return x === arrivalX && arrivalY >= y;
      case 2:
        return y === arrivalY && arrivalX <= x;
      default:
        return x === arrivalX && arrivalY <= y;
    }
  }

  find(sources: readonly Port[], targets: readonly Port[]): FoundRoute | undefined {
    const { grid, heap, costs, parent, layers } = this;
    if (!grid.nx || !grid.ny) {
      return undefined;
    }
    this.noteGoals(targets);
    if (!this.arrivals.length) {
      return undefined;
    }
    this.seed(sources);
    while (heap.size) {
      const id = heap.pop();
      const visit = this.visitOf(heap.state[id]!, heap.cost[id]!);
      if (visit.cost > costs[visit.state]!) {
        continue;
      }
      const start = parent[visit.state] === -1;
      if (!start && this.goalNode[visit.node] && this.goals.has(visit.node * 4 + visit.direction)) {
        return { points: grid.trace(visit.state, parent, layers), cost: visit.cost };
      }
      for (let turnIndex = 0; turnIndex < (start ? 1 : 3); turnIndex++) {
        this.relax(visit, (visit.direction + RouteSearch.TURNS[turnIndex]!) % 4);
      }
    }
    return undefined;
  }

  private noteGoals(targets: readonly Port[]): void {
    for (const port of targets) {
      const node = this.grid.nodeOf(port);
      if (node !== undefined) {
        const inward = (RouteCosts.OUTWARD[port.side] + 2) % 4;
        const key = node * 4 + inward;
        const known = this.goals.get(key);
        if (known === undefined || known > port.cost) {
          this.goals.set(key, port.cost);
        }
        this.goalNode[node] = 1;
        this.arrivals.push({ x: port.x, y: port.y, inward });
      }
    }
  }

  private seed(sources: readonly Port[]): void {
    for (const port of sources) {
      const node = this.grid.nodeOf(port);
      if (node === undefined) {
        continue;
      }
      const direction = RouteCosts.OUTWARD[port.side];
      const state = node * 4 * this.layers + direction * this.layers;
      if (port.cost < this.costs[state]!) {
        this.costs[state] = port.cost;
        this.parent[state] = -1;
        this.heap.push(state, port.cost, this.heuristic(node, direction));
      }
    }
  }

  private heuristic(node: number, direction: number): number {
    const { xs, ys, nx } = this.grid;
    const x = xs[node % nx]!, y = ys[Math.floor(node / nx)]!;
    let best = Number.POSITIVE_INFINITY;
    for (const arrival of this.arrivals) {
      const estimate = Math.abs(x - arrival.x) + Math.abs(y - arrival.y) + RouteCosts.BEND * this.bendsTo(direction, x, y, arrival);
      if (estimate < best) {
        best = estimate;
      }
    }
    return best;
  }

  private bendsTo(direction: number, x: number, y: number, arrival: Arrival): number {
    const { inward } = arrival;
    if (direction === inward) {
      return RouteSearch.ahead(inward, x, y, arrival) ? 0 : 2;
    }
    return direction === (inward + 2) % 4 ? 2 : 1;
  }

  private visitOf(state: number, cost: number): Visit {
    const layer = state % this.layers;
    const nodeAndDirection = (state - layer) / this.layers;
    const direction = nodeAndDirection % 4;
    const node = (nodeAndDirection - direction) / 4;
    const column = node % this.grid.nx;
    return { state, cost, layer, direction, node, column, row: (node - column) / this.grid.nx };
  }

  private relax(visit: Visit, direction: number): void {
    const { grid } = this;
    const { nx, ny } = grid;
    const nextColumn = visit.column + RouteCosts.DX[direction]!, nextRow = visit.row + RouteCosts.DY[direction]!;
    if (nextColumn < 0 || nextRow < 0 || nextColumn >= nx || nextRow >= ny) {
      return;
    }
    const nextNode = nextRow * nx + nextColumn;
    const goalCost = this.goalNode[nextNode] ? this.goals.get(nextNode * 4 + direction) : undefined;
    const layer = this.layerAfter(visit, direction);
    const cost = this.stepCost(visit, direction, layer) + (goalCost ?? 0);
    const state = (nextNode * 4 + direction) * this.layers + layer;
    if (cost < this.costs[state]!) {
      this.costs[state] = cost;
      this.parent[state] = visit.state;
      this.heap.push(state, cost, goalCost !== undefined ? 0 : this.heuristic(nextNode, direction));
    }
  }

  private edgeIndex({ column, row }: Visit, direction: number): number {
    if (direction === 0 || direction === 2) {
      return row * (this.grid.nx - 1) + (direction === 0 ? column : column - 1);
    }
    return (direction === 1 ? row : row - 1) * this.grid.nx + column;
  }

  private layerAfter(visit: Visit, direction: number): number {
    const { grid } = this;
    const edge = this.edgeIndex(visit, direction);
    const horizontal = direction === 0 || direction === 2;
    if (horizontal ? grid.hOv[edge] : grid.vOv[edge]) {
      return RouteSearch.OVERLAPPED;
    }
    return (horizontal ? grid.hMg[edge] : grid.vMg[edge]) ? RouteSearch.MERGED : 0;
  }

  private stepCost(visit: Visit, direction: number, layer: number): number {
    const { grid } = this;
    const edge = this.edgeIndex(visit, direction);
    let cost = visit.cost + (direction === 0 || direction === 2 ? grid.hCost[edge]! : grid.vCost[edge]!);
    if (direction !== visit.direction) {
      cost += RouteCosts.BEND + grid.turn[visit.node]!;
    }
    if (layer === RouteSearch.OVERLAPPED && !(visit.layer === RouteSearch.OVERLAPPED && direction === visit.direction)) {
      cost += RouteCosts.OVERLAP;
    }
    if (visit.layer === RouteSearch.MERGED && layer !== RouteSearch.MERGED) {
      cost += RouteCosts.OVERLAP;
    }
    return cost;
  }
}
