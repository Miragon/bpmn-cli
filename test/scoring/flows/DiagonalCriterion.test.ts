import { describe, expect, it } from 'vitest';
import { DiagonalCriterion } from '../../../src/scoring/flows/DiagonalCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DiagonalCriterion', () => {
  it('finds a slanted sequence flow, not a straight one or a slanted annotation line', async () => {
    const { problems } = new Scorer([new DiagonalCriterion()]).score(await Fixtures.read('scoring/diagonal.bpmn'));

    expect(problems).toEqual([{ kind: 'diagonal', ids: ['flow_slanted'] }]);
  });
});
