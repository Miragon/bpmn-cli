import { describe, expect, it } from 'vitest';
import { ElementCatches } from '../../../src/views/element/ElementCatches.js';
import { Fixtures } from '../../support/Fixtures.js';

const claims = async () => {
  const document = await Fixtures.read('models/views/claims.bpmn');
  return { catches: new ElementCatches(document), of: (id: string) => document.tree.require(id) };
};

describe('ElementCatches', () => {
  it('lists the boundary events of an activity with what they catch and lead to', async () => {
    const { catches, of } = await claims();

    expect(catches.boundaryOf(of('Activity_Assess'))).toMatchObject([{ id: 'Event_FraudSuspected', trigger: 'error Fraud (FRAUD)', on: { id: 'Activity_Assess' }, to: [{ id: 'Activity_Investigate' }] }]);
    expect(catches.boundaryOf(of('Gateway_Covered'))).toEqual([]);
  });

  it('lists what the sub-processes around an element catch, not the process', async () => {
    const { catches, of } = await claims();

    expect(catches.around([of('Activity_Assess'), of('Process_Claims')]).map(({ id }) => id)).toEqual(['Event_FraudSuspected']);
    expect(catches.around([of('Process_Claims')])).toEqual([]);
  });

  it('lists the event sub-processes around an element with their start', async () => {
    const { catches, of } = await claims();

    expect(catches.eventSubProcesses(of('Activity_Pay'), [of('Process_Claims')])).toMatchObject([{ id: 'Activity_OnCancel', in: { id: 'Process_Claims' }, start: { id: 'Event_CancelRequested', nonInterrupting: true } }]);
  });

  it('does not list an event sub-process for what lies inside it', async () => {
    const { catches, of } = await claims();

    expect(catches.eventSubProcesses(of('Event_CancelRequested'), [of('Activity_OnCancel'), of('Process_Claims')])).toEqual([]);
  });
});
