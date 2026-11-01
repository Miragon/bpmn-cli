import { describe, expect, it } from 'vitest';
import { LabelTitleCriterion } from '../../../src/scoring/labels/LabelTitleCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('LabelTitleCriterion', () => {
  it('finds a label on the title of an expanded sub-process', async () => {
    const { problems } = new Scorer([new LabelTitleCriterion()]).score(await Fixtures.read('scoring/label-title.bpmn'));

    expect(problems).toEqual([{ kind: 'labelOnTitle', ids: ['event_under_title', 'sub'] }]);
  });
});
