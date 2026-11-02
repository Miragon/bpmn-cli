import { describe, expect, expectTypeOf, it } from 'vitest';
import { BpmnElement } from '../../../src/model/document/BpmnElement.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('BpmnElement', () => {
  it('gives one wrapper per moddle object, so identity holds across reads', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const task = document.tree.require('task_review');
    const flow = document.tree.require('flow_start');

    expect(flow.get<BpmnElement>('targetRef')).toBe(task);
    expect(flow.peek<BpmnElement>('targetRef')).toBe(task);
    expect(BpmnElement.of(task.raw)).toBe(task);
    expect(new Set([task, flow.get<BpmnElement>('targetRef')]).size).toBe(1);
    expect(task.parent).toBe(document.tree.require('Process_events'));
  });

  it('reads the id, the type and the name of a task', async () => {
    const task = (await Fixtures.read('model/events.bpmn')).tree.require('task_review');

    expect([task.id, task.type, task.name]).toEqual(['task_review', 'bpmn:UserTask', 'Review order']);
    expect(task.is('bpmn:Activity')).toBe(true);
    expect(task.is('bpmn:Gateway')).toBe(false);
  });

  it('names a group after its category value', async () => {
    const group = (await Fixtures.read('model/events.bpmn')).tree.require('group_review');

    expect(group.name).toBe('Review');
  });

  it('tells a typed BPMN element, a DI element and a vendor element apart', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const task = document.tree.require('task_worker');
    const vendor = task.get<BpmnElement>('extensionElements').list('values')[0]!;

    expect([task.isBpmn, task.isGeneric, task.isDrawingPart]).toEqual([true, false, false]);
    expect([vendor.isBpmn, vendor.isGeneric, vendor.type]).toEqual([false, true, 'zeebe:taskDefinition']);
    expect(vendor.id).toBe('definition_worker');
  });

  it('types every list as readonly, so a push onto a copy does not compile', async () => {
    const task = (await Fixtures.read('model/events.bpmn')).tree.require('task_review');

    expectTypeOf(task.list('incoming')).toEqualTypeOf<readonly BpmnElement[]>();
    expectTypeOf(task.get<BpmnElement[]>('incoming')).toEqualTypeOf<readonly BpmnElement[]>();
    expectTypeOf(task.get<BpmnElement[] | undefined>('incoming')).toEqualTypeOf<readonly BpmnElement[] | undefined>();
    expectTypeOf(task.peek<BpmnElement[]>('incoming')).toEqualTypeOf<readonly BpmnElement[] | undefined>();
    expectTypeOf(task.get<BpmnElement>('parent')).toEqualTypeOf<BpmnElement>();
  });

  it('hands out a copy of a list: changing the copy leaves the model alone', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const process = document.tree.require('Process_events');
    const before = process.list('flowElements').length;

    (process.list('flowElements') as BpmnElement[]).pop();
    (process.get<BpmnElement[]>('flowElements') as BpmnElement[]).pop();

    expect(process.list('flowElements')).toHaveLength(before);
  });

  it('lists nothing and creates no collection for a list the element never had', async () => {
    const task = (await Fixtures.read('model/events.bpmn')).tree.require('task_send');

    expect(task.list('documentation')).toEqual([]);
    expect(Object.hasOwn(task.raw, 'documentation')).toBe(false);
    expect(task.get<BpmnElement[]>('documentation')).toEqual([]);
    expect(Object.hasOwn(task.raw, 'documentation')).toBe(true);
  });

  it('adds a contained child once and sets its parent', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const process = document.tree.require('Process_events');
    const task = document.tree.build('bpmn:Task', { id: 'task_new' });

    process.add('flowElements', task, task);

    expect(process.list('flowElements').filter((element) => element === task)).toHaveLength(1);
    expect(task.parent).toBe(process);
  });

  it('adds to a reference list without taking the child over', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const lane = document.tree.require('Lane_billing');
    const task = document.tree.require('task_send');

    lane.add('flowNodeRef', task);

    expect(lane.list('flowNodeRef')).toContain(task);
    expect(task.parent).toBe(document.tree.require('Process_events'));
  });

  it('inserts at a clamped position', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const gateway = document.tree.require('gateway_choice');
    const flow = document.tree.require('flow_send');
    const contained = document.tree.require('task_send');
    const first = document.tree.build('bpmn:Documentation', { text: 'first' });

    gateway.insert('outgoing', 99, flow);
    contained.insert('documentation', -1, first);

    expect(gateway.list('outgoing').at(-1)).toBe(flow);
    expect(contained.list('documentation')[0]).toBe(first);
    expect(first.parent).toBe(contained);
  });

  it('removes a child without a cascade and answers false for a stranger', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const process = document.tree.require('Process_events');
    const task = document.tree.require('task_send');

    expect(process.remove('flowElements', task)).toBe(true);
    expect(process.remove('flowElements', task)).toBe(false);
    expect(task.parent).toBe(process);
  });

  it('stores the moddle object behind a wrapper it is given', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const flow = document.tree.require('flow_start');
    const task = document.tree.require('task_send');
    const lane = document.tree.require('Lane_sales');

    flow.set('targetRef', task);
    lane.set('flowNodeRef', [task]);

    expect(flow.raw.get('targetRef')).toBe(task.raw);
    expect(lane.list('flowNodeRef')).toEqual([task]);
  });

  it('moves an element by setting its parent', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const task = document.tree.require('task_inside');
    const process = document.tree.require('Process_events');

    task.parent = process;

    expect(task.parent).toBe(process);
  });
});
