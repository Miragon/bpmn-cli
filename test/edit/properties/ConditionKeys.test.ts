import { describe, expect, it } from 'vitest';
import { ConditionKeys } from '../../../src/edit/properties/ConditionKeys.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet, type BpmnElement } from '../../support/ModelValues.js';

async function write(flowId: string, keys: Record<string, string>) {
  const document = await Fixtures.readForWrite('edit/properties-flows.bpmn');
  const flow = document.tree.require(flowId);
  const changes = new ChangeSet();
  new ConditionKeys(new EditSession(document)).write(flow, new Map(Object.entries(keys)), changes);
  return { document, flow, changes, condition: flow.get<BpmnElement | undefined>('conditionExpression') };
}

describe('ConditionKeys', () => {
  it('writes a condition on a flow that had none, with the language it names', async () => {
    const { condition, changes } = await write('flow_other', { condition: 'x > 1', language: 'groovy' });

    expect(condition?.get('body')).toBe('x > 1');
    expect(condition?.get('language')).toBe('groovy');
    expect(changes.changed.map(({ detail }) => detail)).toEqual(['condition=x > 1 (groovy)']);
  });

  it('keeps the script language of a condition that stays a script', async () => {
    const { condition, changes } = await write('flow_script', { condition: 'size > 2' });

    expect(condition?.get('language')).toBe('groovy');
    expect(changes.warnings).toEqual([]);
  });

  it('drops a script language when the new condition is an expression, and warns', async () => {
    const { condition, changes } = await write('flow_script', { condition: '${ok}' });

    expect(condition?.get('language')).toBeUndefined();
    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', message: expect.stringContaining('"${ok}" is an expression, not a groovy script'), hint: expect.stringContaining('language=groovy') })]);
  });

  it('replaces a script resource with an inline condition and names what it dropped', async () => {
    const { condition, changes } = await write('flow_resource', { condition: '${ok}' });

    expect(condition?.attrs['camunda:resource']).toBeUndefined();
    expect(condition?.get('body')).toBe('${ok}');
    expect(changes.warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED', message: expect.stringContaining('camunda:resource deployment://check.groovy and language groovy of the condition of flow_resource were dropped') });
  });

  it('says one thing was dropped when a resource without a language gives way', async () => {
    const document = await Fixtures.readForWrite('edit/properties-flows.bpmn');
    const flow = document.tree.require('flow_resource');
    flow.get<BpmnElement>('conditionExpression').set('language', undefined);
    const changes = new ChangeSet();

    new ConditionKeys(new EditSession(document)).write(flow, new Map([['condition', '${ok}']]), changes);

    expect(changes.warnings[0]?.message).toContain('was dropped');
  });

  it('lets the given language win over the one the condition had', async () => {
    const { condition, changes } = await write('flow_resource', { condition: 'x > 1', language: '' });

    expect(condition?.get('language')).toBeUndefined();
    expect(changes.warnings[0]?.message).toContain('camunda:resource deployment://check.groovy of the condition of flow_resource was dropped');
  });

  it('takes a default flow out of the default when it gets a condition', async () => {
    const document = await Fixtures.readForWrite('edit/properties-flows.bpmn');
    const flow = document.tree.require('flow_juel');
    document.tree.require('gateway_split').set('default', flow);

    new ConditionKeys(new EditSession(document)).write(flow, new Map([['condition', '${other}']]), new ChangeSet());

    expect(document.tree.require('gateway_split').get('default')).toBeUndefined();
  });

  it('removes a condition with an empty value', async () => {
    const { condition, changes } = await write('flow_juel', { condition: '' });

    expect(condition).toBeUndefined();
    expect(changes.changed.map(({ detail }) => detail)).toEqual(['condition removed']);
  });

  it('sets and removes only the language of a condition', async () => {
    const { condition, changes } = await write('flow_juel', { language: 'juel' });

    expect(condition?.get('language')).toBe('juel');
    expect(changes.changed.map(({ detail }) => detail)).toEqual(['language=juel']);
    expect((await write('flow_script', { language: '' })).changes.changed.map(({ detail }) => detail)).toEqual(['language removed']);
  });

  it('removing the language of a flow without a condition does nothing', async () => {
    expect((await write('flow_other', { language: '' })).changes.changed).toEqual([]);
  });

  it.each([
    ['a flow without a condition', 'flow_other', { language: 'groovy' }],
    ['a condition it removes in the same step', 'flow_juel', { condition: '', language: 'groovy' }],
  ])('refuses a language on %s', async (_case, flowId, keys) => {
    await expect(write(flowId, keys)).rejects.toMatchObject({ code: 'E_NO_CONDITION', details: { element: flowId } });
  });

  it('refuses a blank condition', async () => {
    await expect(write('flow_other', { condition: '   ' })).rejects.toMatchObject({ code: 'E_INVALID_VALUE' });
  });

  it.each(['flow_fork_a', 'flow_wait_b'])('keeps a condition off %s, a flow out of a gateway that takes none', async (flowId) => {
    await expect(write(flowId, { condition: '${x}' })).rejects.toMatchObject({ code: 'E_INVALID_VALUE', details: { element: flowId } });
  });
});
