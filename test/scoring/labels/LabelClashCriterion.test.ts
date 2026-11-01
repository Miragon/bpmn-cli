import { describe, expect, it } from 'vitest';
import { LabelClashCriterion } from '../../../src/scoring/labels/LabelClashCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('LabelClashCriterion', () => {
  it('finds a label on a task and a label on a label', async () => {
    const { problems } = new Scorer([new LabelClashCriterion()]).score(await Fixtures.read('scoring/label-clash.bpmn'));

    expect(problems).toEqual([{ kind: 'labelClash', ids: ['event_on_task', 'task'], detail: 'label on shape' }, { kind: 'labelClash', ids: ['event_first', 'event_second'], detail: 'label on label' }]);
  });
});
