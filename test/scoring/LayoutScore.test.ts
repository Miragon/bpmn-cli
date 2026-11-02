import { describe, expect, it } from 'vitest';
import { LayoutScore } from '../../src/scoring/LayoutScore.js';

describe('LayoutScore', () => {
  it('sums the problems with the weights of their kinds', () => {
    const score = new LayoutScore([
      { kind: 'crossings', ids: ['flow_a', 'flow_b'] },
      { kind: 'crossings', ids: ['flow_a', 'flow_c'] },
      { kind: 'overlaps', ids: ['task_a', 'task_b'] },
    ]);

    expect(score.counts.crossings).toBe(2);
    expect(score.counts.overlaps).toBe(1);
    expect(score.score).toBe(20);
  });

  it('scores a drawing without problems 0', () => {
    expect(new LayoutScore([]).score).toBe(0);
  });

  it('compares itself with the drawing after a change', () => {
    const before = new LayoutScore([{ kind: 'crossings', ids: ['flow_a', 'flow_b'] }]);
    const after = new LayoutScore([{ kind: 'labelOnLine', ids: ['event', 'flow_a'] }]);

    const change = before.to(after);

    expect([change.before?.score, change.after.score]).toEqual([5, 1]);
    expect(change.added).toEqual(after.problems);
    expect(change.resolved).toEqual(before.problems);
  });
});
