import { describe, expect, it } from 'vitest';
import { ZeebeSubscription } from '../../../src/edit/events/ZeebeSubscription.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const ADD = { op: 'ext', id: 'x', action: 'add', type: 'zeebe:subscription' } as const;

async function subscribing() {
  const document = await Fixtures.readForWrite('edit/events-subscription.bpmn');
  return { document, subscription: new ZeebeSubscription(document), changes: new ChangeSet() };
}

function subscriptionsOf(element: { get<T>(name: string): T }): Array<{ peek(name: string): unknown }> {
  return element.get<{ get<T>(name: string): T } | undefined>('extensionElements')?.get('values') ?? [];
}

describe('ZeebeSubscription', () => {
  it('finds the message a catch event and a receive task wait for', async () => {
    const { document, subscription } = await subscribing();

    expect(subscription.messageFor(document.tree.require('catch_paid'), ADD)?.id).toBe('Message_paid');
    expect(subscription.messageFor(document.tree.require('receive_shipped'), ADD)?.id).toBe('Message_shipped');
  });

  it.each([
    ['the removal of a subscription', 'catch_paid', { ...ADD, action: 'remove' }],
    ['another extension', 'catch_paid', { ...ADD, type: 'zeebe:taskHeaders' }],
    ['a nested slot other than the definition', 'catch_paid', { ...ADD, slot: 'loop' }],
    ['a task', 'task_plain', ADD],
    ['a catch event without a message definition', 'catch_timer', ADD],
  ] as const)('stays out of %s', async (_case, id, command) => {
    const { document, subscription } = await subscribing();

    expect(subscription.messageFor(document.tree.require(id), command)).toBeUndefined();
  });

  it('reads the subscription from a slot prefix and from a snippet', async () => {
    const { document, subscription } = await subscribing();
    const catching = document.tree.require('catch_paid');

    expect(subscription.messageFor(catching, { ...ADD, type: 'definition.zeebe:subscription' })?.id).toBe('Message_paid');
    expect(subscription.messageFor(catching, { op: 'ext', id: 'x', action: 'add', xml: '<zeebe:subscription correlationKey="=id" />' })?.id).toBe('Message_paid');
    expect(subscription.messageFor(catching, { op: 'ext', id: 'x', action: 'add', xml: '<z.e:subscription xmlns:z.e="http://camunda.org/schema/zeebe/1.0" correlationKey="=id" />' })?.id).toBe('Message_paid');
  });

  it('stays out of a snippet it cannot read', async () => {
    const { document, subscription } = await subscribing();

    expect(subscription.messageFor(document.tree.require('catch_paid'), { op: 'ext', id: 'x', action: 'add', xml: 'not xml' })).toBeUndefined();
  });

  it('refuses a subscription on an event that waits for no message yet', async () => {
    const { document, subscription } = await subscribing();

    expect(() => subscription.messageFor(document.tree.require('catch_nothing'), ADD)).toThrow(expect.objectContaining({ code: 'E_WRONG_HOST', details: expect.objectContaining({ element: 'catch_nothing' }) }));
  });

  it('explains where a subscription goes and who shares it', async () => {
    const { document, subscription } = await subscribing();
    const message = document.tree.require('Message_paid');

    expect(subscription.note(document.tree.require('catch_paid'), message, 'zeebe:subscription')).toBe("zeebe:subscription goes to message Message_paid, which catch_paid waits for: Camunda 8 reads the correlation key in the message's zeebe:subscription (receive_paid waits for it too and shares it)");
    expect(subscription.note(message, message, 'zeebe:correlationKey')).toBe('zeebe:correlationKey is written to the zeebe:subscription of message Message_paid (catch_paid, receive_paid wait for it and share it)');
    expect(subscription.note(document.tree.require('Message_shipped'), document.tree.require('Message_shipped'), 'x')).toContain('(catch_shipped, receive_shipped wait');
  });

  it('notes no one to share a message with when one element waits for it', async () => {
    const document = await Fixtures.readForWrite('edit/events-subscription.bpmn');
    const message = document.tree.require('Message_paid');
    document.tree.require('receive_paid').set('messageRef', undefined);

    expect(new ZeebeSubscription(document).note(document.tree.require('catch_paid'), message, 'x')).toBe("x goes to message Message_paid, which catch_paid waits for: Camunda 8 reads the correlation key in the message's zeebe:subscription");
    expect(new ZeebeSubscription(document).note(message, message, 'x')).toBe('x is written to the zeebe:subscription of message Message_paid (catch_paid waits for it and shares it)');
  });

  it('names the type a command adds, without its slot prefix or path', async () => {
    const { subscription } = await subscribing();

    expect(subscription.addedTypeText({ ...ADD, type: 'definition.zeebe:subscription' })).toBe('zeebe:subscription');
    expect(subscription.addedTypeText({ op: 'ext', id: 'x', action: 'add', xml: '<a/>' })).toBe('zeebe:subscription');
    expect(subscription.addedTypeText({ ...ADD, type: 'zeebe:subscription/x' })).toBe('zeebe:subscription');
  });

  it('adds a subscription with the correlation key to the message of a catch event', async () => {
    const { document, subscription, changes } = await subscribing();

    expect(subscription.setCorrelationKey(document.tree.require('catch_paid'), 'zeebe:correlationKey', '=orderId', changes)).toBe(true);

    expect(subscriptionsOf(document.tree.require('Message_paid'))[0]?.peek('correlationKey')).toBe('=orderId');
    expect(changes.notes[0]).toContain('goes to message Message_paid');
  });

  it('rewrites the key of the subscription a message has, on the message itself too', async () => {
    const { document, subscription, changes } = await subscribing();
    const message = document.tree.require('Message_shipped');

    expect(subscription.setCorrelationKey(message, 'zeebe:correlationKey', '=shipment', changes)).toBe(true);

    expect(subscriptionsOf(message)[0]?.peek('correlationKey')).toBe('=shipment');
    expect(changes.changed[0]).toMatchObject({ id: 'Message_shipped', detail: 'zeebe:subscription correlationKey==shipment' });
  });

  it('reports no change when the key stays', async () => {
    const { document, subscription, changes } = await subscribing();

    expect(subscription.setCorrelationKey(document.tree.require('catch_shipped'), 'zeebe:correlationKey', '=orderId', changes)).toBe(true);

    expect(changes.changed).toEqual([]);
  });

  it.each([
    ['a key of no namespace', 'catch_paid', 'correlationKey'],
    ['another key', 'catch_paid', 'zeebe:other'],
    ['a key of another namespace', 'catch_paid', 'camunda:correlationKey'],
    ['an event without a message', 'catch_nothing', 'zeebe:correlationKey'],
  ])('leaves %s to the other writers', async (_case, id, key) => {
    const { document, subscription, changes } = await subscribing();

    expect(subscription.setCorrelationKey(document.tree.require(id), key, '=x', changes)).toBe(false);
  });
});
