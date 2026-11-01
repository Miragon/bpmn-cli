import { describe, expect, it } from 'vitest';
import { ExtensionInserter } from '../../../src/edit/extensions/ExtensionInserter.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import type { ExtOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';
import type { BpmnElement } from '../../support/ModelValues.js';

function ext(id: string, fields: Record<string, unknown>): ExtOperation {
  return Fixtures.operations([{ op: 'ext', id, action: 'add', ...fields }]).model[0] as ExtOperation;
}

async function inserter(path = 'edit/extensions-camunda.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const names = new VendorElements(document, NestedHosts.INSTANCE);
  const add = (id: string, fields: Record<string, unknown>) => new ExtensionInserter(document).add(document.tree.require(id), ext(id, fields));
  const items = (id: string): BpmnElement[] => [...(document.tree.require(id).get<BpmnElement | undefined>('extensionElements')?.list<BpmnElement>('values') ?? [])];
  const labels = (parent: BpmnElement) => names.kidsOf(parent).map((kid) => names.itemLabel(kid));
  return { document, names, add, items, labels };
}

describe('ExtensionInserter', () => {
  it('adds a vendor element to a task without extension elements', async () => {
    const { add, items } = await inserter();

    const changes = add('bare', { type: 'camunda:formData', attrs: { businessKey: 'k' } });

    expect(items('bare').map(({ type }) => type)).toEqual(['camunda:formData']);
    expect(changes.changed[0]).toMatchObject({ id: 'bare', detail: 'ext added camunda:formData' });
  });

  it('files a parameter into a camunda:inputOutput it creates, and says so', async () => {
    const { add, items, labels } = await inserter();

    const changes = add('bare', { type: 'camunda:outputParameter', attrs: { name: 'out' } });
    add('bare', { type: 'camunda:inputParameter', attrs: { name: 'in' }, body: '1' });

    expect(labels(items('bare')[0]!)).toEqual(['camunda:inputParameter[name=in]', 'camunda:outputParameter[name=out]']);
    expect(changes.notes).toEqual(['created camunda:inputOutput for camunda:outputParameter']);
  });

  it('merges a second single-instance container and reports what it took in', async () => {
    const { add, items, labels } = await inserter();

    const changes = add('call', { xml: '<camunda:inputOutput><camunda:inputParameter name="b">2</camunda:inputParameter></camunda:inputOutput>' });

    expect(items('call')).toHaveLength(2);
    expect(labels(items('call')[0]!)).toContain('camunda:inputParameter[name=b]');
    expect(changes.changed[0]!.detail).toBe('ext merged camunda:inputOutput (added camunda:inputParameter[name=b])');
  });

  it('merges attributes and a value a single-instance element lacks', async () => {
    const { add, names, items } = await inserter();
    add('bare', { type: 'camunda:failedJobRetryTimeCycle' });

    const changes = add('bare', { type: 'camunda:failedJobRetryTimeCycle', attrs: { a: 'b' }, body: 'R1/PT1M' });

    expect(names.bodyOf(items('bare')[0]!)).toBe('R1/PT1M');
    expect(changes.changed[0]!.detail).toBe('ext merged camunda:failedJobRetryTimeCycle (a="b", value)');
  });

  it('reports nothing when the file already holds the same content', async () => {
    const { add } = await inserter();

    const changes = add('call', { type: 'camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' });

    expect(changes.changed).toEqual([]);
    expect(changes.notes.join()).toContain('already holds that content');
  });

  it('replaces a parameter of the same name in place and warns about what it lost', async () => {
    const { add, items, labels, names } = await inserter();

    const changes = add('call', { type: 'camunda:inputParameter', attrs: { name: 'draft' }, body: '2' });

    const [first] = names.kidsOf(items('call')[0]!);
    expect(names.bodyOf(first!)).toBe('2');
    expect(labels(items('call')[0]!)).toHaveLength(3);
    expect(changes.changed[0]!.detail).toBe('ext replaced camunda:inputParameter[name=draft] in camunda:inputOutput');
    expect(changes.warnings).toEqual([]);
    expect(changes.notes.at(-1)).toBe('replaced the existing camunda:inputParameter[name=draft] in camunda:inputOutput of call');
  });

  it('collapses twins of a key into the one item that replaces them', async () => {
    const { add, items, labels } = await inserter();

    const changes = add('twins', { type: 'camunda:inputParameter', attrs: { name: 'x' }, body: '3' });

    expect(labels(items('twins')[0]!)).toEqual(['camunda:inputParameter[name=x]']);
    expect(changes.warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED' });
  });

  it('drops no warning for what --replace was told to drop', async () => {
    const { add } = await inserter();

    expect(add('call', { type: 'camunda:inputParameter[name=final]', replace: true }).warnings).toEqual([]);
    expect(add('call', { type: 'camunda:inputParameter[name=draft]' }).warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED' });
  });

  it('replaces all unkeyed elements of a type with --replace', async () => {
    const { add, items } = await inserter();

    const changes = add('approve', { type: 'camunda:executionListener', attrs: { event: 'take' }, replace: true });

    expect(items('approve').map(({ type }) => type)).toEqual(['camunda:formData', 'camunda:executionListener']);
    expect(changes.notes).toEqual(['replaced 2 existing camunda:executionListener']);
    expect(changes.changed[0]!.detail).toBe('ext replaced camunda:executionListener');
  });

  it('repeats a repeatable type', async () => {
    const { add, items } = await inserter();

    add('approve', { type: 'camunda:executionListener', attrs: { event: 'take' } });

    expect(items('approve')).toHaveLength(4);
  });

  it('follows a path into the connector, not the task, for a nested parameter', async () => {
    const { add, items, labels, names } = await inserter();

    add('connected', { type: 'camunda:connector/camunda:inputOutput/camunda:inputParameter', attrs: { name: 'method' } });

    expect(labels(items('connected')[0]!)).toEqual(['camunda:inputParameter[name=url]']);
    expect(labels(names.kidsOf(items('connected')[1]!)[1]!)).toContain('camunda:inputParameter[name=method]');
  });

  it('creates the containers on a path, and files a child in the container it enters', async () => {
    const { add, items, names } = await inserter();

    const changes = add('bare', { type: 'camunda:connector/camunda:inputParameter', attrs: { name: 'url' } });

    const connector = items('bare')[0]!;
    expect(connector.type).toBe('camunda:connector');
    expect(names.kidsOf(connector)[0]!.type).toBe('camunda:inputOutput');
    expect(changes.notes).toContain('created camunda:inputOutput in camunda:connector for camunda:inputParameter');
    expect(changes.changed[0]!.detail).toBe('ext added camunda:connector, camunda:inputParameter[name=url] to camunda:inputOutput');
  });

  it('takes the key of the last step as an attribute', async () => {
    const { add, items, labels } = await inserter();

    add('bare', { type: 'camunda:inputOutput/camunda:inputParameter[name=url]' });
    add('bare', { type: 'camunda:inputOutput/camunda:inputParameter[name=host]', xml: '<camunda:inputParameter>h</camunda:inputParameter>' });
    add('bare', { type: 'camunda:inputOutput/camunda:inputParameter[name=url]', attrs: { name: 'url' } });

    expect(labels(items('bare')[0]!)).toEqual(['camunda:inputParameter[name=url]', 'camunda:inputParameter[name=host]']);
  });

  it.each([
    ['a position on the new element', { type: 'camunda:inputParameter[0]' }, 'E_INVALID_VALUE', 'an [index] only selects existing elements'],
    ['a key that contradicts the attributes', { type: 'camunda:inputParameter[name=a]', attrs: { name: 'b' } }, 'E_INVALID_VALUE', 'camunda:inputParameter[name=a] and name=b disagree'],
    ['a snippet root of another type', { type: 'camunda:inputParameter', xml: '<camunda:outputParameter />' }, 'E_INVALID_VALUE', "The --xml snippet's root <camunda:outputParameter> does not match"],
    ['a position on a snippet', { type: 'camunda:inputParameter[0]', xml: '<camunda:inputParameter />' }, 'E_INVALID_VALUE', 'an [index] only selects existing elements'],
    ['a key that contradicts the snippet', { type: 'camunda:inputParameter[name=a]', xml: '<camunda:inputParameter name="b" />' }, 'E_INVALID_VALUE', 'and the snippet\'s name="b" disagree'],
    ['a blank snippet without a type', { xml: '  ' }, 'E_USAGE', 'ext add needs --type'],
    ['a path through two matches', { type: 'camunda:executionListener/camunda:script' }, 'E_AMBIGUOUS_EXTENSION', 'camunda:executionListener matches 2 elements'],
    ['a selected container that does not exist', { type: 'camunda:inputOutput[0]/camunda:inputParameter', attrs: { name: 'x' } }, 'E_NO_EXTENSION', 'approve has no camunda:inputOutput[0]'],
    ['a container only its own attributes could make', { type: 'camunda:field/camunda:string' }, 'E_NO_EXTENSION', 'approve has no camunda:field to add into'],
  ])('refuses %s', async (_case, fields, code, message) => {
    const { add, document } = await inserter();
    const before = document.tree.require('approve').get('extensionElements');

    expect(() => add('approve', fields)).toThrow(expect.objectContaining({ code, message: expect.stringContaining(message) }));
    expect(document.tree.require('approve').get('extensionElements')).toBe(before);
  });

  it('reports for a nested host under the prefix of the slot', async () => {
    const { document, names } = await inserter();
    const looped = document.tree.require('looped');
    const { host } = NestedHosts.INSTANCE.resolve(new EditSession(document), looped, ext('looped', { type: 'loop.camunda:connector' }), []);

    const changes = new ExtensionInserter(document).add(host, ext('looped', { type: 'camunda:connector' }));

    expect(changes.changed[0]).toMatchObject({ id: 'looped', detail: 'ext added loop.camunda:connector' });
    expect(names.kidsOf(host)).toEqual([]);
  });

  it('writes bpmn: children under the prefix of the file', async () => {
    const { add, items, names } = await inserter('edit/extensions-bpmn2-prefix.bpmn');

    add('review', { type: 'camunda:taskListener', xml: '<camunda:taskListener event="timeout"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></camunda:taskListener>' });

    const timer = names.kidsOf(items('review')[0]!)[0]!;
    expect(timer.type).toBe('bpmn2:timerEventDefinition');
    expect(names.kidsOf(timer)[0]!.get('xsi:type')).toBe('bpmn2:tFormalExpression');
  });
});
