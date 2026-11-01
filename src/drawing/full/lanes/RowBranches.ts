import type { GEdge, GNode } from '../scopes/GNode.js';

export interface Branch {
  owner: string;
  from: number;
  to: number;
  row: number;
  originRow: number;
  dropColumn: number;
  nodes: GNode[];
  edge?: GEdge;
}

type ColumnSpan = Pick<Branch, 'from' | 'to'>;

export class RowBranches {
  private readonly branches: Branch[] = [];
  private readonly rows = new Map<number, Branch[]>();
  private readonly byDrop = new Map<number, Branch[]>();
  private lowest = -1;

  private static overlaps(span: ColumnSpan, other: ColumnSpan): boolean {
    return span.from <= other.to && other.from <= span.to;
  }

  private static holdsDrop(span: ColumnSpan, { dropColumn }: Branch): boolean {
    return span.from <= dropColumn && dropColumn <= span.to;
  }

  private static dropLeadsInto(branch: Branch, { from, to }: ColumnSpan): boolean {
    return from <= branch.dropColumn && branch.dropColumn <= to;
  }

  private static setRow(branch: Branch, row: number): void {
    branch.row = row;
    for (const node of branch.nodes) {
      node.row = row;
    }
    if (branch.edge) {
      branch.edge.bandRow = row;
    }
  }

  commit(branch: Branch, row: number): void {
    RowBranches.setRow(branch, row);
    for (const node of branch.nodes) {
      node.band = this.branches.length;
    }
    this.branches.push(branch);
    const list = this.byDrop.get(branch.dropColumn);
    if (list) {
      list.push(branch);
    } else {
      this.byDrop.set(branch.dropColumn, [branch]);
    }
    this.enter(branch);
  }

  place(branch: Branch): void {
    const limit = this.lowest + 1;
    for (let row = branch.originRow + 1; row <= limit; row++) {
      if (this.intervalFree(row, branch) && this.dropFree(row, branch)) {
        this.commit(branch, row);
        return;
      }
    }
    for (let at = branch.originRow + 1; at <= limit; at++) {
      if (this.tryInsert(at, branch)) {
        return;
      }
    }
    for (let row = branch.originRow + 1; ; row++) {
      if (this.intervalFree(row, branch)) {
        this.commit(branch, row);
        return;
      }
    }
  }

  private inRow(row: number): Branch[] {
    return this.rows.get(row) ?? [];
  }

  private intervalFree(row: number, branch: Branch): boolean {
    return !this.inRow(row).some((other) => RowBranches.overlaps(other, branch));
  }

  private dropFree(row: number, branch: Branch): boolean {
    for (let passedRow = branch.originRow + 1; passedRow < row; passedRow++) {
      if (this.inRow(passedRow).some((other) => other.owner !== branch.owner && RowBranches.dropLeadsInto(branch, other))) {
        return false;
      }
    }
    return true;
  }

  private enter(branch: Branch): void {
    const list = this.rows.get(branch.row);
    if (list) {
      list.push(branch);
    } else {
      this.rows.set(branch.row, [branch]);
    }
    this.lowest = Math.max(this.lowest, branch.row);
  }

  private move(branch: Branch, row: number): void {
    const list = this.rows.get(branch.row)!;
    list.splice(list.indexOf(branch), 1);
    RowBranches.setRow(branch, row);
    this.enter(branch);
  }

  private shiftedDown(at: number, branch: Branch): Map<Branch, number> {
    const shifted = new Map<Branch, number>();
    const queue = this.inRow(at).filter((other) => RowBranches.overlaps(other, branch));
    for (const other of queue) {
      shifted.set(other, at + 1);
    }
    while (queue.length) {
      const moved = queue.shift()!;
      const newRow = shifted.get(moved)!;
      for (const other of this.inRow(newRow)) {
        if (!shifted.has(other) && RowBranches.overlaps(other, moved)) {
          shifted.set(other, newRow + 1);
          queue.push(other);
        }
      }
    }
    return shifted;
  }

  private cutsDropLine(at: number, branch: Branch, shifted: ReadonlyMap<Branch, number>): boolean {
    const cuts = (other: Branch): boolean => !shifted.has(other) && other.originRow < at && at < other.row && RowBranches.holdsDrop(branch, other);
    if (branch.to - branch.from >= this.branches.length) {
      return this.branches.some(cuts);
    }
    for (let column = branch.from; column <= branch.to; column++) {
      if (this.byDrop.get(column)?.some(cuts)) {
        return true;
      }
    }
    return false;
  }

  private ownDropCut(at: number, branch: Branch, shifted: ReadonlyMap<Branch, number>): boolean {
    for (let passedRow = branch.originRow + 1; passedRow < at; passedRow++) {
      if (this.inRow(passedRow).some((other) => !shifted.has(other) && other.owner !== branch.owner && RowBranches.dropLeadsInto(branch, other))) {
        return true;
      }
    }
    return false;
  }

  private tryInsert(at: number, branch: Branch): boolean {
    const shifted = this.shiftedDown(at, branch);
    const shiftedCut = [...shifted.keys()].some((other) => other.originRow < at && RowBranches.holdsDrop(branch, other));
    if (this.cutsDropLine(at, branch, shifted) || shiftedCut || this.ownDropCut(at, branch, shifted)) {
      return false;
    }
    for (const [other, newRow] of shifted) {
      this.move(other, newRow);
    }
    this.commit(branch, at);
    return true;
  }
}
