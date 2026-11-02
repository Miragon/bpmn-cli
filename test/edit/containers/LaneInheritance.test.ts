import { describe, expect, it } from 'vitest';
import { LaneInheritance } from '../../../src/edit/containers/LaneInheritance.js';
import type { Placement } from '../../../src/edit/containers/NodePlacement.js';
import { Fixtures } from '../../support/Fixtures.js';

async function inherited(placement: Placement) {
  const document = await Fixtures.readForWrite('edit/containers-lanes.bpmn');
  return { document, inheritance: LaneInheritance.of(document, placement) };
}

describe('LaneInheritance', () => {
  it('inherits nothing when the add names its lane', () => {
    expect(LaneInheritance.NONE.lane).toBeUndefined();
    expect(LaneInheritance.NONE.warning('task_new')).toBeUndefined();
  });

  it.each<[string, Placement, string | undefined]>([
    ['on the host of a boundary event', { on: 'check' }, 'lane_sales'],
    ['after a node of the same lane', { after: 'start_order' }, 'lane_sales'],
    ['after a gateway, without taking any of its flows', { after: 'gateway_route' }, 'lane_sales'],
    ['before a node with two ways in', { before: 'end_done' }, 'lane_outbound'],
    ['before a node without a lane', { before: 'loose_task' }, undefined],
    ['in a flow, from its source', { flow: 'flow_packToShip' }, 'lane_inbound'],
    ['in a scope, nowhere', { in: 'Process_orders' }, undefined],
    ['after a node a batch does not know', { after: 'nobody' }, undefined],
    ['in a flow a batch does not know', { flow: 'nobody' }, undefined],
  ])('reads the lane of a node placed %s', async (_case, placement, lane) => {
    expect((await inherited(placement)).inheritance.lane?.id).toBe(lane);
  });

  it('warns about a node spliced into a flow across two lanes and names the other lane', async () => {
    const { inheritance } = await inherited({ after: 'pack' });

    expect(inheritance.lane?.id).toBe('lane_inbound');
    expect(inheritance.warning('task_new')).toMatchObject({
      code: 'W_LANE_INHERITED',
      element: 'task_new',
      related: ['lane_inbound', 'lane_outbound'],
      message: 'task_new is in lane_inbound (the lane of pack); the flow it went into runs from pack in lane_inbound to ship in lane_outbound',
    });
  });

  it('reads the lane of the node it went before', async () => {
    const { inheritance } = await inherited({ before: 'ship' });

    expect(inheritance.lane?.id).toBe('lane_outbound');
    expect(inheritance.warning('task_new')?.message).toContain('the lane of ship');
  });

  it('follows the target out of a branching gateway, on whose row the layout puts the node', async () => {
    for (const placement of [{ flow: 'flow_routeToPack' }, { after: 'gateway_route', before: 'pack' }]) {
      const { inheritance } = await inherited(placement);

      expect(inheritance.lane?.id).toBe('lane_inbound');
      expect(inheritance.warning('task_new')?.message).toContain('after the branching gateway_route');
    }
  });

  it('stays quiet when one end of the flow has no lane', async () => {
    expect((await inherited({ flow: 'flow_subToLoose' })).inheritance.warning('task_new')).toBeUndefined();
    expect((await inherited({ flow: 'flow_looseToEnd' })).inheritance.warning('task_new')).toBeUndefined();
  });

  it('finds no flow between two nodes that have none', async () => {
    expect((await inherited({ after: 'pack', before: 'end_done' })).inheritance.warning('task_new')).toBeUndefined();
    expect((await inherited({ after: 'nobody', before: 'pack' })).inheritance.warning('task_new')).toBeUndefined();
  });

  it('notes that a node keeps its own lane beside the flow it went into', async () => {
    const { document, inheritance } = await inherited({ flow: 'flow_packToShip' });

    expect(inheritance.crossNote('task_new', document.tree.require('lane_idle'))).toBe('task_new stays in its lane lane_idle; the flow it went into runs from pack in lane_inbound to ship in lane_outbound (`bpmn move <file> task_new --lane lane_inbound` puts it on the row the layout gives a node there)');
  });

  it('has no move to suggest when the flow starts outside any lane', async () => {
    const { document, inheritance } = await inherited({ flow: 'flow_looseToEnd' });

    expect(inheritance.crossNote('task_new', document.tree.require('lane_idle'))).toBe('task_new stays in its lane lane_idle; the flow it went into runs from loose_task in no lane to end_done in lane_outbound');
  });

  it('notes nothing for a node in a lane of the flow, or beside no flow across lanes', async () => {
    const across = await inherited({ flow: 'flow_packToShip' });
    const within = await inherited({ after: 'start_order' });

    expect(across.inheritance.crossNote('task_new', across.document.tree.require('lane_outbound'))).toBeUndefined();
    expect(across.inheritance.crossNote('task_new', across.document.tree.require('lane_inbound'))).toBeUndefined();
    expect(within.inheritance.crossNote('task_new', within.document.tree.require('lane_idle'))).toBeUndefined();
  });
});
