import { describe, expect, it } from 'vitest';
import { RowBranches, type Branch } from '../../../../src/drawing/full/lanes/RowBranches.js';

describe('RowBranches', () => {
  const branch = (owner: string, from: number, to: number, originRow = 0): Branch => ({ owner, from, to, row: 0, originRow, dropColumn: from, nodes: [] });

  function spine(): RowBranches {
    const rows = new RowBranches();
    rows.commit({ ...branch('#spine', 0, 9, -1), dropColumn: -1 }, 0);
    return rows;
  }

  it('puts a branch on the first free row below its origin', () => {
    const rows = spine();
    const [first, second] = [branch('a', 1, 2), branch('b', 4, 5)];

    [first, second].forEach((each) => rows.place(each));

    expect([first.row, second.row]).toEqual([1, 1]);
  });

  it('inserts a band when its drop line would cross a row, moving down what collides', () => {
    const rows = spine();
    const [first, second] = [branch('a', 1, 3), branch('b', 2, 4)];

    [first, second].forEach((each) => rows.place(each));

    expect([second.row, first.row]).toEqual([1, 2]);
  });

  it('leaves a band where a move would cut the band itself, on the first free row', () => {
    const rows = spine();
    const [first, second] = [{ ...branch('x', 2, 2), dropColumn: 2 }, { ...branch('y', 1, 3), dropColumn: 2, originRow: 0 }];
    rows.place(first);
    rows.place(branch('z', 2, 3, 1));

    rows.place(second);

    expect(second.row).toBeGreaterThan(0);
  });

  it('places a branch above its origin, on the nearest free row, and starts the rows at zero', () => {
    const rows = spine();
    const [above, higher] = [branch('a', 1, 2), branch('b', 2, 3)];

    rows.placeAbove(above, -1);
    rows.placeAbove(higher, -1);
    rows.startAtRowZero();

    expect([higher.row, above.row]).toEqual([0, 1]);
  });
});
