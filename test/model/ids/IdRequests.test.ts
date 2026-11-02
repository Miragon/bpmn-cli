import { describe, expect, it } from 'vitest';
import { Kinds } from '../../../src/model/kinds/Kinds.js';
import { IdRequests } from '../../../src/model/ids/IdRequests.js';

describe('IdRequests', () => {
  it('asks for an id by the kind of a user task and carries its name, context and anchor along', () => {
    const userTask = Kinds.byName('userTask')!;

    expect(IdRequests.kindRequest(userTask)).toEqual({ key: 'userTask' });
    expect(IdRequests.kindRequest(userTask, { name: 'Review', context: 'After Start', anchorKind: 'Gateway' })).toEqual({ key: 'userTask', name: 'Review', context: 'After Start', anchorKind: 'Gateway' });
  });

  it('asks for an id by a BPMN type such as a message', () => {
    expect(IdRequests.typeRequest('bpmn:Message', { name: 'Order placed' })).toEqual({ key: 'bpmn:Message', name: 'Order placed' });
  });

  it('asks for the id of a flow by its two ends and leaves an empty name out', () => {
    expect(IdRequests.connectionRequest('bpmn:SequenceFlow', 'task_a', 'task_b', { name: 'yes', sourceLabel: 'A', targetLabel: 'B' })).toEqual({ key: 'bpmn:SequenceFlow', source: 'task_a', target: 'task_b', name: 'yes', sourceLabel: 'A', targetLabel: 'B' });
    expect(IdRequests.connectionRequest('bpmn:MessageFlow', 'task_a', 'task_b', { name: '' })).toEqual({ key: 'bpmn:MessageFlow', source: 'task_a', target: 'task_b' });
  });

  it('counts sequence flows and message flows as connections', () => {
    expect([...IdRequests.CONNECTIONS]).toEqual(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);
  });
});
