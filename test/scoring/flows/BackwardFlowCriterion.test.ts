import { describe, expect, it } from 'vitest';
import { BackwardFlowCriterion } from '../../../src/scoring/flows/BackwardFlowCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('BackwardFlowCriterion', () => {
  it('finds a flow running backwards, not the return of a loop', async () => {
    const { problems } = new Scorer([new BackwardFlowCriterion()]).score(await Fixtures.read('scoring/backward-flow.bpmn'));

    expect(problems).toEqual([{ kind: 'backwardFlow', ids: ['flow_backwards', 'task_a', 'task_b'] }]);
  });
});
