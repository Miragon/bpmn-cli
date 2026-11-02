import { describe, expect, it } from 'vitest';
import { ParallelRunCriterion } from '../../../src/scoring/flows/ParallelRunCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ParallelRunCriterion', () => {
  it('finds two unrelated flows on one line, not flows that share an end', async () => {
    const { problems } = new Scorer([new ParallelRunCriterion()]).score(await Fixtures.read('scoring/parallel-run.bpmn'));

    expect(problems).toEqual([{ kind: 'parallelRun', ids: ['flow_top', 'flow_bottom'], detail: '30px' }]);
  });
});
