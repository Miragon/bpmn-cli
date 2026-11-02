import { describe, expect, it } from 'vitest';
import { ThroughCriterion } from '../../../src/scoring/flows/ThroughCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ThroughCriterion', () => {
  it('finds a flow over a task it does not connect', async () => {
    const { problems } = new Scorer([new ThroughCriterion()]).score(await Fixtures.read('scoring/through.bpmn'));

    expect(problems).toEqual([{ kind: 'through', ids: ['flow_over_task', 'task_passed'] }]);
  });
});
