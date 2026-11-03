import { ElementHomes } from '../../../src/model/index.js';
import { describe, expect, it } from 'vitest';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementHomes', () => {
  it('knows the parent, the lane and the pool of a node', async () => {
    const document = await Fixtures.read('scoring/containment.bpmn');
    const homes = new ElementHomes(document);

    expect(homes.parents.get('task_in_sub')?.id).toBe('sub');
    expect(homes.lanes.get('task_in_lane')?.id).toBe('lane_upper');
    expect(homes.pools.get('process')?.id).toBe('pool');
  });

  it('requires a drawing of nodes, flows, pools, associations and data, not of a data object', async () => {
    const data = new ElementHomes(await Fixtures.read('scoring/data-association.bpmn'));
    const pools = new ElementHomes(await Fixtures.read('scoring/message-through-pool.bpmn'));

    expect([...data.required].sort()).toEqual(['data_read', 'data_written', 'input', 'output', 'task']);
    expect([...pools.required]).toEqual(expect.arrayContaining(['pool_passed', 'message', 'task_send']));
  });

  it('requires nothing of a process beside the one drawn', async () => {
    const homes = new ElementHomes(await Fixtures.read('scoring/two-processes.bpmn'));

    expect([...homes.required]).toEqual(['task_drawn', 'task_undrawn']);
  });

  it('follows flows and boundary events, and never against a flow', async () => {
    const homes = new ElementHomes(await Fixtures.read('scoring/backward-flow.bpmn'));
    const boundary = new ElementHomes(await Fixtures.read('scoring/through.bpmn'));

    expect(homes.reaches('task_c', 'task_d')).toBe(true);
    expect(homes.reaches('task_d', 'task_c')).toBe(true);
    expect(homes.reaches('task_b', 'task_a')).toBe(false);
    expect(boundary.reaches('task_source', 'boundary_on_source')).toBe(true);
  });

  it('walks the scopes of a node up to its process', async () => {
    const document = await Fixtures.read('scoring/containment.bpmn');

    expect(ElementHomes.scopesOf(document.tree.require('task_in_sub')).map(({ id }) => id)).toEqual(['sub', 'process']);
    expect(new ElementHomes(document).processOf(document.tree.require('task_in_sub'))?.id).toBe('process');
    expect(new ElementHomes(document).processOf(undefined)).toBeUndefined();
  });

  it('chains a nested lane to the lanes around it', async () => {
    const document = await Fixtures.read('layout/subproc__s10-nested-lanes.bpmn');

    expect(ElementHomes.laneChainOf(document.tree.require('Lane_Accounting')).map(({ id }) => id)).toEqual(['Lane_Accounting', 'Lane_Back']);
  });
});
