import { describe, expect, it } from 'vitest';
import { ExtensionRemover } from '../../../src/edit/extensions/ExtensionRemover.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import type { ExtOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';
import type { BpmnElement } from '../../support/ModelValues.js';

function ext(id: string, fields: Record<string, unknown>): ExtOperation {
  return Fixtures.operations([{ op: 'ext', id, action: 'remove', ...fields }]).model[0] as ExtOperation;
}

async function remover() {
  const document = await Fixtures.readForWrite('edit/extensions-camunda.bpmn');
  const names = new VendorElements(document, NestedHosts.INSTANCE);
  const remove = (id: string, fields: Record<string, unknown>) => new ExtensionRemover(document).remove(document.tree.require(id), ext(id, fields));
  const items = (id: string): BpmnElement[] => [...(document.tree.require(id).get<BpmnElement | undefined>('extensionElements')?.list<BpmnElement>('values') ?? [])];
  return { document, names, remove, items };
}

describe('ExtensionRemover', () => {
  it('removes one parameter by key and leaves its siblings', async () => {
    const { remove, items, names } = await remover();

    const changes = remove('call', { type: 'camunda:inputParameter[name=draft]' });

    expect(names.kidsOf(items('call')[0]!).map((kid) => names.itemLabel(kid))).toEqual(['camunda:inputParameter[name=final]', 'camunda:outputParameter[name=result]']);
    expect(changes.changed[0]).toMatchObject({ id: 'call', detail: 'ext removed camunda:inputParameter[name=draft] from camunda:inputOutput' });
  });

  it('removes every element of a bare type', async () => {
    const { remove, items } = await remover();

    const changes = remove('approve', { type: 'camunda:executionListener' });

    expect(items('approve').map(({ type }) => type)).toEqual(['camunda:formData']);
    expect(changes.changed[0]!.detail).toBe('ext removed camunda:executionListener, camunda:executionListener');
  });

  it('removes by index among the extension elements', async () => {
    const { remove, items } = await remover();

    remove('call', { index: 1 });

    expect(items('call').map(({ type }) => type)).toEqual(['camunda:inputOutput']);
  });

  it('follows a path and removes the container the last child left empty', async () => {
    const { remove, names, items } = await remover();

    const changes = remove('approve', { type: 'camunda:formData/camunda:formField[id=amount]/camunda:validation/camunda:constraint[name=required]' });

    expect(changes.notes).toEqual(['removed the empty camunda:validation of approve']);
    expect(names.kidsOf(names.kidsOf(items('approve')[0]!)[0]!)).toEqual([]);
  });

  it('drops an emptied top-level container and then the extension elements', async () => {
    const { remove, document } = await remover();

    const changes = remove('twins', { type: 'camunda:inputParameter[name=x]' });

    expect(changes.notes).toEqual(['removed the empty camunda:inputOutput of twins']);
    expect(document.tree.require('twins').get('extensionElements')).toBeUndefined();
  });

  it('keeps an emptied container that means something on its own', async () => {
    const { remove, items } = await remover();

    const changes = remove('approve', { type: 'camunda:formData/camunda:formField[id=amount]' });

    expect(changes.notes).toEqual([]);
    expect(items('approve')[0]!.type).toBe('camunda:formData');
  });

  it('takes a type in any case when nothing matches exactly', async () => {
    const { remove, items } = await remover();

    remove('call', { type: 'camunda:FAILEDJobRetryTimeCycle' });

    expect(items('call')).toHaveLength(1);
  });

  it('finds a keyed item deeper, if it sits in one place', async () => {
    const { remove, names, items } = await remover();

    remove('approve', { type: 'camunda:constraint[name=required]' });

    expect(names.kidsOf(names.kidsOf(items('approve')[0]!)[0]!)).toEqual([]);
  });

  it('refuses a key that matches items in several places and names their paths', async () => {
    const { remove } = await remover();

    expect(() => remove('forms', { type: 'camunda:constraint[name=required]' })).toThrow(expect.objectContaining({
      code: 'E_AMBIGUOUS_EXTENSION',
      message: expect.stringContaining('matches items in 2 places of forms'),
      details: expect.objectContaining({ candidates: ['camunda:formData/camunda:formField[id=first]/camunda:validation/camunda:constraint[name=required]', 'camunda:formData/camunda:formField[id=second]/camunda:validation/camunda:constraint[name=required]'] }),
    }));
  });

  it('takes the file\'s home of a type before it searches deeper', async () => {
    const { remove, items, names } = await remover();

    remove('connected', { type: 'camunda:inputParameter[name=url]' });

    expect(items('connected').map(({ type }) => type)).toEqual(['camunda:connector']);
    expect(names.kidsOf(names.kidsOf(items('connected')[0]!)[1]!)).toHaveLength(1);
  });

  it.each([
    ['bare', { type: 'camunda:x' }, 'bare has no extension elements'],
    ['call', { index: 5 }, 'call has no extension element at index 5 (0..1)'],
    ['call', { type: 'camunda:property' }, 'call has no camunda:property extension element'],
    ['call', { type: 'camunda:inputOutput/camunda:property' }, 'call has no camunda:property (in camunda:inputOutput/camunda:property)'],
  ])('finds nothing to remove from %s: %o', async (id, fields, message) => {
    const { remove } = await remover();

    expect(() => remove(id, fields)).toThrow(expect.objectContaining({ code: 'E_NO_EXTENSION', message: expect.stringContaining(message) }));
  });

  it('lists what is there when a selector misses', async () => {
    const { remove } = await remover();

    expect(() => remove('call', { type: 'camunda:inputParameter[name=nope]' })).toThrow(expect.objectContaining({ details: expect.objectContaining({ candidates: expect.arrayContaining(['camunda:inputParameter[name=draft]']) }) }));
  });

  it('asks for a type or an index when the selector is empty', async () => {
    const { remove } = await remover();

    expect(() => remove('call', { type: '' })).toThrow(expect.objectContaining({ code: 'E_USAGE', message: 'ext remove needs --type <prefix:localName> or --index <n>' }));
  });
});
