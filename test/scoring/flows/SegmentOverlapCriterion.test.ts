import { describe, expect, it } from 'vitest';
import { SegmentOverlapCriterion } from '../../../src/scoring/flows/SegmentOverlapCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('SegmentOverlapCriterion', () => {
  it('finds two flows into one task sharing a line', async () => {
    const { problems } = new Scorer([new SegmentOverlapCriterion()]).score(await Fixtures.read('scoring/segment-overlap.bpmn'));

    expect(problems).toEqual([{ kind: 'segmentOverlap', ids: ['flow_top', 'flow_bottom', 'task_join'], detail: '200px' }]);
  });

  it('takes the common tail of a join into a gateway\'s vertex for no overlap', async () => {
    const { problems } = new Scorer([new SegmentOverlapCriterion()]).score(await Fixtures.read('scoring/join-tail.bpmn'));

    expect(problems).toEqual([]);
  });
});
