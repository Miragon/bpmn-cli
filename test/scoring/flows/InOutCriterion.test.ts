import { describe, expect, it } from 'vitest';
import { InOutCriterion } from '../../../src/scoring/flows/InOutCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('InOutCriterion', () => {
  it('finds the flow in and the flow out of a task sharing a line', async () => {
    const { problems } = new Scorer([new InOutCriterion()]).score(await Fixtures.read('scoring/in-out.bpmn'));

    expect(problems).toEqual([{ kind: 'inOut', ids: ['flow_in', 'flow_out', 'task_middle'] }]);
  });

  it('takes a straight chain for no problem', async () => {
    const { problems } = new Scorer([new InOutCriterion()]).score(await Fixtures.read('scoring/through.bpmn'));

    expect(problems).toEqual([]);
  });
});
