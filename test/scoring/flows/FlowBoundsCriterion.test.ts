import { describe, expect, it } from 'vitest';
import { FlowBoundsCriterion } from '../../../src/scoring/flows/FlowBoundsCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FlowBoundsCriterion', () => {
  it('finds a flow leaving its pool and a flow leaving the lane of both its ends', async () => {
    const { problems } = new Scorer([new FlowBoundsCriterion()]).score(await Fixtures.read('scoring/flow-bounds.bpmn'));

    expect(problems).toEqual([{ kind: 'edgeLeavesLane', ids: ['flow_out_of_lane', 'lane_upper'] }, { kind: 'edgeOutside', ids: ['flow_out_of_pool', 'pool'] }]);
  });
});
