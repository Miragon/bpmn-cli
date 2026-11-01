import { describe, expect, it } from 'vitest';
import { DefaultFlowKey } from '../../../src/edit/properties/DefaultFlowKey.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet } from '../../support/ModelValues.js';

async function write(id: string, value: string) {
  const document = await Fixtures.readForWrite('edit/properties-flows.bpmn');
  const changes = new ChangeSet();
  new DefaultFlowKey(new EditSession(document)).write(document.tree.require(id), value, changes);
  return { document, changes, split: document.tree.require('gateway_split') };
}

describe('DefaultFlowKey', () => {
  it('makes a flow the default of its gateway from the flow and tells the former default', async () => {
    const { split, document, changes } = await write('flow_juel', 'true');

    expect(split.get('default')).toBe(document.tree.require('flow_juel'));
    expect(changes.changed.map(({ id, detail }) => [id, detail])).toEqual([['flow_other', 'no longer the default flow of gateway_split']]);
  });

  it('makes a flow the default from the gateway and warns about the condition it loses', async () => {
    const { split, document, changes } = await write('gateway_split', 'flow_juel');

    expect(split.get('default')).toBe(document.tree.require('flow_juel'));
    expect(document.tree.require('flow_juel').get('conditionExpression')).toBeUndefined();
    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', element: 'flow_juel', message: expect.stringContaining('Condition "${ok}" of flow_juel') })]);
  });

  it('names a script resource as the condition a default flow loses', async () => {
    const { changes } = await write('flow_resource', 'yes');

    expect(changes.warnings[0]?.message).toContain('Condition "camunda:resource=deployment://check.groovy" of flow_resource');
  });

  it('says nothing when the default stays the same', async () => {
    const { changes } = await write('flow_other', 'on');

    expect(changes.changed).toEqual([]);
    expect(changes.warnings).toEqual([]);
  });

  it.each([
    ['from the flow', 'flow_other', 'false'],
    ['from the flow with an empty value', 'flow_other', ''],
    ['from the gateway', 'gateway_split', ''],
  ])('clears the default %s', async (_case, id, value) => {
    expect((await write(id, value)).split.get('default')).toBeUndefined();
  });

  it('gives an activity a default flow of its own', async () => {
    const { document } = await write('task_plain', 'flow_plain_b');

    expect(document.tree.require('task_plain').get('default')).toBe(document.tree.require('flow_plain_b'));
  });

  it('refuses a flow that does not leave the gateway and lists those that do', async () => {
    await expect(write('task_plain', 'flow_juel')).rejects.toMatchObject({ code: 'E_NOT_OUTGOING', details: { element: 'task_plain', related: ['flow_juel'], candidates: ['flow_plain_a', 'flow_plain_b'] } });
  });

  it('refuses a flow of another node and a node in the place of a flow', async () => {
    await expect(write('gateway_split', 'flow_plain_a')).rejects.toMatchObject({ code: 'E_NOT_OUTGOING' });
    await expect(write('gateway_split', 'task_a')).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });

  it('refuses a default on an element that has none, and on a flow out of a parallel gateway', async () => {
    await expect(write('start', 'flow_in')).rejects.toMatchObject({ code: 'E_UNKNOWN_KEY' });
    await expect(write('flow_fork_a', 'true')).rejects.toMatchObject({ code: 'E_INVALID_DEFAULT' });
  });

  it('refuses a value that is no boolean on a flow', async () => {
    await expect(write('flow_other', 'maybe')).rejects.toMatchObject({ code: 'E_INVALID_VALUE' });
  });
});
