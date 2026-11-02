import { describe, expect, it } from 'vitest';
import { ElementSlots } from '../../../src/model/kinds/ElementSlots.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementSlots', () => {
  it.each([
    ['definition.message', { slot: 'definition', key: 'message' }],
    ['condition.language', { slot: 'condition', key: 'language' }],
    ['definition[1].timer', { slot: 'definition[1]', key: 'timer' }],
    ['camunda:foo.bar', undefined],
    ['plain', undefined],
    ['.hidden', undefined],
  ])('splits the key "%s" into a slot and the key inside it: %j', (key, split) => {
    expect(ElementSlots.splitKey(key)).toEqual(split);
  });

  it.each([
    ['definition', { slot: 'definition', text: 'definition' }],
    ['definition[1]', { slot: 'definition', text: 'definition[1]', index: 1 }],
    ['definition[ timer ]', { slot: 'definition', text: 'definition[ timer ]', trigger: 'timer' }],
    ['loop[none]', { slot: 'loop', text: 'loop[none]', invalid: 'none' }],
    ['condition[x y]', { slot: 'condition', text: 'condition[x y]', invalid: 'x y' }],
    [' loop ', { slot: 'loop', text: 'loop' }],
    ['bogus', undefined],
  ])('reads "%s" as the reference to a nested slot: %j', (text, reference) => {
    expect(ElementSlots.parseRef(text)).toEqual(reference);
  });

  it('offers the slots an element has: events a definition, activities a loop, flows and conditional events a condition', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const slotsOf = (id: string): string[] => ElementSlots.slotsOf(document.tree.require(id));

    expect(['start_timer', 'task_review', 'flow_start', 'catch_condition', 'gateway_choice'].map(slotsOf)).toEqual([['definition'], ['loop'], ['condition'], ['definition', 'condition'], []]);
  });

  it('lists the event definitions of an event and none for other elements', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(ElementSlots.definitionsOf(document.tree.require('end_two')).map((definition) => definition.id)).toEqual(['message_out', 'signal_out']);
    expect(ElementSlots.definitionsOf(document.tree.require('task_review'))).toEqual([]);
  });

  it('lists the filled slots with their prefix, indexing definitions only when there are several', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const entriesOf = (id: string): string[][] => ElementSlots.entriesOf(document.tree.require(id)).map((entry) => [entry.slot, entry.prefix, entry.el.type]);

    expect(entriesOf('end_two')).toEqual([['definition', 'definition[0]', 'bpmn:MessageEventDefinition'], ['definition', 'definition[1]', 'bpmn:SignalEventDefinition']]);
    expect(entriesOf('catch_condition')).toEqual([['definition', 'definition', 'bpmn:ConditionalEventDefinition'], ['condition', 'condition', 'bpmn:FormalExpression']]);
    expect(entriesOf('task_send')).toEqual([['loop', 'loop', 'bpmn:StandardLoopCharacteristics']]);
    expect(entriesOf('flow_start')).toEqual([]);
  });
});
