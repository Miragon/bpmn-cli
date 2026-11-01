import { describe, expect, it } from 'vitest';
import type { BpmnError } from '../../../src/model/errors/BpmnError.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('BpmnTree', () => {
  it('resolves semantic ids and leaves DI and vendor ids out', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const vendor = (await Fixtures.read('model/c8-vendor.bpmn')).tree;

    expect(tree.byId('task_review')?.type).toBe('bpmn:UserTask');
    expect(tree.has('task_review_di')).toBe(false);
    expect(vendor.has('definition_worker')).toBe(false);
  });

  it('walks from the definitions by default, and from any element', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');

    expect([...tree.walk()][0]).toBe(tree.definitions);
    expect([...tree.walk(tree.require('sub_adhoc'))].map((element) => element.peek('id') ?? element.type)).toEqual(['sub_adhoc', 'bpmn:Expression', 'task_inside']);
  });

  it('refuses an unknown id with close candidates', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');

    expect(() => tree.require('task_reveiw')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND', message: expect.stringContaining('did you mean: task_review'), details: expect.objectContaining({ element: 'task_reveiw', candidates: expect.arrayContaining(['task_review']) }) }));
  });

  it('refuses an element of another kind than expected', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');

    expect(tree.require('task_review', ['bpmn:UserTask', 'bpmn:Gateway']).id).toBe('task_review');
    expect(() => tree.require('task_review', 'bpmn:Gateway')).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', message: '"task_review" is a userTask, expected Gateway' }));
  });

  it('points a vendor id to the BPMN element it sits in', async () => {
    const { tree } = await Fixtures.read('model/c8-vendor.bpmn');

    expect(() => tree.require('definition_worker')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND', message: expect.stringContaining('vendor extension data inside task_worker'), details: expect.objectContaining({ candidates: ['task_worker'] }) }));
  });

  it('tells inside a batch what happened to a missing id', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const batch = { created: ['task_review', ...Array.from({ length: 9 }, () => 'task_send')], renamed: new Map([['old_id', 'task_review']]), retyped: new Set(['old_id']), aliases: () => ({ $gone: 'task_review' }) };

    let refusal: BpmnError | undefined;
    try {
      tree.require('old_id', undefined, 'node', batch);
    } catch (error) {
      refusal = error as BpmnError;
    }
    expect(refusal?.message).toBe('No node with id "old_id": an op before this one renamed it to task_review (a retype or a trigger change gave it the prefix of its new kind)');
    expect(() => tree.require('gone', undefined, 'node', batch)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: expect.stringContaining('In this batch $gone is an alias') }) }));
    expect(() => tree.require('gone', undefined, 'node', batch)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: expect.stringContaining('(and 2 more)') }) }));
  });

  it('names the old ends of a renamed flow', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const batch = { created: [], renamed: new Map([['flow_old', 'flow_start']]), aliases: () => ({}) };

    expect(() => tree.require('flow_old', undefined, 'flow', batch)).toThrow('its id named its old ends');
  });

  it('finds the root elements', async () => {
    const { tree } = await Fixtures.read('models/step1/two-pools.bpmn');

    expect(tree.processes()).toHaveLength(2);
    expect(tree.collaboration()?.type).toBe('bpmn:Collaboration');
    expect(tree.rootElementsOfType('bpmn:Process')).toEqual(tree.processes());
  });

  it('has no collaboration in a file with a single process', async () => {
    const { tree } = await Fixtures.read('model/c7-vendor.bpmn');

    expect(tree.collaboration()).toBeUndefined();
  });

  it('creates an element whose id is claimed and resolvable after a rebuild of the index', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');
    const { tree } = document;
    tree.all();

    const task = tree.create('bpmn:Task', { id: 'task_created', name: 'New' });
    tree.processes()[0]!.add('flowElements', task);
    tree.invalidate();

    expect(tree.byId('task_created')).toBe(task);
    expect(document.ids.registry.has('task_created')).toBe(true);
  });

  it('builds an element without claiming its id, and wraps what it holds', async () => {
    const document = await Fixtures.read('model/c7-vendor.bpmn');
    const task = document.tree.require('task_form');

    const flow = document.tree.build('bpmn:SequenceFlow', { id: 'flow_built', sourceRef: task });

    expect(document.ids.registry.has('flow_built')).toBe(false);
    expect(flow.raw.get('sourceRef')).toBe(task.raw);
  });

  it('builds a generic vendor element with attributes and children', async () => {
    const { tree } = await Fixtures.read('model/c8-vendor.bpmn');
    const input = tree.buildAny('zeebe:input', 'http://camunda.org/schema/zeebe/1.0', { source: '=a' });

    const mapping = tree.buildAny('zeebe:ioMapping', 'http://camunda.org/schema/zeebe/1.0', { $children: [input] });

    expect([mapping.isGeneric, input.peek('source')]).toEqual([true, '=a']);
    expect(mapping.list('$children')).toEqual([input]);
    expect(tree.buildAny('zeebe:userTask', 'http://camunda.org/schema/zeebe/1.0').type).toBe('zeebe:userTask');
  });
});
