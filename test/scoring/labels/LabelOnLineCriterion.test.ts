import { describe, expect, it } from 'vitest';
import { LabelOnLineCriterion } from '../../../src/scoring/labels/LabelOnLineCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('LabelOnLineCriterion', () => {
  it('finds a label under a flow', async () => {
    const { problems } = new Scorer([new LabelOnLineCriterion()]).score(await Fixtures.read('scoring/label-on-line.bpmn'));

    expect(problems).toEqual([{ kind: 'labelOnLine', ids: ['event_named', 'flow'] }]);
  });
});
