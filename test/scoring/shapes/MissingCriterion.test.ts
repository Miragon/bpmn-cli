import { describe, expect, it } from 'vitest';
import { MissingCriterion } from '../../../src/scoring/shapes/MissingCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('MissingCriterion', () => {
  it('names the task that has no shape', async () => {
    const { problems } = new Scorer([new MissingCriterion()]).score(await Fixtures.read('scoring/missing.bpmn'));

    expect(problems).toEqual([{ kind: 'missing', ids: ['task_undrawn'] }]);
  });

  it('finds nothing missing in a file with shapes for all', async () => {
    const { problems } = new Scorer([new MissingCriterion()]).score(await Fixtures.read('scoring/overlap.bpmn'));

    expect(problems).toEqual([]);
  });
});
