import { describe, expect, it } from 'vitest';
import { Camunda8Defaults } from '../../../src/edit/events/Camunda8Defaults.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function editing(path: string, platform?: 'c7' | 'c8') {
  const document = await Fixtures.readForWrite(path);
  return { document, defaults: new Camunda8Defaults(new EditSession(document, platform)) };
}

describe('Camunda8Defaults', () => {
  it('marks a user task of a Camunda 8 file as a Camunda user task and declares the namespace', async () => {
    const { document, defaults } = await editing('edit/order-check.bpmn', 'c8');
    const task = document.tree.require('check');

    expect(defaults.userTask(task)).toBe(true);
    expect(task.get<{ list(name: string): Array<{ type: string }> }>('extensionElements').list('values').map(({ type }) => type)).toEqual(['zeebe:userTask']);
    expect(document.namespaces.prefixFor('http://camunda.org/schema/zeebe/1.0')).toBe('zeebe');
  });

  it('adds the mark to the extension elements a user task already carries', async () => {
    const { document, defaults } = await editing('model/c7-vendor.bpmn', 'c8');
    const task = document.tree.require('task_form');

    defaults.userTask(task);

    expect(task.get<{ list(name: string): Array<{ type: string }> }>('extensionElements').list('values').at(-1)?.type).toBe('zeebe:userTask');
  });

  it('leaves a user task that is marked already, a service task, and every task off Camunda 8', async () => {
    const { document, defaults } = await editing('edit/order-check.bpmn', 'c8');
    const task = document.tree.require('check');
    defaults.userTask(task);

    expect(defaults.userTask(task)).toBe(false);
    expect(defaults.userTask(document.tree.require('ship'))).toBe(false);
    const off = await editing('edit/order-check.bpmn', 'c7');
    expect(off.defaults.userTask(off.document.tree.require('check'))).toBe(false);
  });

  it('names an event definition after its event on Camunda 8 and only there', async () => {
    const { document, defaults } = await editing('edit/events-gateway.bpmn', 'c8');
    const event = document.tree.require('loose_unnamed');
    const unnamed = document.tree.build('bpmn:MessageEventDefinition');
    const unnamedOff = document.tree.build('bpmn:MessageEventDefinition');

    defaults.definitionId(event, unnamed);
    const off = await editing('edit/events-gateway.bpmn', 'c7');
    off.defaults.definitionId(off.document.tree.require('loose_unnamed'), unnamedOff);

    expect(unnamed.get('id')).toContain('messageEventDefinition');
    expect(unnamedOff.get('id')).toBeUndefined();
  });

  it('keeps the id an event definition has', async () => {
    const { document, defaults } = await editing('edit/events-gateway.bpmn', 'c8');
    const definition = document.tree.require('definition_paid');

    defaults.definitionId(document.tree.require('catch_paid'), definition);

    expect(definition.id).toBe('definition_paid');
  });
});
