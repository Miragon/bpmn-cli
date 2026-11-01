import type { Point } from '../../../model/index.js';
import { RouteCosts } from './RouteCosts.js';
import type { Port } from './RoutePorts.js';

export interface Seg {
  start: Point;
  end: Point;
  kind: 'h' | 'v' | 'd';
  ends?: Point[];
  merge?: boolean;
  free?: boolean;
}

interface Run {
  start: Point;
  end: Point;
  kind: Seg['kind'];
  segs: number[];
}

interface MergeEntry {
  port: Port;
  runs: Run[];
}

export class RouteLines {
  private readonly segs: Seg[] = [];
  private readonly entries: MergeEntry[] = [];

  constructor(
    private readonly mergeAt: readonly Port[] = [],
    private readonly hook = 0,
    private readonly free: ReadonlySet<readonly Point[]> = new Set(),
  ) {}

  static overlap(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
    if (firstStart.y === firstEnd.y && Math.abs(secondStart.y - secondEnd.y) < RouteCosts.EPS) {
      if (Math.abs(firstStart.y - secondStart.y) > RouteCosts.OVERLAP_TOL) {
        return false;
      }
      return Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x)) - Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x)) > 1;
    }
    if (firstStart.x === firstEnd.x && Math.abs(secondStart.x - secondEnd.x) < RouteCosts.EPS) {
      if (Math.abs(firstStart.x - secondStart.x) > RouteCosts.OVERLAP_TOL) {
        return false;
      }
      return Math.min(Math.max(firstStart.y, firstEnd.y), Math.max(secondStart.y, secondEnd.y)) - Math.max(Math.min(firstStart.y, firstEnd.y), Math.min(secondStart.y, secondEnd.y)) > 1;
    }
    return false;
  }

  private static way(from: Point, to: Point): string {
    return `${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`;
  }

  private static continues(last: Run | undefined, { start, end, kind }: Seg): last is Run {
    if (!last || kind === 'd' || kind !== last.kind) {
      return false;
    }
    const across = kind === 'v' ? Math.abs(start.x - last.start.x) : Math.abs(start.y - last.start.y);
    return across < RouteCosts.EPS && RouteLines.way(start, end) === RouteLines.way(last.start, last.end);
  }

  private static kindOf(dx: number, dy: number): Seg['kind'] {
    if (dy < RouteCosts.EPS) {
      return 'h';
    }
    return dx < RouteCosts.EPS ? 'v' : 'd';
  }

  segments(lines: readonly Point[][]): Seg[] {
    for (const line of lines) {
      const first = this.segs.length;
      this.addLine(line);
      this.noteMergeEntry(line, first);
    }
    for (const entry of this.entries) {
      this.markTail(entry);
    }
    return this.segs;
  }

  private addLine(line: readonly Point[]): void {
    for (let index = 0; index + 1 < line.length; index++) {
      const start = line[index]!, end = line[index + 1]!;
      const dx = Math.abs(start.x - end.x), dy = Math.abs(start.y - end.y);
      if ([start.x, start.y, end.x, end.y].every(Number.isFinite) && (dx >= RouteCosts.EPS || dy >= RouteCosts.EPS)) {
        this.segs.push(this.segOf(line, index, RouteLines.kindOf(dx, dy)));
      }
    }
  }

  private segOf(line: readonly Point[], index: number, kind: Seg['kind']): Seg {
    const start = line[index]!, end = line[index + 1]!;
    const ends = kind === 'd' ? [] : [...(index === 0 ? [start] : []), ...(index + 2 === line.length ? [end] : [])];
    return { start, end, kind, ...(ends.length ? { ends } : {}), ...(this.free.has(line) ? { free: true } : {}) };
  }

  private noteMergeEntry(line: readonly Point[], first: number): void {
    const end = line.at(-1);
    const port = end && this.mergeAt.find((candidate) => Math.abs(candidate.x - end.x) <= RouteCosts.OVERLAP_TOL && Math.abs(candidate.y - end.y) <= RouteCosts.OVERLAP_TOL);
    if (!port) {
      return;
    }
    const runs = this.runsFrom(first);
    const last = runs.at(-1);
    if (last?.kind === 'v' && (port.side === 'bottom' ? last.start.y > last.end.y : last.start.y < last.end.y)) {
      this.entries.push({ port, runs });
    }
  }

  private runsFrom(first: number): Run[] {
    const runs: Run[] = [];
    for (let segIndex = first; segIndex < this.segs.length; segIndex++) {
      const seg = this.segs[segIndex]!;
      const last = runs.at(-1);
      if (RouteLines.continues(last, seg)) {
        last.end = seg.end;
        last.segs.push(segIndex);
      } else {
        runs.push({ start: seg.start, end: seg.end, kind: seg.kind, segs: [segIndex] });
      }
    }
    return runs;
  }

  private mark(run: Run | undefined): void {
    for (const segIndex of run?.segs ?? []) {
      this.segs[segIndex]!.merge = true;
    }
  }

  private markTail({ port, runs }: MergeEntry): void {
    this.mark(runs.at(-1));
    const hookRun = runs.at(-2);
    if (hookRun?.kind === 'h' && Math.abs(hookRun.start.x - hookRun.end.x) <= this.hook) {
      this.mark(hookRun);
      this.mark(runs.at(-3));
    }
    for (const other of this.entries) {
      if (other.port === port && other.runs !== runs) {
        this.markShared(runs, other.runs);
      }
    }
  }

  private markShared(runs: Run[], otherRuns: Run[]): void {
    for (let index = runs.length - 1, otherIndex = otherRuns.length - 1; index >= 0 && otherIndex >= 0; index--, otherIndex--) {
      const own = runs[index]!, other = otherRuns[otherIndex]!;
      if (!RouteLines.overlap(own.start, own.end, other.start, other.end)) {
        break;
      }
      this.mark(own);
      if (Math.abs(own.start.x - other.start.x) > RouteCosts.OVERLAP_TOL || Math.abs(own.start.y - other.start.y) > RouteCosts.OVERLAP_TOL) {
        break;
      }
    }
  }
}
