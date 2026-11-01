import { describe, expect, it } from 'vitest';
import { ExtensionChecks } from '../../../src/edit/extensions/ExtensionChecks.js';
import { ExtensionInserter } from '../../../src/edit/extensions/ExtensionInserter.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import type { ExtOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';
import type { BpmnElement } from '../../support/ModelValues.js';

async function checks(path = 'edit/extensions-camunda.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const names = new VendorElements(document, NestedHosts.INSTANCE);
  const items = (id: string): BpmnElement[] => [...(document.tree.require(id).get<BpmnElement | undefined>('extensionElements')?.list<BpmnElement>('values') ?? [])];
  const built = (id: string, name: string, attrs: Record<string, string> = {}, body?: string) => names.createGeneric(document.tree.require(id), name, attrs, body, {}, false);
  return { document, names, items, built, subject: new ExtensionChecks(names) };
}

function warningsOf(document: Awaited<ReturnType<typeof checks>>['document'], id: string, fields: Record<string, unknown>) {
  const command = Fixtures.operations([{ op: 'ext', id, action: 'add', ...fields }]).model[0] as ExtOperation;
  return new ExtensionInserter(document).add(document.tree.require(id), command).warnings;
}

describe('ExtensionChecks', () => {
  it('lets a task hold extension elements', async () => {
    const { document, subject } = await checks();

    expect(() => subject.assertCanHoldExtensions(document.tree.require('call'))).not.toThrow();
  });

  it('refuses extension elements on the definitions, which the engines reject', async () => {
    const { document, subject } = await checks();

    expect(() => subject.assertCanHoldExtensions(document.tree.definitions)).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', message: expect.stringContaining('is the bpmn:definitions element') }));
  });

  it('refuses extension elements on what is no BPMN element', async () => {
    const { names, subject, built } = await checks();

    expect(names.isGeneric(built('call', 'camunda:a'))).toBe(true);
    expect(() => subject.assertCanHoldExtensions(built('call', 'camunda:a'))).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', message: expect.stringContaining('cannot hold bpmn:extensionElements') }));
  });

  it('lets a second keyed or repeatable element in', async () => {
    const { document, items, built, subject } = await checks();
    const host = document.tree.require('approve');

    expect(() => subject.checkInsert(host, items('approve'), undefined, built('approve', 'camunda:executionListener'), false)).not.toThrow();
    expect(() => subject.checkInsert(host, items('approve'), 'camunda:formData', built('approve', 'camunda:formField', { id: 'other' }), false)).not.toThrow();
  });

  it('refuses a child of a container the file holds twice, since it fits neither', async () => {
    const { document, items, built, subject } = await checks();

    expect(() => subject.checkInsert(document.tree.require('twice'), items('twice'), undefined, built('twice', 'camunda:inputParameter', { name: 'x' }), false)).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_EXTENSION', message: expect.stringContaining('already has 2 camunda:inputOutput elements') }));
  });

  it('checks a child against the one container the file holds', async () => {
    const { document, items, built, subject } = await checks();
    const host = document.tree.require('call');

    expect(() => subject.checkInsert(host, items('call'), undefined, built('call', 'camunda:inputParameter', { name: 'x' }), false)).not.toThrow();
  });

  it('refuses a merge into a single-instance element the file holds twice', async () => {
    const { document, items, built, subject } = await checks();
    const twice = document.tree.require('twice');

    expect(() => subject.checkInsert(twice, items('twice'), undefined, built('twice', 'camunda:failedJobRetryTimeCycle'), false)).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_EXTENSION', message: expect.stringContaining('(only one is allowed)') }));
    expect(() => subject.checkInsert(twice, items('twice'), undefined, built('twice', 'camunda:failedJobRetryTimeCycle'), true)).not.toThrow();
  });

  it('refuses a merge that contradicts an attribute or the body', async () => {
    const { document, items, built, subject } = await checks();

    expect(() => subject.checkInsert(document.tree.require('approve'), items('approve'), undefined, built('approve', 'camunda:formData', { businessKey: 'b' }), false)).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_EXTENSION', message: expect.stringContaining('businessKey="a"') }));
    expect(() => subject.checkInsert(document.tree.require('call'), items('call'), undefined, built('call', 'camunda:failedJobRetryTimeCycle', {}, 'R5/PT1M'), false)).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_EXTENSION', details: expect.objectContaining({ hint: expect.stringContaining('--replace') }) }));
  });

  it('checks the children of a merged container, and accepts the same content again', async () => {
    const { document, items, built, subject, names } = await checks();
    const host = document.tree.require('connected');
    const connector = built('connected', 'camunda:connector');
    connector.set('$children', [names.createGeneric(host, 'camunda:connectorId', {}, 'other', {}, true)]);
    const same = built('call', 'camunda:failedJobRetryTimeCycle', {}, 'R3/PT5M');

    expect(() => subject.checkInsert(host, items('connected'), undefined, connector, false)).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_EXTENSION', message: expect.stringContaining('the value "http"') }));
    expect(() => subject.checkInsert(document.tree.require('call'), items('call'), undefined, same, false)).not.toThrow();
  });

  it('warns about a Zeebe element on a kind that does not read it', async () => {
    const { document } = await checks('edit/extensions-zeebe.bpmn');

    expect(warningsOf(document, 'begin', { type: 'zeebe:taskDefinition', attrs: { type: 'x' } })).toEqual([expect.objectContaining({ code: 'W_MISPLACED_EXTENSION', message: expect.stringContaining('is not read by Camunda 8'), element: 'begin' })]);
    expect(warningsOf(document, 'plain', { type: 'zeebe:acme', attrs: { a: 'b' } })).toEqual([]);
    expect(warningsOf(document, 'worker', { type: 'zeebe:header', attrs: { key: 'a', value: 'b' } })).toEqual([]);
  });

  it('warns about a nested-only Camunda element at the top level', async () => {
    const { document } = await checks();

    const [warning] = warningsOf(document, 'approve', { type: 'camunda:constraint', attrs: { name: 'required' } });

    expect(warning!.code).toBe('W_MISPLACED_EXTENSION');
    expect(warning!.hint).toContain("'camunda:formField[id=<id>]/camunda:validation/camunda:constraint'");
  });

  it('warns about field injection outside of the tasks that read it', async () => {
    const { document } = await checks();

    expect(warningsOf(document, 'approve', { type: 'camunda:field', attrs: { name: 'f', stringValue: 'v' } })).toEqual([expect.objectContaining({ code: 'W_MISPLACED_EXTENSION', message: expect.stringContaining('field injection belongs to') })]);
    expect(warningsOf(document, 'call', { type: 'camunda:field', attrs: { name: 'f', stringValue: 'v' } })).toEqual([]);
  });

  it('stays silent about other vendors and about items filed into a container', async () => {
    const { document } = await checks();

    expect(warningsOf(document, 'call', { xml: '<acme:thing xmlns:acme="http://acme.example" />' })).toEqual([]);
    expect(warningsOf(document, 'call', { type: 'camunda:inputParameter', attrs: { name: 'filed' } })).toEqual([]);
  });

  it('warns about a Zeebe element with many homes by the first five of them', async () => {
    const { document } = await checks('edit/extensions-zeebe.bpmn');

    const [warning] = warningsOf(document, 'message_order', { type: 'zeebe:executionListeners' });

    expect(warning!.message).toContain(', ...');
  });
});
