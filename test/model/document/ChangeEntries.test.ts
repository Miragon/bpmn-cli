import { describe, expect, it } from 'vitest';
import { ChangeEntries } from '../../../src/model/document/ChangeEntries.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ChangeEntries', () => {
  it('describes an element by id, kind and name', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');

    expect(ChangeEntries.of(tree.require('start_timer'), 'added')).toEqual({ id: 'start_timer', kind: 'startEvent:timer', name: 'Every hour', detail: 'added' });
    expect(ChangeEntries.of(tree.require('end_plain'))).toEqual({ id: 'end_plain', kind: 'endEvent' });
  });

  it('names a group by its category value', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');

    expect(ChangeEntries.of(tree.require('group_review')).name).toBe('Review');
  });

  it('describes a flow by its ends, with the ends unknown shown as such', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const flow = tree.require('flow_yes');

    expect(ChangeEntries.ofFlow(flow)).toEqual({ id: 'flow_yes', kind: 'sequenceFlow', name: 'yes', detail: 'gateway_choice -> task_send' });
    expect(ChangeEntries.ofFlow(tree.build('bpmn:SequenceFlow', { id: 'flow_loose' })).detail).toBe('? -> ?');
    expect(ChangeEntries.ofFlow(flow, 'moved').detail).toBe('moved');
  });

  it('remembers which element an entry is about, outside its JSON', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const task = tree.require('task_send');
    const entry = ChangeEntries.of(task);

    expect(ChangeEntries.elementOf(entry)).toBe(task);
    expect(ChangeEntries.elementOf(ChangeEntries.about({}, undefined))).toBeUndefined();
    expect(Object.keys(entry)).toEqual(['id', 'kind', 'name']);
  });

  it('notes how a flow got its id', () => {
    expect(ChangeEntries.renamedNote('')).toBe(' (id added: it had none)');
    expect(ChangeEntries.renamedNote('flow_a')).toBe(' (renamed from flow_a: its id named its old ends)');
    expect(ChangeEntries.renamedNote(undefined)).toBe('');
  });

  it('follows a retype to the element that took the place, and stops at a loop', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const [first, second, third] = [tree.require('task_send'), tree.require('task_review'), tree.require('task_inside')];

    ChangeEntries.recordReplacement(first, first);
    expect(ChangeEntries.successorOf(first)).toBe(first);
    ChangeEntries.recordReplacement(first, second);
    ChangeEntries.recordReplacement(second, third);
    expect(ChangeEntries.successorOf(first)).toBe(third);
    ChangeEntries.recordReplacement(third, first);
    expect([first, second, third]).toContain(ChangeEntries.successorOf(first));
  });
});
