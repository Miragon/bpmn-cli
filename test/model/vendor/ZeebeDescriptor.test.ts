import { describe, expect, it } from 'vitest';
import { ZEEBE } from '../../../src/model/vendor/ZeebeDescriptor.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ZeebeDescriptor', () => {
  it('allows an extension element on the tasks the schema names, on any element for a wildcard, and says nothing about an unknown one', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');

    expect([ZEEBE.allowedOn('taskDefinition', document.tree.require('task_worker')), ZEEBE.allowedOn('taskDefinition', 'bpmn:UserTask'), ZEEBE.allowedOn('calledDecision', document.tree.require('task_rule'))]).toEqual([true, false, true]);
    expect(ZEEBE.allowedOn('properties', 'bpmn:Process')).toBe(true);
    expect(ZEEBE.allowedOn('shoeSize', 'bpmn:Task')).toBeUndefined();
  });

  it('refuses an element that lives only inside another, wherever it is put', () => {
    expect(ZEEBE.allowedOn('input', 'bpmn:ServiceTask')).toBe(false);
    expect(ZEEBE.allowedOn('header', 'bpmn:UserTask')).toBe(false);
  });

  it('lists the extension elements that contain another one', () => {
    expect(ZEEBE.containersOf('input')).toEqual(['zeebe:ioMapping']);
    expect(ZEEBE.containersOf('header')).toEqual(['zeebe:taskHeaders']);
    expect(ZEEBE.containersOf('taskDefinition')).toEqual([]);
    expect(ZEEBE.containersOf('shoeSize')).toEqual([]);
  });

  it('calls an element nested-only when every container of it is a bare wrapper without attributes', () => {
    expect([ZEEBE.nestedOnly('input'), ZEEBE.nestedOnly('taskDefinition'), ZEEBE.nestedOnly('ioMapping'), ZEEBE.nestedOnly('shoeSize')]).toEqual([true, false, false, false]);
  });

  it('names the wrapper each nested-only element belongs in', () => {
    expect(ZEEBE.nestedHomes()).toEqual({
      'zeebe:input': 'zeebe:ioMapping',
      'zeebe:output': 'zeebe:ioMapping',
      'zeebe:header': 'zeebe:taskHeaders',
      'zeebe:linkedResource': 'zeebe:linkedResources',
      'zeebe:property': 'zeebe:properties',
      'zeebe:executionListener': 'zeebe:executionListeners',
      'zeebe:taskListener': 'zeebe:taskListeners',
    });
  });
});
