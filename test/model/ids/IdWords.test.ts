import { describe, expect, it } from 'vitest';
import { IdWords } from '../../../src/model/ids/IdWords.js';

describe('IdWords', () => {
  it.each([
    ['userTask_CheckInvoice', 'CheckInvoice'],
    ['task_After_Check_2', 'After_Check_2'],
    ['flow_AB12', 'AB12'],
    ['StartEvent_1', undefined],
    ['Activity_0f3k9d2', undefined],
    ['task_1234', undefined],
    ['gateway_ab1234x', undefined],
    ['abc123', undefined],
  ])('reads the id "%s" as the speaking stem %j', (id, stem) => {
    expect(IdWords.speakingStem(id)).toBe(stem);
  });

  it('splits a stem into words at humps, digits and separators', () => {
    expect(IdWords.stemWords('AfterCheck_2')).toEqual(['After', 'Check', '2']);
    expect(IdWords.stemWords('HTTPServer')).toEqual(['HTTP', 'Server']);
  });

  it('compares the first word of two slugs without regard to case', () => {
    expect(IdWords.beginAlike('CheckInvoice', 'check_pay')).toBe(true);
    expect(IdWords.beginAlike('Check', 'Pay')).toBe(false);
  });

  it.each([
    ['startEvent', 'timer', false, 'TimerStart'],
    ['startEvent', 'none', false, 'Start'],
    ['endEvent', undefined, false, 'End'],
    ['boundaryEvent', 'error', false, 'Error'],
    ['boundaryEvent', undefined, false, 'Boundary'],
    ['intermediateCatchEvent', undefined, false, 'Catch'],
    ['intermediateThrowEvent', 'link', false, 'LinkThrow'],
    ['intermediateThrowEvent', undefined, false, 'Intermediate'],
    ['exclusiveGateway', undefined, false, 'Exclusive'],
    ['bpmn:Process', undefined, false, 'Main'],
    ['bpmn:Message', undefined, false, 'Message'],
    ['userTask', undefined, false, 'UserTask'],
    ['userTask', undefined, true, ''],
    ['startEvent', 'message', true, 'MessageStart'],
  ])('names the kind %s with the trigger %s (with context: %s) "%s"', (key, trigger, withContext, word) => {
    expect(IdWords.kindWord(key, trigger, withContext)).toBe(word);
  });

  it('changes the case of a first letter and takes the local part of a type', () => {
    expect([IdWords.lcfirst('Task'), IdWords.ucfirst('task'), IdWords.localName('bpmn:UserTask')]).toEqual(['task', 'Task', 'UserTask']);
    expect([IdWords.caseLike('Task_', true), IdWords.caseLike('task_', false)]).toEqual(['task_', 'Task_']);
  });
});
