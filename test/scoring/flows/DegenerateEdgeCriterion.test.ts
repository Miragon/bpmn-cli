import { describe, expect, it } from 'vitest';
import { DegenerateEdgeCriterion } from '../../../src/scoring/flows/DegenerateEdgeCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DegenerateEdgeCriterion', () => {
  it('finds a flow with one waypoint and one without length', async () => {
    const { problems } = new Scorer([new DegenerateEdgeCriterion()]).score(await Fixtures.read('scoring/degenerate-edge.bpmn'));

    expect(problems).toEqual([{ kind: 'degenerateEdge', ids: ['flow_one_point'] }, { kind: 'degenerateEdge', ids: ['flow_no_length'] }]);
  });
});
