import { describe, expect, it } from 'vitest';
import { KindParser } from '../../../src/model/kinds/KindParser.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('KindParser', () => {
  it.each([
    ['userTask', 'userTask', undefined],
    ['bpmn:UserTask', 'userTask', undefined],
    ['BPMN:userTask', 'userTask', undefined],
    ['user', 'userTask', undefined],
    [' xor ', 'exclusiveGateway', undefined],
    ['subprocess', 'subProcess', undefined],
    ['startEvent:message', 'startEvent', 'message'],
    ['start:msg', 'startEvent', 'message'],
    ['bpmn:startEvent:timer', 'startEvent', 'timer'],
    ['boundary:time', 'boundaryEvent', 'timer'],
  ])('reads the token "%s" as the kind %s with the trigger %s', (token, kind, trigger) => {
    const parsed = KindParser.parse(token);

    expect(parsed.def.kind).toBe(kind);
    expect(parsed.trigger).toBe(trigger);
  });

  it('refuses a trigger on a task, an unknown trigger and a trigger the event cannot have', () => {
    expect(() => KindParser.parse('task:timer')).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining('is not an event') }));
    expect(() => KindParser.parse('startEvent:bogus')).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining('Unknown event trigger "bogus"') }));
    expect(() => KindParser.parse('startEvent:terminate')).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining('not allowed on startEvent') }));
  });

  it('refuses an unknown kind with the kinds it may have meant, and a choreography as unsupported', () => {
    expect(() => KindParser.parse('usertsk')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_KIND', details: expect.objectContaining({ candidates: ['userTask'] }) }));
    expect(() => KindParser.parse('choreographyTask')).toThrow(expect.objectContaining({ code: 'E_UNSUPPORTED_KIND', message: expect.stringContaining('choreographies are not supported') }));
  });

  it('turns the refusal of a token into a usage error that points to the list of kinds', () => {
    expect(() => KindParser.assertToken('bpmn:userTask')).not.toThrow();
    expect(() => KindParser.assertToken('x')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_KIND', category: 'usage', details: expect.objectContaining({ hint: 'Run `bpmn kinds` for the full list of kinds and triggers.' }) }));
  });

  it('reads an event sub-process with the trigger of the start event inside it', () => {
    const parsed = KindParser.parseToAdd('eventSub:message');

    expect([parsed.def.kind, parsed.trigger]).toEqual(['eventSubProcess', 'message']);
    expect(KindParser.parseToAdd('eventSubProcess').trigger).toBeUndefined();
    expect(KindParser.parseToAdd('userTask').def.kind).toBe('userTask');
  });

  it('refuses a trigger an event sub-process cannot start with, naming the triggers that it can', () => {
    expect(() => KindParser.parseToAdd('eventSubProcess:terminate')).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', details: expect.objectContaining({ candidates: ['message', 'timer', 'signal', 'conditional', 'error', 'escalation', 'compensate'] }) }));
    expect(() => KindParser.parseToAdd('foo:bar')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_KIND' }));
  });

  it('suggests the kinds closest to a mistyped token, at most as many as asked for', () => {
    expect(KindParser.suggest('usertsk')).toEqual(['userTask']);
    expect(KindParser.suggest('gate')).toEqual(['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'complexGateway']);
    expect(KindParser.suggest('bpmn:servicetask', 2)).toEqual(['serviceTask', 'task']);
    expect(KindParser.suggest('zzzzzzzz')).toEqual([]);
  });

  it('filters elements by kind, by kind and trigger, and by the names of kinds that only exist as types', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const matching = (kind: string): string[] => {
      const matches = KindParser.filter(kind);
      return ['task_review', 'start_timer', 'start_message', 'sub_events', 'flow_yes', 'association_note'].filter((id) => matches(document.tree.require(id)));
    };

    expect(matching('userTask')).toEqual(['task_review']);
    expect(matching('startEvent')).toEqual(['start_timer', 'start_message']);
    expect(matching('startEvent:timer')).toEqual(['start_timer']);
    expect(matching('sequenceFlow')).toEqual(['flow_yes']);
    expect(matching('Association')).toEqual(['association_note']);
  });

  it('refuses a filter that names no kind, offering the extra kinds that contain it', () => {
    expect(() => KindParser.filter('gateway')).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
    expect(() => KindParser.filter('flow')).toThrow(expect.objectContaining({ details: expect.objectContaining({ candidates: ['sequenceFlow', 'messageFlow'] }) }));
  });
});
