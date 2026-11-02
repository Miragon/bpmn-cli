import { describe, expect, it } from 'vitest';
import { UnusedRootElements } from '../../../src/edit/consequences/UnusedRootElements.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet } from '../../support/ModelValues.js';

async function onePool() {
  const document = await Fixtures.readForWrite('edit/containers-one-pool.bpmn');
  return { document, rule: new UnusedRootElements(new EditSession(document)) };
}

describe('UnusedRootElements', () => {
  it('finds the messages, errors, signals and escalations nothing refers to', async () => {
    const { rule } = await onePool();

    expect([...rule.findProblems()].map(({ id }) => id)).toEqual(['Message_ping']);
  });

  it('removes a root element and reports it', async () => {
    const { document, rule } = await onePool();
    const changes = new ChangeSet();

    rule.repair(document.tree.require('Message_ping'), changes);

    expect(document.tree.byId('Message_ping')).toBeUndefined();
    expect(changes.removed).toEqual([{ id: 'Message_ping', kind: 'message', detail: 'no longer referenced' }]);
  });
});
