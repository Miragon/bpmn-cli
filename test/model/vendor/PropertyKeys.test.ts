import { describe, expect, it } from 'vitest';
import { PropertyKeys } from '../../../src/model/vendor/PropertyKeys.js';
import { Fixtures } from '../../support/Fixtures.js';

function readThrough(key: string, appliesTo: string, id: string, source: Awaited<ReturnType<typeof Fixtures.read>>): Record<string, unknown> {
  const definition = PropertyKeys.ALL.find((candidate) => candidate.key === key && candidate.appliesTo === appliesTo);
  return definition!.read!(source.tree.require(id), source);
}

describe('PropertyKeys', () => {
  it('lists the keys in the order set documents them, the vendor placeholder ahead of the BPMN ones', () => {
    expect(PropertyKeys.ALL.map(({ key }) => key)).toEqual([
      'id', 'name', 'doc', '<prefix>:<attr>', '<property>', 'condition', 'language', 'default', 'default', 'source', 'target', 'trigger', 'timer', 'message', 'error', 'errorCode', 'signal', 'escalation',
      'escalationCode', 'when', 'link', 'nonInterrupting', 'loop', 'cardinality', 'completion', 'expanded', 'triggeredByEvent', 'message', 'calledDecision', 'definition.<key>', 'loop.<key>',
      'condition.<key>', 'condition.<key>', 'lane', 'text',
    ]);
  });

  it('reads the keys of a user task with a multi-instance loop from the model', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(readThrough('loop', 'activity', 'task_review', document)).toEqual({ loop: 'sequential' });
    expect(readThrough('cardinality', 'activity', 'task_review', document)).toEqual({ cardinality: '3' });
    expect(readThrough('completion', 'activity', 'task_review', document)).toEqual({ completion: '${done}' });
    expect(readThrough('lane', 'flowNode', 'task_review', document)).toEqual({ lane: 'Lane_inside' });
    expect(readThrough('loop', 'activity', 'task_send', document)).toEqual({ loop: 'standard' });
    expect(readThrough('message', 'sendTask, receiveTask', 'task_send', document)).toEqual({ message: 'OrderPlaced' });
  });

  it('reads an event with its trigger, a flow with its condition and default marker, and the documentation joined by lines', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(readThrough('trigger', 'event', 'start_timer', document)).toEqual({ trigger: 'timer', timer: 'R/PT1H' });
    expect(readThrough('doc', 'any', 'start_timer', document)).toEqual({ doc: 'Runs hourly\nTwice a day on weekends' });
    expect(readThrough('condition', 'sequenceFlow', 'flow_yes', document)).toEqual({ condition: '=ok' });
    expect(readThrough('default', 'sequenceFlow', 'flow_no', document)).toEqual({ default: true });
    expect(readThrough('default', 'flowNode', 'gateway_choice', document)).toEqual({ default: 'flow_no' });
  });

  it('reads whether a sub-process is drawn expanded, the completion of an ad-hoc one, and nothing for a loop that is not there', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect([readThrough('expanded', 'subProcess', 'sub_adhoc', document), readThrough('expanded', 'subProcess', 'sub_events', document)]).toEqual([{ expanded: false }, { expanded: true }]);
    expect(readThrough('completion', 'activity', 'sub_adhoc', document)).toEqual({ completion: '${enough}' });
    expect(readThrough('loop', 'activity', 'sub_events', document)).toEqual({});
  });
});
