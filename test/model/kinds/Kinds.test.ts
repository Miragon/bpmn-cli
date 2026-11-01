import { describe, expect, it } from 'vitest';
import { Kinds } from '../../../src/model/kinds/Kinds.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Kinds', () => {
  it('finds a kind by its name and nothing for a name it does not know', () => {
    expect(Kinds.byName('userTask')?.type).toBe('bpmn:UserTask');
    expect(Kinds.byName('bpmn:UserTask')).toBeUndefined();
  });

  it('tells an event sub-process from a sub-process, an ad-hoc sub-process and an element of no kind', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const kindOf = (id: string): string | undefined => Kinds.of(document.tree.require(id))?.kind;

    expect(['sub_events', 'sub_adhoc', 'task_review', 'start_message', 'flow_yes'].map(kindOf)).toEqual(['eventSubProcess', 'adHocSubProcess', 'userTask', 'startEvent', undefined]);
  });

  it('labels an element by its kind and trigger, and by its type when it has no kind', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const labelOf = (id: string): string => Kinds.label(document.tree.require(id));

    expect(['task_review', 'start_timer', 'end_plain', 'boundary_late', 'flow_yes'].map(labelOf)).toEqual(['userTask', 'startEvent:timer', 'endEvent', 'boundaryEvent:error', 'bpmn:SequenceFlow']);
  });

  it('labels an element without a kind by its type in lower camel case, a data association by its own name', async () => {
    const events = await Fixtures.read('model/events.bpmn');
    const gateways = await Fixtures.read('model/gateways.bpmn');

    expect(['flow_yes', 'association_note', 'Process_events'].map((id) => Kinds.labelOrType(events.tree.require(id)))).toEqual(['sequenceFlow', 'association', 'process']);
    expect(Kinds.labelOrType(gateways.tree.require('association_input'))).toBe('dataAssociation');
    expect(Kinds.labelOrType(events.tree.require('start_timer'))).toBe('startEvent:timer');
    expect(Kinds.typeLabel(events.tree.require('Process_events'))).toBe('process');
  });

  it('knows which gateways branch by condition, synchronise and are named as a question', async () => {
    const document = await Fixtures.read('model/gateways.bpmn');
    const flagsOf = (id: string): boolean[] => {
      const gateway = document.tree.require(id);
      return [Kinds.branchesByCondition(gateway), Kinds.ignoresConditions(gateway), Kinds.synchronises(gateway), Kinds.namedAsQuestion(gateway)];
    };

    expect(flagsOf('gateway_any')).toEqual([true, false, true, true]);
    expect(flagsOf('gateway_fork')).toEqual([false, true, true, false]);
    expect(flagsOf('gateway_wait')).toEqual([false, true, false, false]);
    expect(flagsOf('task_other')).toEqual([false, false, false, false]);
  });

  it('answers true only for a sub-process triggered by an event', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect([Kinds.isEventSubProcess(document.tree.require('sub_events')), Kinds.isEventSubProcess(document.tree.require('sub_adhoc')), Kinds.isEventSubProcess(undefined)]).toEqual([true, false, false]);
  });

  it('lists the gateway kinds with their first alias in a sentence', () => {
    expect(Kinds.gatewayList()).toBe('exclusiveGateway (xor), parallelGateway (and), inclusiveGateway (or), complexGateway (complex) or eventBasedGateway (eventBased)');
  });
});
