import { describe, expect, it } from 'vitest';
import { ExtensionInserter } from '../../../src/edit/extensions/ExtensionInserter.js';
import { ExtensionLevel } from '../../../src/edit/extensions/ExtensionLevel.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { ReplacedItem } from '../../../src/edit/extensions/ReplacedItem.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import type { ExtOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

async function replaced(id: string, fields: Record<string, unknown>) {
  const document = await Fixtures.readForWrite('edit/extensions-camunda.bpmn');
  const command = Fixtures.operations([{ op: 'ext', id, action: 'add', ...fields }]).model[0] as ExtOperation;
  const [warning] = new ExtensionInserter(document).add(document.tree.require(id), command).warnings;
  return { document, warning };
}

describe('ReplacedItem', () => {
  it('names what a replaced parameter loses, and gives the add that keeps it', async () => {
    const { warning } = await replaced('call', { type: 'camunda:inputParameter[name=final]', attrs: { extra: 'y' } });

    expect(warning).toMatchObject({ code: 'W_PROPERTY_DROPPED', element: 'call' });
    expect(warning!.message).toContain('camunda:script');
    expect(warning!.message).toContain('of the replaced camunda:inputParameter[name=final] in camunda:inputOutput of call was dropped: ext add replaces an item with the same name as a whole');
    expect(warning!.hint).toContain(`--xml '<camunda:inputParameter name="final" extra="y"><camunda:script scriptFormat="groovy">x</camunda:script></camunda:inputParameter>'`);
  });

  it('warns about nothing when the new item keeps everything', async () => {
    const { warning } = await replaced('call', { type: 'camunda:inputParameter[name=draft]', body: 'new' });

    expect(warning).toBeUndefined();
  });

  it('counts the attributes and the value a replacement leaves out', async () => {
    const { warning } = await replaced('approve', { type: 'camunda:formField[id=amount]', attrs: { label: 'Amount' } });

    expect(warning!.message).toContain('type="long", camunda:validation (camunda:constraint[name=required]) of the replaced');
    expect(warning!.message).toContain(' were dropped');
    expect(warning!.hint).toContain('To keep them');
  });

  it('says a long value of a dropped item in short', async () => {
    const { warning } = await replaced('call', { type: 'camunda:outputParameter[name=result]' });

    expect(warning!.message).toContain('its value "${r}"');
  });

  it('counts the twins a replacement collapses and leaves the whole item to the reader', async () => {
    const { warning } = await replaced('twins', { type: 'camunda:inputParameter[name=x]', body: '3' });

    expect(warning!.message).toContain('1 more camunda:inputParameter[name=x] with the same name');
    expect(warning!.hint).toContain(`--xml '<camunda:inputParameter ...>...</camunda:inputParameter>'`);
  });

  it('quotes a path type for the shell in its hint', async () => {
    const { warning } = await replaced('connected', { type: 'camunda:connector/camunda:inputOutput/camunda:inputParameter', attrs: { name: 'url' } });

    expect(warning!.hint).toContain("'camunda:connector/camunda:inputOutput/camunda:inputParameter'");
  });

  it('asks nothing of an item at the top level', async () => {
    const document = await Fixtures.readForWrite('edit/extensions-camunda.bpmn');
    const names = new VendorElements(document, NestedHosts.INSTANCE);
    const call = document.tree.require('call');
    const top = new ExtensionLevel(document, names, call);
    const old = names.createGeneric(call, 'camunda:property', { name: 'k', value: 'v' }, undefined, {}, true);
    const fresh = names.createGeneric(call, 'camunda:property', { name: 'k' }, undefined, {}, true);

    const warning = new ReplacedItem(document, names).droppedContent(top, [old], fresh);

    expect(warning!.message).toBe('value="v" of the replaced camunda:property[name=k] of call was dropped: ext add replaces an item with the same name as a whole');
    expect(warning!.hint).toContain(`bpmn ext add <file> call camunda:property --xml '<camunda:property name="k" value="v" />'`);
  });

  it('escapes the value in the snippet of its hint', async () => {
    const document = await Fixtures.readForWrite('edit/extensions-camunda.bpmn');
    const names = new VendorElements(document, NestedHosts.INSTANCE);
    const call = document.tree.require('call');
    const top = new ExtensionLevel(document, names, call);
    const old = names.createGeneric(call, 'camunda:property', { name: 'k', value: `a<"'&` }, 'b<&', {}, true);
    const fresh = names.createGeneric(call, 'camunda:property', { name: 'k' }, undefined, {}, true);

    const { hint } = new ReplacedItem(document, names).droppedContent(top, [old], fresh)!;

    expect(hint).toContain(`value="a&lt;&quot;'\\''&amp;">b&lt;&amp;</camunda:property>`);
  });

  it('leaves the snippet out of a hint it would make too long', async () => {
    const document = await Fixtures.readForWrite('edit/extensions-camunda.bpmn');
    const names = new VendorElements(document, NestedHosts.INSTANCE);
    const call = document.tree.require('call');
    const old = names.createGeneric(call, 'camunda:property', { name: 'k', value: 'x'.repeat(900) }, undefined, {}, true);
    const fresh = names.createGeneric(call, 'camunda:property', { name: 'k' }, undefined, {}, true);

    const { hint } = new ReplacedItem(document, names).droppedContent(new ExtensionLevel(document, names, call), [old], fresh)!;

    expect(hint).toContain('<camunda:property ...>...</camunda:property>');
  });
});
