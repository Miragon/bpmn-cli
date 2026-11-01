import { describe, expect, it } from 'vitest';
import { ContainmentCriterion } from '../../../src/scoring/shapes/ContainmentCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ContainmentCriterion', () => {
  it('finds nodes outside their lane, pool and sub-process', async () => {
    const { problems } = new Scorer([new ContainmentCriterion()]).score(await Fixtures.read('scoring/containment.bpmn'));

    expect(problems).toEqual([{ kind: 'outsideLane', ids: ['task_below_lane', 'lane_upper'] }, { kind: 'outsideLane', ids: ['task_out_of_pool', 'lane_upper'] }, { kind: 'outsidePool', ids: ['task_out_of_pool', 'pool'] }, { kind: 'outsideSub', ids: ['task_out_of_sub', 'sub'] }]);
  });
});
