import { describe, expect, it } from 'vitest';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import { Fixtures } from '../../support/Fixtures.js';
import type { BpmnDocument, BpmnElement } from '../../support/ModelValues.js';

const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const CAMUNDA = 'http://camunda.org/schema/1.0/bpmn';

async function vendor(path = 'edit/extensions-camunda.bpmn') {
  const document = await Fixtures.readForWrite(path);
  return { document, names: new VendorElements(document, NestedHosts.INSTANCE) };
}

function extensions(document: BpmnDocument, id: string): readonly BpmnElement[] {
  return document.tree.require(id).get<BpmnElement>('extensionElements').list('values');
}

describe('VendorElements', () => {
  it('names an element by its namespace, under whatever prefix the file gives it', async () => {
    const { document, names } = await vendor('edit/extensions-operaton.bpmn');

    expect(names.typeOf(extensions(document, 'call')[0]!)).toBe('operaton:inputOutput');
    expect(names.canonicalName('other:thing', { other: CAMUNDA })).toBe('camunda:thing');
    expect(names.canonicalName(' bpmn:task ')).toBe('bpmn:task');
  });

  it('leaves a name without a prefix alone and marks an unknown namespace with its uri', async () => {
    const { names } = await vendor();

    expect(names.canonicalName(' plain ')).toBe('plain');
    expect(names.canonicalName('acme:thing', { acme: 'http://acme.example' })).toBe('{http://acme.example}thing');
    expect(names.canonicalName('acme:thing')).toBe('acme:thing');
  });

  it('knows the namespace of the vendors and of BPMN', async () => {
    const { names } = await vendor();

    expect(names.canonicalUri('camunda')).toBe(CAMUNDA);
    expect(names.canonicalUri('acme')).toBeUndefined();
  });

  it("maps a prefix to the file's own prefix for that namespace", async () => {
    const { document, names } = await vendor();
    const call = document.tree.require('call');

    expect(names.resolvePrefix(call, 'c', { c: CAMUNDA })).toEqual({ prefix: 'camunda', uri: CAMUNDA });
    expect(names.resolvePrefix(call, 'b', { b: BPMN })).toEqual({ prefix: 'bpmn', uri: BPMN });
  });

  it('declares a prefix the file lacks, known or brought along', async () => {
    const { document, names } = await vendor();
    const call = document.tree.require('call');

    expect(names.resolvePrefix(call, 'zeebe', {}).uri).toBe('http://camunda.org/schema/zeebe/1.0');
    expect(names.resolvePrefix(call, 'acme', { acme: 'http://acme.example' })).toEqual({ prefix: 'acme', uri: 'http://acme.example' });
    expect(document.tree.definitions.attrs['xmlns:acme']).toBe('http://acme.example');
  });

  it('refuses a snippet that binds a prefix of the file to another namespace', async () => {
    const { document, names } = await vendor();
    const call = document.tree.require('call');

    expect(() => names.resolvePrefix(call, 'xsi', { xsi: 'http://acme.example' })).toThrow(expect.objectContaining({ code: 'E_INVALID_XML', message: expect.stringContaining('The prefix "xsi" is bound to') }));
  });

  it('builds a vendor element with attributes, a body and prefixed attributes', async () => {
    const { document, names } = await vendor();
    const element = names.createGeneric(document.tree.require('call'), 'camunda:field', { name: 'f', 'xmlns:x': 'http://x', 'c:stringValue': 'v' }, 'text', { c: CAMUNDA }, false);

    expect(element.type).toBe('camunda:field');
    expect(element.get('name')).toBe('f');
    expect(element.get('camunda:stringValue')).toBe('v');
    expect(names.bodyOf(element)).toBe('text');
    expect(names.attrsOf(names.createGeneric(document.tree.require('call'), 'camunda:field', {}, '', {}, false))).toEqual({});
  });

  it.each([
    ['a name without a prefix', 'field', '"field" is not a prefixed element name'],
    ['an xmlns name', 'xmlns:field', '"xmlns:field" is not an element name'],
    ['a bpmn element at the top level', 'bpmn:timerEventDefinition', 'must belong to a vendor namespace, not "bpmn:"'],
  ])('refuses %s', async (_case, name, why) => {
    const { document, names } = await vendor();

    expect(() => names.createGeneric(document.tree.require('call'), name, {}, undefined, {}, false)).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', message: expect.stringContaining(why), details: expect.objectContaining({ element: 'call' }) }));
  });

  it('writes xsi:type with the BPMN prefix of the file', async () => {
    const qualified = await vendor('edit/extensions-bpmn2-prefix.bpmn');
    const plain = await vendor('edit/extensions-default-namespace.bpmn');
    const typed = { 'xsi:type': 'bpmn:tFormalExpression' };
    const review = (from: typeof plain) => from.names.createGeneric(from.document.tree.require('review'), 'bpmn:timeDuration', typed, undefined, {}, true);

    expect(review(qualified).get('xsi:type')).toBe('bpmn2:tFormalExpression');
    expect(review(plain).get('xsi:type')).toBe('tFormalExpression');
  });

  it('leaves an xsi:type outside of BPMN as it stands', async () => {
    const { document, names } = await vendor();
    const call = document.tree.require('call');

    expect(names.createGeneric(call, 'camunda:a', { 'xsi:type': 'plain' }, undefined, {}, true).get('xsi:type')).toBe('plain');
    expect(names.createGeneric(call, 'camunda:a', { 'xsi:type': 'acme:t' }, undefined, {}, true).get('xsi:type')).toBe('acme:t');
  });

  it('reads only text attributes and ignores a body of white space', async () => {
    const { document, names } = await vendor();
    const [io, retry] = extensions(document, 'call');
    const [draft] = names.kidsOf(io!);

    expect(names.attrsOf(draft!)).toEqual({ name: 'draft' });
    expect(names.bodyOf(retry!)).toBe('R3/PT5M');
    expect(names.bodyOf(names.createGeneric(document.tree.require('call'), 'camunda:a', {}, '  ', {}, false))).toBeUndefined();
  });

  it('tells a vendor element from a moddle element', async () => {
    const { document, names } = await vendor();

    expect(names.isGeneric(extensions(document, 'call')[0]!)).toBe(true);
    expect(names.isGeneric(document.tree.require('call'))).toBe(false);
  });

  it('labels an item by its key, if it has one', async () => {
    const { document, names } = await vendor();
    const [io, retry] = extensions(document, 'call');

    expect(names.itemLabel(names.kidsOf(io!)[0]!)).toBe('camunda:inputParameter[name=draft]');
    expect(names.keyOf(retry!)).toBeUndefined();
    expect(names.itemLabel(retry!)).toBe('camunda:failedJobRetryTimeCycle');
  });

  it('walks the path of an item, with a position among unkeyed siblings', async () => {
    const { document, names } = await vendor();
    const [form, firstListener, secondListener] = extensions(document, 'approve');
    const field = names.kidsOf(form!)[0]!;

    expect(names.pathOf(names.kidsOf(names.kidsOf(field)[0]!)[0]!)).toBe('camunda:formData/camunda:formField[id=amount]/camunda:validation/camunda:constraint[name=required]');
    expect(names.pathOf(firstListener!)).toBe('camunda:executionListener[0]');
    expect(names.pathOf(secondListener!)).toBe('camunda:executionListener[1]');
  });
});
