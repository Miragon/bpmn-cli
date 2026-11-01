import { describe, expect, it } from 'vitest';
import { CrossingCriterion } from '../../../src/scoring/flows/CrossingCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('CrossingCriterion', () => {
  it('finds two sequence flows crossing, not the annotation line across them', async () => {
    const { problems } = new Scorer([new CrossingCriterion()]).score(await Fixtures.read('scoring/crossing.bpmn'));

    expect(problems).toEqual([{ kind: 'crossings', ids: ['flow_down', 'flow_up'] }]);
  });
});
