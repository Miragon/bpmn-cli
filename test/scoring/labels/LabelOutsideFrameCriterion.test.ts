import { describe, expect, it } from 'vitest';
import { LabelOutsideFrameCriterion } from '../../../src/scoring/labels/LabelOutsideFrameCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('LabelOutsideFrameCriterion', () => {
  it('finds a named label reaching out of its pool, not an unnamed one', async () => {
    const { problems } = new Scorer([new LabelOutsideFrameCriterion()]).score(await Fixtures.read('scoring/label-outside-frame.bpmn'));

    expect(problems).toEqual([{ kind: 'labelOutsideFrame', ids: ['event_outside', 'pool'] }]);
  });
});
