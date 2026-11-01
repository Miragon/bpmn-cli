import { describe, expect, it } from 'vitest';
import { ExtensionLevel } from '../../../src/edit/extensions/ExtensionLevel.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import { Fixtures } from '../../support/Fixtures.js';

async function level(id: string, path = 'edit/extensions-camunda.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const names = new VendorElements(document, NestedHosts.INSTANCE);
  const host = document.tree.require(id);
  const top = new ExtensionLevel(document, names, host);
  const built = (name: string, attrs: Record<string, string> = {}) => names.createGeneric(host, name, attrs, undefined, {}, true);
  return { host, names, top, built };
}

describe('ExtensionLevel', () => {
  it('starts at the extension elements of the host and enters a vendor element', async () => {
    const { top } = await level('call');
    const io = top.items()[0]!;

    expect(top.type).toBeUndefined();
    expect(top.label).toBe('extensionElements');
    expect(top.enter(io).type).toBe('camunda:inputOutput');
    expect(top.enter(io).label).toBe('camunda:inputOutput');
    expect(top.enter(io).items()).toHaveLength(3);
  });

  it('holds nothing on a task without extension elements', async () => {
    const { top } = await level('bare');

    expect(top.items()).toEqual([]);
  });

  it('lists what a set of levels holds, once each', async () => {
    const { top } = await level('approve');

    expect(ExtensionLevel.present([top, top])).toEqual(['camunda:formData', 'camunda:executionListener']);
  });

  it('creates the extension elements of a task on the first append', async () => {
    const { host, top, built } = await level('bare');
    const element = built('camunda:formData');

    top.append(element);

    expect(top.items()).toEqual([element]);
    expect(host.get<{ parent: unknown }>('extensionElements').parent).toBe(host);
  });

  it('appends inside a container in the order the engines read', async () => {
    const { top, built, names } = await level('call');
    const io = top.enter(top.items()[0]!);
    const output = built('camunda:outputParameter', { name: 'second' });
    const input = built('camunda:inputParameter', { name: 'third' });

    io.append(output);
    io.append(input);

    expect(io.items().map((item) => names.itemLabel(item))).toEqual(['camunda:inputParameter[name=draft]', 'camunda:inputParameter[name=final]', 'camunda:inputParameter[name=third]', 'camunda:outputParameter[name=result]', 'camunda:outputParameter[name=second]']);
    expect(input.parent).toBe(io.parent);
  });

  it('puts a child of no known rank last, in a container without an order too', async () => {
    const { top, built } = await level('connected');
    const [io, connector] = top.items();
    const stray = built('camunda:field');

    top.enter(connector!).append(stray);
    top.enter(io!).append(stray);

    expect(top.enter(connector!).items().at(-1)).toBe(stray);
    expect(top.enter(io!).items().at(-1)).toBe(stray);
  });

  it('replaces an item in place, at the top and inside a container', async () => {
    const { host, top, built } = await level('call');
    const [io, retry] = top.items();
    const nextRetry = built('camunda:failedJobRetryTimeCycle');
    const inner = top.enter(io!);
    const [draft, final] = inner.items();
    const nextDraft = built('camunda:inputParameter', { name: 'draft' });

    top.replace(retry!, nextRetry);
    inner.replace(draft!, nextDraft);

    expect(top.items()[1]).toBe(nextRetry);
    expect(nextRetry.parent).toBe(host.get('extensionElements'));
    expect(inner.items().slice(0, 2)).toEqual([nextDraft, final]);
    expect(nextDraft.parent).toBe(io);
  });

  it('removes an item, and clears a container that lost its last child', async () => {
    const { top } = await level('connected');
    const [io, connector] = top.items();
    const inner = top.enter(io!);

    inner.remove(inner.items()[0]!);
    top.remove(connector!);

    expect(inner.items()).toEqual([]);
    expect(top.items()).toEqual([io]);
  });

  it('selects the items of a type, one by key, one by position', async () => {
    const { top } = await level('approve');

    expect(top.select({ name: 'camunda:executionListener', text: '' })).toHaveLength(2);
    expect(top.select({ name: 'camunda:executionListener', attr: 'event', value: 'end', text: '' })).toHaveLength(1);
    expect(top.select({ name: 'camunda:executionListener', index: 1, text: '' })[0]!.el).toBe(top.items()[2]);
    expect(top.select({ name: 'camunda:executionListener', index: 2, text: '' })).toEqual([]);
  });

  it('selects a child through the home of its type', async () => {
    const { top } = await level('call');

    const [hit] = top.select({ name: 'camunda:inputParameter', attr: 'name', value: 'final', text: '' });

    expect(hit!.level.type).toBe('camunda:inputOutput');
    expect(top.select({ name: 'camunda:property', text: '' })).toEqual([]);
    expect(top.select({ name: 'camunda:failedJobRetryTimeCycle', attr: 'x', value: 'y', text: '' })).toEqual([]);
  });

  it('finds a keyed item at any depth', async () => {
    const { top } = await level('connected');

    const hits = top.selectDeep({ name: 'camunda:inputParameter', attr: 'name', value: 'url', text: '' });

    expect(hits.map((hit) => hit.level.parent?.parent?.type)).toEqual(['bpmn:ExtensionElements', 'camunda:connector']);
  });
});
