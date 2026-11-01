import { describe, expect, it } from 'vitest';
import { OverlapCriterion } from '../../../src/scoring/shapes/OverlapCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('OverlapCriterion', () => {
  it('finds two tasks on top of each other', async () => {
    const { problems } = new Scorer([new OverlapCriterion()]).score(await Fixtures.read('scoring/overlap.bpmn'));

    expect(problems).toEqual([{ kind: 'overlaps', ids: ['task_lower', 'task_upper'] }]);
  });

  it('takes a boundary event on the edge of its task for no overlap', async () => {
    const { problems } = new Scorer([new OverlapCriterion()]).score(await Fixtures.read('scoring/overlap-boundary.bpmn'));

    expect(problems).toEqual([]);
  });
});
