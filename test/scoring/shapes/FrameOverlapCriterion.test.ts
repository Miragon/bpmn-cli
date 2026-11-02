import { describe, expect, it } from 'vitest';
import { FrameOverlapCriterion } from '../../../src/scoring/shapes/FrameOverlapCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FrameOverlapCriterion', () => {
  it('finds two pools overlapping, not the pool apart from them', async () => {
    const { problems } = new Scorer([new FrameOverlapCriterion()]).score(await Fixtures.read('scoring/frame-overlap.bpmn'));

    expect(problems).toEqual([{ kind: 'frameOverlap', ids: ['pool_first', 'pool_second'] }]);
  });

  it('takes a lane inside its pool for no overlap', async () => {
    const { problems } = new Scorer([new FrameOverlapCriterion()]).score(await Fixtures.read('scoring/lane-gap-closed.bpmn'));

    expect(problems).toEqual([]);
  });
});
