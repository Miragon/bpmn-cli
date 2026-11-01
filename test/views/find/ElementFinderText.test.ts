import { describe, expect, it } from 'vitest';
import { ElementFinderText } from '../../../src/views/find/ElementFinderText.js';

describe('ElementFinderText', () => {
  it('lines the columns up, id first', () => {
    const text = new ElementFinderText([
      { id: 'Activity_Pay', kind: 'serviceTask', name: 'Pay claim', in: 'Lane_Clerks' },
      { id: 'Activity_SendDecision', kind: 'sendTask', name: 'Send decision', in: 'Lane_Clerks' },
    ]).text();

    expect(text.split('\n')).toEqual(['Activity_Pay           serviceTask  "Pay claim"      Lane_Clerks', 'Activity_SendDecision  sendTask     "Send decision"  Lane_Clerks']);
  });

  it('adds the vendor value that matched, cut to one line', () => {
    expect(new ElementFinderText([{ id: 'Task_1', kind: 'task', match: `camunda:topic=${'x'.repeat(120)}` }]).text()).toContain(`[camunda:topic=${'x'.repeat(83)}...]`);
  });

  it('keeps a name and a value over lines on the line of its hit', () => {
    const text = new ElementFinderText([{ id: 'Task_1', kind: 'task', name: 'Check\nthe\torder', match: 'camunda:topic=first\nsecond' }]).text();

    expect(text).toBe('Task_1  task  "Check the order"    [camunda:topic=first second]');
  });

  it('prints nothing for no hit', () => {
    expect(new ElementFinderText([]).text()).toBe('');
  });
});
