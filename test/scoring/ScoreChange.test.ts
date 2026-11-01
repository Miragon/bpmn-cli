import { describe, expect, it } from 'vitest';
import { LayoutScore } from '../../src/scoring/LayoutScore.js';
import type { LayoutProblem } from '../../src/scoring/plane/ProblemReport.js';
import { ScoreChange } from '../../src/scoring/ScoreChange.js';

const crossing: LayoutProblem = { kind: 'crossings', ids: ['flow_a', 'flow_b'] };
const reversed: LayoutProblem = { kind: 'crossings', ids: ['flow_b', 'flow_a'] };
const overlap: LayoutProblem = { kind: 'overlaps', ids: ['task_a', 'task_b'] };

describe('ScoreChange', () => {
  it('holds both scores with their counts per kind, not the problems', () => {
    const change = new ScoreChange(new LayoutScore([crossing]), new LayoutScore([crossing, overlap]));

    expect(change.before).toEqual({ counts: expect.objectContaining({ crossings: 1, overlaps: 0 }), score: 5 });
    expect(change.after).toEqual({ counts: expect.objectContaining({ crossings: 1, overlaps: 1 }), score: 15 });
  });

  it('takes a crossing of the same two flows in either order for no change', () => {
    const change = new ScoreChange(new LayoutScore([crossing]), new LayoutScore([reversed]));

    expect([change.added, change.resolved]).toEqual([[], []]);
  });

  it('matches duplicates one to one', () => {
    const change = new ScoreChange(new LayoutScore([overlap]), new LayoutScore([overlap, overlap]));

    expect([change.added, change.resolved]).toEqual([[overlap], []]);
  });

  it('adds every problem of a file that had no drawing before', () => {
    const change = new ScoreChange(undefined, new LayoutScore([overlap]));

    expect(change.before).toBeUndefined();
    expect(change.added).toEqual([overlap]);
    expect(JSON.parse(JSON.stringify(change))).not.toHaveProperty('before');
  });
});
