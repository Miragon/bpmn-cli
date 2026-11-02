import { describe, expect, it } from 'vitest';
import { MessageThroughPoolCriterion } from '../../../src/scoring/flows/MessageThroughPoolCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('MessageThroughPoolCriterion', () => {
  it('finds a message flow across a third pool, not across the pools it connects', async () => {
    const { problems } = new Scorer([new MessageThroughPoolCriterion()]).score(await Fixtures.read('scoring/message-through-pool.bpmn'));

    expect(problems).toEqual([{ kind: 'msgThroughPool', ids: ['message', 'pool_passed'] }]);
  });
});
