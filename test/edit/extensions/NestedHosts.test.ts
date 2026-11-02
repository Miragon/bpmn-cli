import { describe, expect, it } from 'vitest';
import type { ExtOperation } from '../../../src/operations/index.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

const hosts = NestedHosts.INSTANCE;

function ext(fields: Record<string, unknown>): ExtOperation {
  return Fixtures.operations([{ op: 'ext', ...fields }]).model[0] as ExtOperation;
}

async function session(path = 'edit/extensions-camunda.bpmn', platform?: 'c7' | 'c8') {
  const document = await Fixtures.readForWrite(path);
  return { document, edit: new EditSession(document, platform) };
}

describe('NestedHosts', () => {
  it('answers for a plain element with its own id and no prefix', async () => {
    const { document } = await session();
    const call = document.tree.require('call');

    expect(hosts.ownerOf(call)).toBe(call);
    expect(hosts.idOf(call)).toBe('call');
    expect(hosts.slotPrefix(call)).toBe('');
    expect(hosts.labelOf(call)).toBe('call');
  });

  it('names a nested host after the element that owns it', async () => {
    const { document, edit } = await session();
    const looped = document.tree.require('looped');
    const double = document.tree.require('double');

    const { host } = hosts.resolve(edit, looped, ext({ id: 'looped', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle' }), []);
    const { host: signal } = hosts.resolve(edit, double, ext({ id: 'double', action: 'add', type: 'definition[1].camunda:x' }), []);

    expect(hosts.ownerOf(host)).toBe(looped);
    expect(hosts.idOf(host)).toBe('looped');
    expect(hosts.slotPrefix(host)).toBe('loop.');
    expect(hosts.labelOf(host)).toBe('the loop characteristics of looped');
    expect(signal.is('bpmn:SignalEventDefinition')).toBe(true);
    expect(hosts.labelOf(signal)).toBe('the event definition definition[1] of double');
  });

  it('splits a slot prefix off a type, and leaves other dotted types alone', () => {
    expect(hosts.splitSlot(' loop.camunda:x ')).toEqual({ slot: 'loop', rest: 'camunda:x' });
    expect(hosts.splitSlot('definition[timer].camunda:x')).toEqual({ slot: 'definition[timer]', rest: 'camunda:x' });
    expect(hosts.splitSlot('camunda:x')).toBeUndefined();
    expect(hosts.splitSlot('other.camunda:x')).toBeUndefined();
  });

  it('turns a remove by a numeric type into a remove by index', () => {
    expect(hosts.normalizeIndex(ext({ id: 'x', action: 'remove', type: '2' }))).toEqual({ op: 'ext', id: 'x', action: 'remove', index: 2 });
    expect(hosts.normalizeIndex(ext({ id: 'x', action: 'remove', type: 'loop.0' }))).toEqual({ op: 'ext', id: 'x', action: 'remove', index: 0, slot: 'loop' });
    expect(hosts.normalizeIndex(ext({ id: 'x', action: 'remove', type: '1', slot: 'loop' }))).toEqual({ op: 'ext', id: 'x', action: 'remove', index: 1, slot: 'loop' });
  });

  it('leaves an add, an index and a selector as they are', () => {
    const untouched = [{ id: 'x', action: 'add', type: '2' }, { id: 'x', action: 'remove', index: 2 }, { id: 'x', action: 'remove', type: 'camunda:x' }, { id: 'x', action: 'remove', type: 'other.0' }];

    for (const fields of untouched) {
      expect(hosts.normalizeIndex(ext(fields))).toEqual({ op: 'ext', ...fields });
    }
  });

  it('refuses a slot and a type prefix that disagree', async () => {
    const { document, edit } = await session();
    const looped = document.tree.require('looped');

    expect(() => hosts.normalizeIndex(ext({ id: 'x', action: 'remove', type: 'loop.0', slot: 'definition' }))).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
    expect(() => hosts.resolve(edit, looped, ext({ id: 'looped', action: 'add', type: 'loop.camunda:x', slot: 'definition' }), [])).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining('disagree') }));
  });

  it('keeps the element as host when no slot is named', async () => {
    const { document, edit } = await session();
    const call = document.tree.require('call');
    const command = ext({ id: 'call', action: 'add', type: 'camunda:x' });

    expect(hosts.resolve(edit, call, command, [])).toEqual({ host: call, command });
  });

  it('takes the slot of the operation, and the condition of a flow', async () => {
    const { document, edit } = await session();

    const { host, command } = hosts.resolve(edit, document.tree.require('flow_conditional'), ext({ id: 'flow_conditional', action: 'add', type: 'camunda:x', slot: 'condition' }), []);

    expect(host.is('bpmn:FormalExpression')).toBe(true);
    expect(command).toEqual({ op: 'ext', id: 'flow_conditional', action: 'add', type: 'camunda:x' });
  });

  it('asks which event definition an event with two means, with the ext add that says so', async () => {
    const { document, edit } = await session();

    expect(() => hosts.resolve(edit, document.tree.require('double'), ext({ id: 'double', action: 'add', type: 'definition.camunda:x' }), [])).toThrow(expect.objectContaining({
      code: 'E_AMBIGUOUS_NESTED',
      details: expect.objectContaining({ hint: expect.stringContaining("bpmn ext add <file> double 'definition[signal].camunda:x' ...") }),
    }));
  });

  it('refuses a slot the element cannot have', async () => {
    const { document, edit } = await session();

    expect(() => hosts.resolve(edit, document.tree.require('bare'), ext({ id: 'bare', action: 'add', type: 'definition.camunda:x' }), [])).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', message: expect.stringContaining('has no event definition (definition.)') }));
  });

  it.each([
    ['definition.camunda:x', 'triggerless', 'c7', 'Give it a trigger first'],
    ['loop.camunda:x', 'bare', 'c7', 'Make it a loop first'],
    ['loop.camunda:x', 'bare', 'c8', 'Make it a multi-instance first'],
    ['condition.camunda:x', 'flow_plain', 'c7', 'Give it a condition first'],
  ] as const)('explains how to get the missing %s on %s (%s)', async (type, id, platform, hint) => {
    const { document, edit } = await session(undefined, platform);

    expect(() => hosts.resolve(edit, document.tree.require(id), ext({ id, action: 'add', type }), [])).toThrow(expect.objectContaining({ code: 'E_NO_NESTED_ELEMENT', details: expect.objectContaining({ hint: expect.stringContaining(hint) }) }));
  });

  it('has nothing to remove from a nested element that does not exist', async () => {
    const { document, edit } = await session();

    expect(() => hosts.resolve(edit, document.tree.require('bare'), ext({ id: 'bare', action: 'remove', index: 0, slot: 'loop' }), [])).toThrow(expect.objectContaining({ code: 'E_NO_EXTENSION', message: expect.stringContaining('so no extension elements there') }));
  });

  it('creates a parallel multi-instance for the first Zeebe loop element', async () => {
    const { document, edit } = await session('edit/extensions-zeebe.bpmn');
    const plain = document.tree.require('plain');
    const notes: string[] = [];

    const { host } = hosts.resolve(edit, plain, ext({ id: 'plain', action: 'add', type: 'loop.zeebe:loopCharacteristics', attrs: { inputCollection: '=items' } }), notes);

    expect(host.is('bpmn:MultiInstanceLoopCharacteristics')).toBe(true);
    expect(plain.get('loopCharacteristics')).toBe(host);
    expect(host.parent).toBe(plain);
    expect(notes[0]).toContain('created a parallel multi-instance loop');
  });

  it('creates that loop for a snippet, not for other content of the slot', async () => {
    const { document, edit } = await session('edit/extensions-zeebe.bpmn');
    const plain = document.tree.require('plain');

    expect(() => hosts.resolve(edit, plain, ext({ id: 'plain', action: 'add', type: 'loop.zeebe:properties' }), [])).toThrow(expect.objectContaining({ code: 'E_NO_NESTED_ELEMENT' }));
    expect(() => hosts.resolve(edit, plain, ext({ id: 'plain', action: 'add', xml: '<zeebe:properties />', slot: 'loop' }), [])).toThrow(expect.objectContaining({ code: 'E_NO_NESTED_ELEMENT' }));
    expect(hosts.resolve(edit, plain, ext({ id: 'plain', action: 'add', xml: ' <zeebe:loopCharacteristics />', slot: 'loop' }), []).host.is('bpmn:MultiInstanceLoopCharacteristics')).toBe(true);
  });
});
