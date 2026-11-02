import { describe, expect, it } from 'vitest';
import { FlowLine } from '../../../src/views/lines/FlowLine.js';

const task = { id: 'Task_1', kind: 'task' };

describe('FlowLine', () => {
  it('says what a sequence flow carries, a long condition cut unless asked for whole', () => {
    const condition = `\${${'a'.repeat(130)}}`;

    expect(new FlowLine({ name: 'yes', condition: '${ok}', default: true }).traits()).toEqual(['"yes"', 'if ${ok}', 'default']);
    expect(new FlowLine({ condition }).traits()[0]).toHaveLength(123);
    expect(new FlowLine({ condition }).traits(true)).toEqual([`if ${condition}`]);
    expect(new FlowLine({ conditionResource: 'check.groovy' }).traits()).toEqual(['if resource check.groovy']);
  });

  it('prints an outgoing flow as its target with the flow in brackets', () => {
    expect(FlowLine.outgoing({ id: 'Flow_1', kind: 'sequenceFlow', target: task })).toBe('Task_1 (Flow_1)');
    expect(FlowLine.outgoing({ id: 'Flow_1', kind: 'sequenceFlow', target: task, name: 'no', language: 'groovy', attrs: { 'camunda:x': '1' } })).toBe('Task_1 (Flow_1 "no" [language=groovy, camunda:x=1])');
  });

  it('prints a message flow with both ends and its message', () => {
    const pool = { id: 'Pool_1', kind: 'participant', name: 'Bank' };

    expect(FlowLine.message({ id: 'Flow_M', source: task, target: pool })).toBe('messageFlow Flow_M: Task_1 -> Pool_1 "Bank"');
    expect(FlowLine.message({ id: 'Flow_M', name: 'Order', source: pool, target: task, message: 'Order' })).toBe('messageFlow Flow_M "Order": Pool_1 "Bank" -> Task_1 [message Order]');
  });
});
