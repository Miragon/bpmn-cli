import { describe, expect, it } from 'vitest';
import { NestedSlots } from '../../../src/edit/properties/NestedSlots.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

async function setKey(id: string, slot: string, key: string, value: string, replacing = false) {
  const document = await Fixtures.readForWrite('edit/properties-nested.bpmn');
  const element = document.tree.require(id);
  const changes = new ChangeSet();
  new NestedSlots(new EditSession(document)).setKey(element, slot, key, value, changes, replacing);
  return { document, element, changes, definition: element.list<BpmnElement>('eventDefinitions')[0] };
}

describe('NestedSlots', () => {
  it('writes a property of the event definition and records it under its full key', async () => {
    const { definition, changes } = await setKey('throw_link', 'definition', 'name', 'Elsewhere');

    expect(definition?.get('name')).toBe('Elsewhere');
    expect(changes.changed.map(({ detail }) => detail)).toEqual(['definition.name=Elsewhere']);
  });

  it('removes a property and a stray attribute of the event definition with an empty value', async () => {
    const { definition, changes } = await setKey('throw_link', 'definition', 'name', '');

    expect(definition?.get('name')).toBeUndefined();
    expect(changes.changed.map(({ detail }) => detail)).toEqual(['definition.name removed']);
    expect((await setKey('throw_link', 'definition', 'flavour', '')).definition?.attrs).not.toHaveProperty('flavour');
  });

  it('takes a selected definition', async () => {
    const { element } = await setKey('end_mixed', 'definition[1]', 'id', 'signal_renamed');

    expect(element.list<BpmnElement>('eventDefinitions').map(({ id }) => id)).toEqual(['message_mixed', 'signal_renamed']);
  });

  it('does nothing when it removes from a slot that is empty', async () => {
    expect((await setKey('task_outer', 'loop', 'camunda:collection', '')).changes.changed).toEqual([]);
  });

  it('renames a nested element and frees its old id', async () => {
    const { definition, document } = await setKey('throw_link', 'definition', 'id', 'link_renamed');

    expect(definition?.id).toBe('link_renamed');
    expect(document.ids.registry.has('link_out')).toBe(false);
  });

  it('gives an id to a nested element without one', async () => {
    const { document, definition } = await setKey('catch_message', 'definition', 'id', 'message_given');

    expect(definition?.id).toBe('message_given');
    expect(document.ids.registry.has('message_given')).toBe(true);
  });

  it('creates a parallel multi-instance loop for a loop key and says so', async () => {
    const { element, changes } = await setKey('task_outer', 'loop', 'camunda:collection', 'items');

    expect(element.get<BpmnElement>('loopCharacteristics').attrs['camunda:collection']).toBe('items');
    expect(changes.notes).toEqual(['task_outer: created a parallel multi-instance loop for loop.camunda:collection']);
  });

  it('creates a script condition on a flow without one', async () => {
    const { element } = await setKey('flow_plain', 'condition', 'camunda:resource', 'deployment://new.groovy');

    expect(element.get<BpmnElement>('conditionExpression').attrs['camunda:resource']).toBe('deployment://new.groovy');
  });

  it('takes a default flow out of the default when it gets a script condition', async () => {
    const { document, changes } = await setKey('flow_default', 'condition', 'camunda:resource', 'deployment://new.groovy');

    expect(document.tree.require('gateway_split').get('default')).toBeUndefined();
    expect(changes.changed[0]?.detail).toBe('no longer the default flow of gateway_split');
  });

  it('takes a vendor attribute Camunda does not know', async () => {
    expect((await setKey('throw_link', 'definition', 'camunda:flavour', 'on')).definition?.attrs['camunda:flavour']).toBe('on');
  });

  it('coerces a Camunda boolean of a nested element', async () => {
    expect((await setKey('task_multi', 'loop', 'camunda:asyncBefore', 'yes')).element.get<BpmnElement>('loopCharacteristics').attrs['camunda:asyncBefore']).toBe('true');
  });

  it('drops the inline body of a flow for a script resource and warns', async () => {
    const { element, changes } = await setKey('flow_juel', 'condition', 'camunda:resource', 'deployment://new.groovy');

    expect(element.get<BpmnElement>('conditionExpression').get('body')).toBeUndefined();
    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', message: expect.stringContaining('The condition "${ok}" of flow_juel was dropped'), hint: expect.stringContaining("'condition=<expression>'") })]);
  });

  it('drops the inline body of a conditional event and asks for when= to go back', async () => {
    const { changes } = await setKey('catch_inline', 'condition', 'camunda:resource', 'deployment://new.groovy');

    expect(changes.warnings[0]?.hint).toContain("'when=<expression>'");
  });

  it('warns about nothing when the condition it gives a resource had no body', async () => {
    expect((await setKey('flow_script', 'condition', 'camunda:resource', 'deployment://new.groovy')).changes.warnings).toEqual([]);
  });

  it.each<[string, string, string, boolean]>([
    ['the same command replaces it', 'flow_script', 'camunda:resource', true],
    ['the condition keeps an inline body', 'flow_both', 'camunda:resource', false],
    ['the key is no resource', 'flow_script', 'language', false],
  ])('removes a key of a condition when %s', async (_case, id, key, replacing) => {
    const condition = (await setKey(id, 'condition', key, '', replacing)).element.get<BpmnElement>('conditionExpression');

    expect(condition.attrs[key] ?? condition.get(key)).toBeUndefined();
  });

  it('compensates an activity of its own scope, and of the scope around an event sub-process', async () => {
    const own = await setKey('throw_compensate', 'definition', 'activityRef', 'task_outer');
    const around = await setKey('throw_event_sub', 'definition', 'activityRef', 'task_inner');

    expect(own.definition?.get('activityRef')).toBe(own.document.tree.require('task_outer'));
    expect(around.definition?.get('activityRef')).toBe(around.document.tree.require('task_inner'));
  });

  it.each<[string, string, string, string, string, object]>([
    ['a slot the element lacks', 'task_outer', 'definition', 'name', 'x', { code: 'E_UNKNOWN_KEY' }],
    ['a slot BPMN does not know', 'task_outer', 'nosuch', 'name', 'x', { code: 'E_UNKNOWN_KEY' }],
    ['no key after the slot', 'task_outer', 'loop', '', 'x', { code: 'E_UNKNOWN_KEY' }],
    ['a slot on an element that has none', 'gateway_split', 'loop', 'name', 'x', { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('has no nested element to address') }],
    ['an empty id', 'throw_link', 'definition', 'id', '', { code: 'E_INVALID_VALUE' }],
    ['an id the file uses', 'throw_link', 'definition', 'id', 'task_outer', { code: 'E_DUPLICATE_ID' }],
    ['a Camunda boolean it cannot read', 'task_multi', 'loop', 'camunda:asyncBefore', 'maybe', { code: 'E_INVALID_VALUE' }],
    ['a key the new loop lacks', 'task_outer', 'loop', 'nosuch', 'x', { code: 'E_UNKNOWN_KEY' }],
    ['a key the event definition lacks', 'throw_link', 'definition', 'nosuch', 'x', { code: 'E_UNKNOWN_KEY', details: expect.objectContaining({ candidates: expect.arrayContaining(['definition.id', 'definition.name']) }) }],
    ['the body of a condition', 'flow_juel', 'condition', 'body', 'x', { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('use condition= / when=') }],
    ['a definition key on an event without a trigger, naming the trigger that fits', 'throw_none', 'definition', 'camunda:class', 'x', { code: 'E_NO_NESTED_ELEMENT', details: expect.objectContaining({ hint: expect.stringContaining('trigger=message') }) }],
    ['a plain definition key on an event without a trigger', 'throw_none', 'definition', 'name', 'x', { code: 'E_NO_NESTED_ELEMENT', details: expect.objectContaining({ hint: expect.stringContaining('trigger=<trigger>') }) }],
    ['a condition key on a flow without a condition', 'flow_plain', 'condition', 'language', 'groovy', { code: 'E_NO_NESTED_ELEMENT', details: expect.objectContaining({ hint: expect.stringContaining('condition=<expression>') }) }],
    ['a condition key on a conditional event without a condition', 'catch_conditional', 'condition', 'language', 'groovy', { code: 'E_NO_NESTED_ELEMENT', details: expect.objectContaining({ hint: expect.stringContaining('when=<expression>') }) }],
    ['a Zeebe attribute of an extension element', 'task_multi', 'loop', 'zeebe:inputCollection', '=items', { code: 'E_WRONG_HOST', details: expect.objectContaining({ hint: expect.stringContaining('bpmn ext add <file> task_multi loop.zeebe:loopCharacteristics inputCollection=<value>') }) }],
    ['a key that needs a multi-instance on a standard loop', 'task_standard', 'loop', 'camunda:collection', 'items', { code: 'E_WRONG_HOST', message: expect.stringContaining('it needs a multi-instance loop'), details: expect.objectContaining({ hint: expect.stringContaining('loop=parallel') }) }],
    ['an attribute of the task itself on its loop', 'task_user', 'loop', 'camunda:assignee', 'alice', { code: 'E_WRONG_HOST', details: expect.objectContaining({ hint: expect.stringContaining('It is an attribute of task_user itself') }) }],
    ['a vendor attribute that fits neither', 'throw_link', 'definition', 'camunda:assignee', 'alice', { code: 'E_WRONG_HOST', details: expect.objectContaining({ hint: 'camunda:assignee belongs on UserTask.' }) }],
    ['leaving the condition of a flow empty', 'flow_script', 'condition', 'camunda:resource', '', { code: 'E_INVALID_VALUE', message: expect.stringContaining('would leave the condition empty'), details: expect.objectContaining({ hint: expect.stringContaining('condition=${...}') }) }],
    ['leaving the condition of a conditional event empty', 'catch_script', 'condition', 'camunda:resource', '', { code: 'E_INVALID_VALUE', message: expect.stringContaining('the condition of the conditional event'), details: expect.objectContaining({ hint: expect.stringContaining('when=${...}') }) }],
    ['compensating an activity of another scope', 'throw_inner', 'definition', 'activityRef', 'task_outer', { code: 'E_CROSS_SCOPE', details: expect.objectContaining({ element: 'throw_inner', related: ['task_outer'], candidates: ['task_inner', 'sub_nested'] }) }],
    ['compensating from a scope without activities', 'throw_alone', 'definition', 'activityRef', 'task_outer', { code: 'E_CROSS_SCOPE', details: expect.objectContaining({ candidates: [], hint: expect.stringContaining('none') }) }],
    ['compensating an element that is no activity', 'throw_compensate', 'definition', 'activityRef', 'gateway_split', { code: 'E_WRONG_KIND' }],
  ])('refuses %s', async (_case, id, slot, key, value, refusal) => {
    await expect(setKey(id, slot, key, value)).rejects.toMatchObject(refusal);
  });
});
