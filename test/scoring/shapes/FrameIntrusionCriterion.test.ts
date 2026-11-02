import { describe, expect, it } from 'vitest';
import { FrameIntrusionCriterion } from '../../../src/scoring/shapes/FrameIntrusionCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FrameIntrusionCriterion', () => {
  it('finds a task whose centre lies in a sub-process it does not belong to', async () => {
    const { problems } = new Scorer([new FrameIntrusionCriterion()]).score(await Fixtures.read('scoring/frame-intrusion.bpmn'));

    expect(problems).toEqual([{ kind: 'frameIntrusion', ids: ['task_visiting', 'sub_visited'] }]);
  });

  it('takes a boundary event on the border of its sub-process for at home', async () => {
    const { problems } = new Scorer([new FrameIntrusionCriterion()]).score(await Fixtures.read('scoring/overlap-boundary.bpmn'));

    expect(problems).toEqual([]);
  });
});
