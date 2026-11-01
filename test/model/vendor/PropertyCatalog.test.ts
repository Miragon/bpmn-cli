import { describe, expect, it } from 'vitest';
import { PropertyCatalog } from '../../../src/model/vendor/PropertyCatalog.js';
import { Fixtures } from '../../support/Fixtures.js';

async function catalogOf(id: string): Promise<PropertyCatalog> {
  return PropertyCatalog.of((await Fixtures.read('model/events.bpmn')).tree.require(id));
}

describe('PropertyCatalog', () => {
  it('documents every key of set with the elements it applies to', () => {
    const docs = PropertyCatalog.docs();

    expect(docs).toHaveLength(36);
    expect(docs[0]).toEqual({
      key: 'id',
      appliesTo: 'any',
      description: 'Rename the element; every reference (flows, lanes, boundary hosts, calledElement) follows, and so does a DI id derived from the old id (BPMNShape_<id>, <id>_di)',
    });
    expect(docs.filter(({ key }) => key === 'default').map(({ appliesTo }) => appliesTo)).toEqual(['sequenceFlow', 'flowNode']);
    expect(docs.at(-1)).toEqual({ key: 'text', appliesTo: 'textAnnotation', description: 'Annotation text' });
  });

  it('lists the keys a user task accepts, the documented ones first and the vendor placeholder last', async () => {
    const catalog = await catalogOf('task_review');

    expect(catalog.settableKeys()).toEqual(['id', 'name', 'doc', 'default', 'loop', 'cardinality', 'completion', 'loop.<key>', 'lane', 'isForCompensation', 'startQuantity', 'completionQuantity', 'implementation', '<prefix>:<attr>']);
  });

  it('lists other keys for a sequence flow and for a timer start event', async () => {
    const flow = (await catalogOf('flow_yes')).settableKeys();
    const start = (await catalogOf('start_timer')).settableKeys();

    expect(flow).toEqual(['id', 'name', 'doc', 'condition', 'language', 'default', 'source', 'target', 'condition.<key>', 'isImmediate', '<prefix>:<attr>']);
    expect(start).toContain('timer');
    expect(start).not.toContain('condition');
  });

  it('adds the conditional keys only to an event that waits for a condition', async () => {
    const conditional = (await catalogOf('catch_condition')).settableKeys();
    const timer = (await catalogOf('catch_date')).settableKeys();

    expect(conditional).toContain('condition.<key>');
    expect(timer).not.toContain('condition.<key>');
  });

  it('finds the documented entry of a key, of a nested key, of a vendor attribute and of a plain property', async () => {
    const task = await catalogOf('task_review');
    const start = await catalogOf('start_timer');

    expect(task.entry('name').key).toBe('name');
    expect(task.entry('loop.camunda:collection').key).toBe('loop.<key>');
    expect(task.entry('camunda:assignee').key).toBe('<prefix>:<attr>');
    expect(task.entry('isForCompensation').key).toBe('<property>');
    expect(start.entry('definition[timer].camunda:topic').key).toBe('definition.<key>');
  });

  it('refuses a key the element lacks with E_UNKNOWN_KEY, naming the element and the keys it accepts in order', async () => {
    const task = await catalogOf('task_review');

    expect(() => task.entry('timer')).toThrow(
      expect.objectContaining({
        code: 'E_UNKNOWN_KEY',
        message: 'Unknown key "timer" for userTask task_review',
        details: expect.objectContaining({ element: 'task_review', candidates: task.settableKeys(), hint: `Settable keys for this element: ${task.settableKeys().join(', ')}.` }),
      }),
    );
  });

  it('refuses a vendor key without a prefix or a name, or in the xmlns namespace, and says what vendor keys look like', async () => {
    const task = await catalogOf('task_review');

    expect(() => task.entry('camunda:')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_KEY', message: 'Unknown key "camunda:" for userTask task_review (vendor attributes look like prefix:name)' }));
    expect(() => task.assertVendorKey('xmlns:acme')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_KEY' }));
    expect(() => task.assertVendorKey('camunda:assignee')).not.toThrow();
  });

  it('builds the refusal for a key with the reason the caller gives', async () => {
    const task = await catalogOf('task_review');

    const error = task.unknownKey('timer', 'only events wait for a timer');

    expect([error.code, error.message]).toEqual(['E_UNKNOWN_KEY', 'Unknown key "timer" for userTask task_review (only events wait for a timer)']);
  });

  it('settles which descriptor properties set may write: primitives, enumerations and id references, but not lists or blocked ones', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const gateway = document.tree.require('gateway_choice');
    const boundary = document.tree.require('boundary_soon');
    const catalog = PropertyCatalog.of(gateway);
    const property = (name: string) => gateway.descriptor.propertiesByName![name]!;

    expect([catalog.isSettable(property('name')), catalog.isSettable(property('gatewayDirection')), catalog.isSettable(property('default'))]).toEqual([true, true, true]);
    expect([catalog.isSettable(property('incoming')), PropertyCatalog.of(boundary).isSettable(boundary.descriptor.propertiesByName!['attachedToRef']!)]).toEqual([false, false]);
  });

  it('lists the literals of an enumeration type, and none for a primitive, an unknown prefix or an unknown name', async () => {
    const catalog = await catalogOf('gateway_choice');

    expect(catalog.enumLiterals('bpmn:GatewayDirection')).toEqual(['Unspecified', 'Converging', 'Diverging', 'Mixed']);
    expect([catalog.enumLiterals('String'), catalog.enumLiterals('acme:Colour'), catalog.enumLiterals('bpmn:Nope')]).toEqual([undefined, undefined, undefined]);
  });

  it('lists the descriptor properties of a task that set may write by their own name', async () => {
    expect((await catalogOf('task_review')).genericKeys()).toEqual(['name', 'isForCompensation', 'default', 'startQuantity', 'completionQuantity', 'implementation']);
  });

  it('explains why a key is blocked and has no reason for a key that is not', () => {
    expect(PropertyCatalog.blockedReason('attachedToRef')).toBe('use `bpmn move <file> <id> --on <activityId>`');
    expect(PropertyCatalog.blockedReason('name')).toBeUndefined();
  });

  it('reads the keys ahead of the vendor placeholder and those behind it separately', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const catalog = PropertyCatalog.of(document.tree.require('task_review'));

    expect(catalog.readBeforeGeneric(document)).toEqual({ id: 'task_review', name: 'Review order' });
    expect(catalog.readAfterGeneric(document)).toEqual({ loop: 'sequential', cardinality: '3', completion: '${done}', lane: 'Lane_inside' });
  });

  it('takes the message of a message flow as a key', async () => {
    const document = await Fixtures.read('models/incremental/orders.bpmn');
    const catalog = PropertyCatalog.of(document.tree.require('Msg_1'));

    expect(catalog.entry('message').appliesTo).toBe('messageFlow');
    expect(catalog.settableKeys()).toContain('message');
  });
});
