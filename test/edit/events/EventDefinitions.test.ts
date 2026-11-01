import { describe, expect, it } from 'vitest';
import { EventDefinitions } from '../../../src/edit/events/EventDefinitions.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import type { BpmnElement } from '../../support/ModelValues.js';

async function editing(platform?: 'c8') {
  const document = await Fixtures.readForWrite('edit/events-triggers.bpmn');
  return { document, events: new EventDefinitions(new EditSession(document, platform)) };
}

function definitionOf(event: BpmnElement): BpmnElement {
  return event.list('eventDefinitions')[0]!;
}

describe('EventDefinitions', () => {
  it('refuses a trigger on an element that is no event', async () => {
    const { document, events } = await editing();

    expect(() => events.setTrigger(document.tree.require('task_work'), 'timer')).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
  });

  it.each([
    ['a timer on an end event', 'end_plain', 'timer', 'Trigger "timer" is not allowed on endEvent'],
    ['an error start outside an event sub-process', 'start_plain', 'error', 'A startEvent:error is only allowed inside an event sub-process'],
    ['a compensation start outside an event sub-process', 'start_plain', 'compensate', 'A startEvent:compensate is only allowed inside an event sub-process'],
  ] as const)('refuses %s', async (_case, id, trigger, message) => {
    const { document, events } = await editing();

    expect(() => events.setTrigger(document.tree.require(id), trigger)).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining(message) }));
  });

  it('takes an error start inside an event sub-process', async () => {
    const { document, events } = await editing();
    const start = document.tree.require('handler_plain');

    events.setTrigger(start, 'error', { error: 'Late' });

    expect(definitionOf(start).get<BpmnElement>('errorRef').id).toBe('Error_late');
  });

  it.each([
    ['R/PT1H', undefined, 'timeCycle'],
    ['P1D', undefined, 'timeDuration'],
    ['2030-01-01T00:00:00Z', undefined, 'timeDate'],
    ['${when}', 'duration', 'timeDuration'],
  ] as const)('reads %s with kind %s as the %s of a new timer', async (timer, timerKind, property) => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_message');

    events.setTrigger(event, 'timer', { timer, timerKind });

    expect(definitionOf(event).get<BpmnElement>(property).get('body')).toBe(timer);
  });

  it.each([
    ['an empty timer', 'catch_message', 'timer', { timer: '  ' }],
    ['a timer kind BPMN does not know', 'catch_message', 'timer', { timer: 'PT1H', timerKind: 'weekly' }],
    ['an empty condition', 'catch_message', 'conditional', { when: ' ' }],
    ['an empty timer on the timer it has', 'boundary_timer', 'timer', { timer: '' }],
    ['an empty condition on the condition it has', 'catch_groovy', 'conditional', { when: '' }],
  ] as never[])('refuses %s', async (_case, id: string, trigger: 'timer', options: object) => {
    const { document, events } = await editing();

    expect(() => events.setTrigger(document.tree.require(id), trigger, options)).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE' }));
  });

  it.each([
    ['message', 'Paid', 'messageRef', 'Message_paid'],
    ['signal', 'Stop', 'signalRef', 'Signal_stop'],
    ['escalation', 'Escalation_up', 'escalationRef', 'Escalation_up'],
    ['error', 'Late', 'errorRef', 'Error_late'],
  ] as const)('points a new %s definition at the root element with that name or id', async (trigger, name, property, root) => {
    const { document, events } = await editing();
    const event = document.tree.require('end_plain');

    events.setTrigger(event, trigger, { [trigger]: name });

    expect(definitionOf(event).get<BpmnElement>(property).id).toBe(root);
  });

  it('writes the code of an error and of an escalation onto their root elements, new or existing', async () => {
    const { document, events } = await editing();

    events.setTrigger(document.tree.require('end_plain'), 'error', { error: 'Broken', errorCode: 'E9' });
    events.setTrigger(document.tree.require('throw_plain'), 'escalation', { escalation: 'Higher', escalationCode: 'E8' });
    events.setTrigger(document.tree.require('end_error'), 'error', { error: 'Late', errorCode: 'E2' });
    events.setTrigger(document.tree.require('end_escalation'), 'escalation', { escalation: 'Up', escalationCode: 'E3' });

    expect(document.tree.rootElementsOfType('bpmn:Error').at(-1)?.get('errorCode')).toBe('E9');
    expect(document.tree.rootElementsOfType('bpmn:Escalation').at(-1)?.get('escalationCode')).toBe('E8');
    expect(document.tree.require('Error_late').get('errorCode')).toBe('E2');
    expect(document.tree.require('Escalation_up').get('escalationCode')).toBe('E3');
  });

  it('builds a condition around its expression', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_message');

    events.setTrigger(event, 'conditional', { when: '${ok}' });

    expect(definitionOf(event).get<BpmnElement>('condition').get('body')).toBe('${ok}');
  });

  it.each([
    ['timer', 'timeDuration'],
    ['message', 'messageRef'],
    ['conditional', 'condition'],
  ] as const)('builds a %s definition without detail when no option names one', async (trigger, property) => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_signal');

    events.setTrigger(event, trigger);

    expect(definitionOf(event).get(property)).toBeUndefined();
  });

  it('names a new link after the option, else after the event, else not at all', async () => {
    const { document, events } = await editing();
    const [named, fromEvent] = [document.tree.require('throw_plain'), document.tree.require('catch_message')];

    events.setTrigger(named, 'link', { link: 'Hop' });
    events.setTrigger(fromEvent, 'link');
    document.tree.require('catch_signal').set('name', undefined);
    events.setTrigger(document.tree.require('catch_signal'), 'link');

    expect(definitionOf(named).get('name')).toBe('Hop');
    expect(definitionOf(fromEvent).get('name')).toBe('Paid');
    expect(definitionOf(document.tree.require('catch_signal')).get('name')).toBeUndefined();
  });

  it('gives a trigger without detail its bare definition, with an id on Camunda 8, and takes it away again with none', async () => {
    const { document, events } = await editing('c8');
    const event = document.tree.require('end_plain');

    events.setTrigger(event, 'terminate');
    expect(definitionOf(event).get<string>('id')).toContain('terminateEventDefinition');
    events.setTrigger(event, 'none');

    expect(event.list('eventDefinitions')).toEqual([]);
  });

  it('keeps one matching definition and warns about the others', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_both');

    const warnings = events.setTrigger(event, 'timer', { timer: 'PT2H' });

    expect(warnings.map(({ code }) => code)).toEqual(['W_PROPERTY_DROPPED']);
    expect(definitionOf(event).id).toBe('both_timer');
    expect(definitionOf(event).get<BpmnElement>('timeDuration').get('body')).toBe('PT2H');
  });

  it('replaces two definitions of the same trigger by a new one', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_twice');

    events.setTrigger(event, 'message', { message: 'Paid' });

    expect(event.list('eventDefinitions')).toHaveLength(1);
    expect(definitionOf(event).id).not.toBe('twice_first');
  });

  it('moves the expression of a timer that changes kind, and drops a second timer', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('boundary_timer');
    const double = document.tree.require('catch_double_timer');

    events.setTrigger(event, 'timer', { timer: 'R/PT9M' });
    events.setTrigger(double, 'timer', { timer: 'PT9M', timerKind: 'cycle' });

    expect(definitionOf(event).get('timeDuration')).toBeUndefined();
    expect(definitionOf(event).get<BpmnElement>('timeCycle').get('body')).toBe('R/PT9M');
    expect(definitionOf(double).get('timeDuration')).toBeUndefined();
    expect(definitionOf(double).get<BpmnElement>('timeCycle').get('body')).toBe('PT9M');
  });

  it('gives a bare timer its expression and keeps a timer no option changes', async () => {
    const { document, events } = await editing();
    const bare = document.tree.require('catch_bare_timer');
    const kept = document.tree.require('boundary_timer');

    events.setTrigger(bare, 'timer', { timer: 'PT1M' });
    events.setTrigger(kept, 'timer', { timer: 'PT5M' });
    events.setTrigger(kept, 'timer');

    expect(definitionOf(bare).get<BpmnElement>('timeDuration').get('body')).toBe('PT1M');
    expect(definitionOf(kept).get<BpmnElement>('timeDuration').get('body')).toBe('PT5M');
  });

  it('repoints the definition an event has at the root element named, and only when it differs', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_message');
    const definition = definitionOf(event);

    events.setTrigger(event, 'message', { message: 'Paid' });
    expect(definition.get<BpmnElement>('messageRef').id).toBe('Message_paid');
    events.setTrigger(event, 'message', { message: 'Fresh' });
    events.setTrigger(event, 'message');

    expect(definitionOf(event)).toBe(definition);
    expect(definition.get<BpmnElement>('messageRef').get('name')).toBe('Fresh');
  });

  it('renames the link of a link event, clears it, and leaves it without an option', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_link');
    const definition = definitionOf(event);

    events.setTrigger(event, 'link');
    expect(definition.get('name')).toBe('Go');
    events.setTrigger(event, 'link', { link: 'Stay' });
    expect(definition.get('name')).toBe('Stay');
    events.setTrigger(event, 'link', { link: '' });

    expect(definition.get('name')).toBeUndefined();
  });

  it('drops the script resource and language when an inline condition replaces them', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_script');

    const [warning] = events.setTrigger(event, 'conditional', { when: '${ok}' });
    const condition = definitionOf(event).get<BpmnElement>('condition');

    expect(warning?.message).toContain('camunda:resource check.groovy and language groovy of the condition of catch_script were dropped: the new inline condition replaces the script resource');
    expect(condition.attrs['camunda:resource']).toBeUndefined();
    expect(condition.get('language')).toBeUndefined();
    expect(condition.get('body')).toBe('${ok}');
  });

  it('drops a script language under an expression and keeps it under script text', async () => {
    const { document, events } = await editing();
    const event = document.tree.require('catch_groovy');
    const condition = definitionOf(event).get<BpmnElement>('condition');

    expect(events.setTrigger(event, 'conditional', { when: 'return true' })).toEqual([]);
    expect(condition.get('language')).toBe('groovy');
    const [warning] = events.setTrigger(event, 'conditional', { when: '${ok}' });

    expect(warning?.message).toContain('language groovy of the condition of catch_groovy was dropped: the new inline condition replaces the script');
    expect(condition.get('language')).toBeUndefined();
  });

  it('keeps the juel language under an expression, and a condition without a change', async () => {
    const { document, events } = await editing();
    const juel = document.tree.require('catch_juel');
    const bare = document.tree.require('catch_bare_condition');

    expect(events.setTrigger(juel, 'conditional', { when: '${new}' })).toEqual([]);
    expect(events.setTrigger(juel, 'conditional', { when: '${new}' })).toEqual([]);
    expect(events.setTrigger(juel, 'conditional')).toEqual([]);
    events.setTrigger(bare, 'conditional', { when: '${ok}' });

    expect(definitionOf(juel).get<BpmnElement>('condition').get('language')).toBe('juel');
    expect(definitionOf(bare).get<BpmnElement>('condition').get('body')).toBe('${ok}');
  });
});
