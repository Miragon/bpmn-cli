import { describe, expect, it } from 'vitest';
import { ExtensionEditor } from '../../src/edit/ExtensionEditor.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import type { ExtOperation } from '../../src/operations/index.js';
import { Fixtures } from '../support/Fixtures.js';
import type { BpmnElement } from '../support/ModelValues.js';

async function editor(path = 'edit/extensions-camunda.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const apply = (fields: Record<string, unknown>) => new ExtensionEditor(new EditSession(document)).apply(Fixtures.operations([{ op: 'ext', ...fields }]).model[0] as ExtOperation);
  const types = (id: string) => (document.tree.require(id).get<BpmnElement | undefined>('extensionElements')?.list<BpmnElement>('values') ?? []).map(({ type }) => type);
  return { document, apply, types };
}

describe('ExtensionEditor', () => {
  it('adds to an element and removes from it', async () => {
    const { apply, types } = await editor();

    apply({ id: 'bare', action: 'add', type: 'camunda:formData' });
    expect(types('bare')).toEqual(['camunda:formData']);

    apply({ id: 'bare', action: 'remove', type: 'camunda:formData' });
    expect(types('bare')).toEqual([]);
  });

  it('adds to the loop of a task through a slot prefix', async () => {
    const { apply, document } = await editor();

    const changes = apply({ id: 'looped', action: 'add', type: 'loop.camunda:connector' });

    expect(changes.changed[0]).toMatchObject({ id: 'looped', detail: 'ext added loop.camunda:connector' });
    expect(document.tree.require('looped').get<BpmnElement>('loopCharacteristics').get<BpmnElement>('extensionElements').list('values')).toHaveLength(2);
  });

  it('removes from the loop by a numeric type with a prefix', async () => {
    const { apply, document } = await editor();

    apply({ id: 'looped', action: 'remove', type: 'loop.0' });

    expect(document.tree.require('looped').get<BpmnElement>('loopCharacteristics').get('extensionElements')).toBeUndefined();
  });

  it('carries the note about a loop it created into the changes', async () => {
    const { apply } = await editor('edit/extensions-zeebe.bpmn');

    const changes = apply({ id: 'plain', action: 'add', type: 'loop.zeebe:loopCharacteristics', attrs: { inputCollection: '=items' } });

    expect(changes.notes.join()).toContain('created a parallel multi-instance loop');
  });

  it('moves a zeebe:subscription from the task that waits to its message', async () => {
    const { apply, types } = await editor('edit/extensions-zeebe.bpmn');

    const changes = apply({ id: 'receive', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=order' } });

    expect(types('message_order')).toEqual(['zeebe:subscription']);
    expect(types('receive')).toEqual([]);
    expect(changes.changed[0]!.id).toBe('message_order');
    expect(changes.notes.join()).toContain('goes to message message_order');
  });

  it('strips the slot prefix when a subscription of a catch event moves to its message', async () => {
    const { apply, types } = await editor('edit/extensions-zeebe.bpmn');

    apply({ id: 'waiter', action: 'add', type: 'definition.zeebe:subscription', attrs: { correlationKey: '=order' } });

    expect(types('message_order')).toEqual(['zeebe:subscription']);
  });

  it('moves a subscription given as a snippet', async () => {
    const { apply, types } = await editor('edit/extensions-zeebe.bpmn');

    apply({ id: 'waiter', action: 'add', xml: '<zeebe:subscription correlationKey="=order" />' });

    expect(types('message_order')).toEqual(['zeebe:subscription']);
  });

  it('refuses an element that does not exist', async () => {
    const { apply } = await editor();

    await expect(async () => apply({ id: 'nobody', action: 'add', type: 'camunda:x' })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});
