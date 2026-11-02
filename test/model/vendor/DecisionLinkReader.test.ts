import { describe, expect, it } from 'vitest';
import { DecisionLinkReader } from '../../../src/model/vendor/DecisionLinkReader.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DecisionLinkReader', () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    [{ nested: true }, undefined],
    ['   ', undefined],
    ['  price ', 'price'],
    [42, '42'],
  ])('reads %j from an attribute as %j', (value, expected) => {
    expect(DecisionLinkReader.textValue(value)).toBe(expected);
  });

  it.each([
    ['model/c7-vendor.bpmn', 'task_rule', { value: 'price', spelling: 'camunda:decisionRef' }],
    ['model/operaton.bpmn', 'task_rule', { value: 'price', spelling: 'operaton:decisionRef' }],
    ['model/c8-vendor.bpmn', 'task_rule', { value: 'price', spelling: 'zeebe:calledDecision' }],
    ['model/c8-vendor.bpmn', 'task_own_link', { value: 'own', spelling: 'calledDecision' }],
    ['model/c8-vendor.bpmn', 'task_no_link', undefined],
    ['model/c8-vendor.bpmn', 'task_worker', undefined],
  ])('reads the decision link of %s %s in whichever spelling the file uses', async (file, id, expected) => {
    const document = await Fixtures.read(file);

    expect(new DecisionLinkReader(document.namespaces).linkOf(document.tree.require(id))).toEqual(expected);
  });

  it('reads a hand-written calledElement as the link when nothing else names a decision', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const task = document.tree.require('task_no_link');
    task.attrs['calledElement'] = 'risk';

    expect(new DecisionLinkReader().linkOf(task)).toEqual({ value: 'risk', spelling: 'calledElement' });
  });

  it('finds the namespace of a prefix on the element or its ancestors, then in the document namespaces, else nowhere', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const task = document.tree.require('task_no_link');
    const reader = new DecisionLinkReader(document.namespaces);
    const bare = new DecisionLinkReader();

    expect(bare.uriOf(task, 'zeebe')).toBe('http://camunda.org/schema/zeebe/1.0');
    expect([reader.uriOf(task, 'camunda'), bare.uriOf(task, 'camunda')]).toEqual(['http://camunda.org/schema/1.0/bpmn', undefined]);
    task.attrs['xmlns:zeebe'] = 'urn:local';
    expect(reader.uriOf(task, 'zeebe')).toBe('urn:local');
  });

  it('lists the decisionRef attributes of the camunda namespaces, camunda before operaton, and skips the ones of another namespace', async () => {
    const document = await Fixtures.read('model/operaton.bpmn');
    const task = document.tree.require('task_rule');
    document.tree.definitions.attrs['xmlns:camunda'] = 'http://camunda.org/schema/1.0/bpmn';
    document.tree.definitions.attrs['xmlns:acme'] = 'urn:acme';
    task.attrs['camunda:decisionRef'] = 'old';
    task.attrs['acme:decisionRef'] = 'foreign';
    task.attrs['camunda:decisionRefVersion'] = '2';

    expect(new DecisionLinkReader(document.namespaces).c7DecisionRefs(task)).toEqual([['camunda:decisionRef', 'old'], ['operaton:decisionRef', 'price']]);
  });

  it('lists the zeebe:calledDecision elements of a task, and none for a task without extension elements', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const reader = new DecisionLinkReader(document.namespaces);

    expect(reader.zeebeCalls(document.tree.require('task_rule')).map((call) => call.type)).toEqual(['zeebe:calledDecision']);
    expect(reader.zeebeCalls(document.tree.require('task_worker'))).toEqual([]);
    expect(reader.zeebeCalls(document.tree.require('task_no_link'))).toEqual([]);
  });
});
