import { describe, expect, it } from 'vitest';
import { LaneGapCriterion } from '../../../src/scoring/shapes/LaneGapCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('LaneGapCriterion', () => {
  it('finds the first and the last lane short of their pool\'s border', async () => {
    const { problems } = new Scorer([new LaneGapCriterion()]).score(await Fixtures.read('scoring/lane-gap.bpmn'));

    expect(problems).toEqual([{ kind: 'laneGap', ids: ['lane_top', 'pool'], detail: 'top' }, { kind: 'laneGap', ids: ['lane_bottom', 'pool'], detail: 'bottom' }]);
  });

  it('takes lanes that fill their pool for no gap', async () => {
    const { problems } = new Scorer([new LaneGapCriterion()]).score(await Fixtures.read('scoring/lane-gap-closed.bpmn'));

    expect(problems).toEqual([]);
  });
});
