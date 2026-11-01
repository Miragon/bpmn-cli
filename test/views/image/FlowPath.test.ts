import { describe, expect, it } from 'vitest';
import { FlowPath } from '../../../src/views/image/FlowPath.js';
import { Fixtures } from '../../support/Fixtures.js';

const path = async (from: string, to: string) => new FlowPath(await Fixtures.read('models/views/claims.bpmn')).between(from, to).map(({ id }) => id);

describe('FlowPath', () => {
  it('walks the shortest path along sequence flows, flows included', async () => {
    expect(await path('Gateway_Covered', 'Event_Done')).toEqual(['Gateway_Covered', 'Flow_NotCovered', 'Activity_SendDecision', 'Flow_ToDone', 'Event_Done']);
  });

  it('leaves an activity through its boundary event', async () => {
    expect(await path('Activity_Assess', 'Activity_Investigate')).toEqual(['Activity_Assess', 'Event_FraudSuspected', 'Flow_ToInvestigate', 'Activity_Investigate']);
  });

  it('stays on one node when both ends are the same', async () => {
    expect(await path('Activity_Pay', 'Activity_Pay')).toEqual(['Activity_Pay']);
  });

  it('refuses a path against the flow and an id that is no flow node', async () => {
    await expect(path('Event_Done', 'Activity_Pay')).rejects.toMatchObject({ code: 'E_NO_MATCH' });
    await expect(path('Lane_Office', 'Activity_Pay')).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });
});
