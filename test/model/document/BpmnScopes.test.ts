import { describe, expect, it } from 'vitest';
import { Fixtures } from '../../support/Fixtures.js';

describe('BpmnScopes', () => {
  it('finds the nearest process or sub-process of an element', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');

    expect(scopes.scopeOf(tree.require('task_inside'))).toBe(tree.require('sub_adhoc'));
    expect(scopes.scopeOf(tree.require('task_send'))).toBe(tree.require('Process_events'));
    expect(scopes.scopeOf(tree.definitions)).toBeUndefined();
  });

  it('finds the enclosing process through any depth', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');

    expect(scopes.processOf(tree.require('task_inside'))?.id).toBe('Process_events');
    expect(scopes.processOf(undefined)).toBeUndefined();
  });

  it('takes the only process as the default scope', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');

    expect(scopes.defaultScope()).toBe(tree.require('Process_events'));
    expect(scopes.requireScope(undefined)).toBe(tree.require('Process_events'));
  });

  it('refuses a default scope among several processes', async () => {
    const { scopes } = await Fixtures.read('models/step1/two-pools.bpmn');

    expect(() => scopes.defaultScope()).toThrow(expect.objectContaining({ code: 'E_AMBIGUOUS_SCOPE' }));
  });

  it('refuses a default scope when the file holds no process', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');
    document.tree.definitions.remove('rootElements', document.tree.processes()[0]!);

    expect(() => document.scopes.defaultScope()).toThrow(expect.objectContaining({ code: 'E_NO_PROCESS' }));
  });

  it('resolves a participant to its process and refuses a black box', async () => {
    const document = await Fixtures.read('models/step1/two-pools.bpmn');
    const [first] = document.flows.participants();

    expect(document.scopes.requireScope(first!.id)).toBe(first!.get('processRef'));
    first!.set('processRef', undefined);
    expect(() => document.scopes.requireScope(first!.id)).toThrow(expect.objectContaining({ code: 'E_BLACK_BOX' }));
  });

  it('takes a sub-process as a scope and refuses a task', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');

    expect(scopes.requireScope('sub_adhoc')).toBe(tree.require('sub_adhoc'));
    expect(() => scopes.requireScope('task_send')).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
  });

  it('lists the flow elements and flow nodes of a scope', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');
    const process = tree.require('Process_events');

    expect(scopes.flowElements(process).some((element) => element.is('bpmn:SequenceFlow'))).toBe(true);
    expect(scopes.flowNodes(process).every((element) => element.is('bpmn:FlowNode'))).toBe(true);
  });

  it('finds the boundary events on an activity, none on a stray element', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');

    expect(scopes.boundaryEventsOf(tree.require('task_review')).map(({ id }) => id)).toEqual(['boundary_soon', 'boundary_late']);
    expect(scopes.boundaryEventsOf(tree.definitions)).toEqual([]);
  });

  it('lists every lane of a node, nested ones included, and the innermost one', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');
    const task = tree.require('task_review');

    expect(scopes.lanesOf(task).map(({ id }) => id)).toEqual(['Lane_sales', 'Lane_inside']);
    expect(scopes.laneOf(task)?.id).toBe('Lane_inside');
    expect(scopes.laneOf(tree.require('task_send'))).toBeUndefined();
    expect(scopes.lanesOf(tree.definitions)).toEqual([]);
  });

  it('lists all lanes with nested ones behind their parent', async () => {
    const { tree, scopes } = await Fixtures.read('model/events.bpmn');

    expect(scopes.allLanes(tree.require('Process_events')).map(({ id }) => id)).toEqual(['Lane_sales', 'Lane_inside', 'Lane_billing']);
  });

  it('finds the lane set of a process, a lane and a participant', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const { tree, scopes } = document;

    expect(scopes.laneSetOf(tree.require('Process_events'))?.id).toBe('LaneSet_main');
    expect(scopes.laneSetOf(tree.require('Lane_sales'))?.id).toBe('LaneSet_sales');
    const pools = await Fixtures.read('models/step1/two-pools.bpmn');
    expect(pools.scopes.laneSetOf(pools.flows.participants()[0]!)).toBeUndefined();
  });
});
