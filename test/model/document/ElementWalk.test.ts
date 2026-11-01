import { describe, expect, it } from 'vitest';
import { ElementWalk } from '../../../src/model/document/ElementWalk.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementWalk', () => {
  it('goes into vendor elements through their children', async () => {
    const { tree } = await Fixtures.read('model/c8-vendor.bpmn');

    expect([...new ElementWalk(tree.require('task_worker')).depthFirst()].map(({ type }) => type)).toEqual(['bpmn:ServiceTask', 'bpmn:ExtensionElements', 'zeebe:taskDefinition', 'zeebe:ioMapping', 'zeebe:input']);
  });

  it('skips vendor elements and extension elements when asked for BPMN only', async () => {
    const { tree } = await Fixtures.read('model/c8-vendor.bpmn');

    expect([...new ElementWalk(tree.require('task_worker')).depthFirst({ bpmnOnly: true })].map(({ type }) => type)).toEqual(['bpmn:ServiceTask', 'bpmn:ExtensionElements']);
  });

  it('keeps document order inside a list', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const ids = [...new ElementWalk(tree.require('LaneSet_main')).depthFirst()].map(({ id }) => id);

    expect(ids).toEqual(['LaneSet_main', 'Lane_sales', 'LaneSet_sales', 'Lane_inside', 'Lane_billing']);
  });

  it('visits an element once, however it is reached', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const seen = [...new ElementWalk(tree.definitions).depthFirst()];

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('walks what is stored without entering vendor children', async () => {
    const { tree } = await Fixtures.read('model/c8-vendor.bpmn');

    expect([...new ElementWalk(tree.require('task_worker')).stored()].map(({ type }) => type).sort()).toEqual(['bpmn:ExtensionElements', 'bpmn:ServiceTask', 'zeebe:ioMapping', 'zeebe:taskDefinition']);
  });

  it('leaves out what the skip names, with all below it', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const stored = [...new ElementWalk(tree.definitions).stored((element) => element.isDi)];

    expect(stored.some(({ isDi }) => isDi)).toBe(false);
    expect(stored).toContain(tree.require('task_review'));
    expect(new Set(stored).size).toBe(stored.length);
  });
});
