import { describe, expect, it } from 'vitest';
import { BranchReach } from '../../../src/edit/containers/BranchReach.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function branchOf(path: string, id: string) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  const branch = new BranchReach(session).branchOf(session.require(id));
  return { nodes: branch.nodes.map((node) => node.id), stops: branch.stops.map((node) => node.id) };
}

describe('BranchReach', () => {
  it('stops a branch before the join another path reaches', async () => {
    expect(await branchOf('edit/order-check.bpmn', 'ship')).toEqual({ nodes: ['ship'], stops: ['gateway_join'] });
  });

  it('takes the join in once every path into it is in the branch', async () => {
    expect(await branchOf('edit/order-check.bpmn', 'gateway_ok')).toEqual({ nodes: ['gateway_ok', 'ship', 'reject', 'gateway_join', 'endEvent_done'], stops: [] });
  });

  it('takes the boundary event of an activity and its compensation handler along', async () => {
    const { nodes } = await branchOf('edit/containers-artifacts.bpmn', 'write');

    expect(nodes.slice(0, 1)).toEqual(['write']);
    expect(nodes).toEqual(expect.arrayContaining(['compensate_write', 'undo_write', 'read', 'call_helper', 'end_main']));
  });

  it('refuses a node several paths reach, for it heads no branch of one path', async () => {
    await expect(branchOf('edit/order-check.bpmn', 'gateway_join')).rejects.toMatchObject({ code: 'E_AMBIGUOUS_BRANCH', details: { element: 'gateway_join', candidates: ['flow_shipToJoin', 'flow_rejectToJoin'] } });
  });
});
