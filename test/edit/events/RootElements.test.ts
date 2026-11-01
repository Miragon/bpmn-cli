import { describe, expect, it } from 'vitest';
import { RootElements } from '../../../src/edit/events/RootElements.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

async function editing() {
  const document = await Fixtures.readForWrite('edit/events-triggers.bpmn');
  return { document, roots: new RootElements(new EditSession(document)) };
}

describe('RootElements', () => {
  it('finds a root element by id first and by name second', async () => {
    const { roots } = await editing();

    expect(roots.ensure('bpmn:Message', 'Message_paid')).toMatchObject({ created: false, el: { id: 'Message_paid' } });
    expect(roots.ensure('bpmn:Message', ' Paid ')).toMatchObject({ created: false, el: { id: 'Message_paid' } });
  });

  it('creates a missing root element in the definitions', async () => {
    const { document, roots } = await editing();

    const { el, created } = roots.ensure('bpmn:Signal', 'Go');

    expect(created).toBe(true);
    expect(el.get('name')).toBe('Go');
    expect(document.tree.rootElementsOfType('bpmn:Signal')).toContain(el);
  });

  it('writes a code and clears one given empty, and skips one not given', async () => {
    const { roots } = await editing();

    expect(roots.ensure('bpmn:Error', 'Late', { errorCode: 'E2' }).el.get('errorCode')).toBe('E2');
    expect(roots.ensure('bpmn:Error', 'Late', { errorCode: undefined }).el.get('errorCode')).toBe('E2');
    expect(roots.ensure('bpmn:Error', 'Late', { errorCode: '' }).el.get('errorCode')).toBeUndefined();
  });

  it('refuses an empty name', async () => {
    const { roots } = await editing();

    expect(() => roots.ensure('bpmn:Escalation', '  ')).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', message: 'The escalation name is empty' }));
  });

  it('binds an alias to the one root element an event references', async () => {
    const { document } = await editing();
    const changes = new ChangeSet();

    RootElements.bindRefAs(changes, '$paid', document.tree.require('catch_message'));

    expect(changes.bindings).toEqual([expect.objectContaining({ alias: '$paid', el: document.tree.require('Message_paid') })]);
  });

  it('binds an alias to the message a receive task names', async () => {
    const document = await Fixtures.readForWrite('edit/events-subscription.bpmn');
    const changes = new ChangeSet();

    RootElements.bindRefAs(changes, '$paid', document.tree.require('receive_paid'));

    expect(changes.bindings[0]?.el.id).toBe('Message_paid');
  });

  it('binds nothing without an alias or without an element', async () => {
    const { document } = await editing();
    const changes = new ChangeSet();

    RootElements.bindRefAs(changes, undefined, document.tree.require('catch_message'));
    RootElements.bindRefAs(changes, '$paid', undefined);

    expect(changes.bindings).toEqual([]);
  });

  it('refuses an alias on an element that references no root element', async () => {
    const { document } = await editing();

    expect(() => RootElements.bindRefAs(new ChangeSet(), '$x', document.tree.require('task_work'))).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining('references no message, error, signal or escalation') }));
  });

  it('refuses an alias on an event that references two root elements', async () => {
    const { document } = await editing();

    expect(() => RootElements.bindRefAs(new ChangeSet(), '$x', document.tree.require('catch_both'))).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining('2 root elements (Message_paid, Signal_stop)') }));
  });

  it('counts a root element two definitions of an event share once', async () => {
    const { document } = await editing();
    const changes = new ChangeSet();

    RootElements.bindRefAs(changes, '$paid', document.tree.require('catch_twice'));

    expect(changes.bindings[0]?.el.id).toBe('Message_paid');
  });
});
