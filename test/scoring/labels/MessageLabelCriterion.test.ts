import { describe, expect, it } from 'vitest';
import { MessageLabelCriterion } from '../../../src/scoring/labels/MessageLabelCriterion.js';
import { Scorer } from '../../../src/scoring/Scorer.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('MessageLabelCriterion', () => {
  it('finds a label far from its message flow, not one beside it', async () => {
    const { problems } = new Scorer([new MessageLabelCriterion()]).score(await Fixtures.read('scoring/message-label.bpmn'));

    expect(problems).toEqual([{ kind: 'messageLabelFar', ids: ['message_far'], detail: '150px' }]);
  });
});
