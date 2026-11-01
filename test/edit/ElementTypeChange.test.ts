import { describe, expect, it } from 'vitest';
import { ElementTypeChange } from '../../src/edit/ElementTypeChange.js';
import { ModelOperationRunner } from '../../src/edit/ModelOperationRunner.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import { Fixtures } from '../support/Fixtures.js';
import type { BpmnDocument, BpmnElement } from '../support/ModelValues.js';

const RETYPE = 'edit/retype-elements.bpmn';

async function retyping(id: string, kind: string, set?: Record<string, string>, { path = RETYPE, platform, refAs }: { path?: string; platform?: 'c8'; refAs?: string } = {}) {
  const document = await Fixtures.readForWrite(path);
  const session = new EditSession(document, platform);
  const changes = new ElementTypeChange(session).retype({ op: 'retype', id, kind, ...(set ? { set } : {}), ...(refAs ? { refAs } : {}) });
  return { document, session, changes, element: document.tree.require(id) };
}

function shapesOf(document: BpmnDocument, diagram: number): readonly BpmnElement[] {
  return document.tree.definitions.list('diagrams')[diagram]!.get<BpmnElement>('plane').list('planeElement');
}

describe('ElementTypeChange', () => {
  it('turns a task into a user task with its id, name, documentation, loop and foreign attributes', async () => {
    const { element, changes } = await retyping('task_first', 'userTask');

    expect(element.is('bpmn:UserTask')).toBe(true);
    expect(element.name).toBe('First');
    expect(element.attrs['custom']).toBe('kept');
    expect(element.list('documentation')).toHaveLength(1);
    expect(element.get<BpmnElement>('loopCharacteristics').parent).toBe(element);
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'task_first', detail: 'retyped from task to userTask' })]);
    expect(changes.replaced[0]?.to).toBe(element);
  });

  it('points everything that referred to the old element at the new one', async () => {
    const { document, element } = await retyping('task_first', 'serviceTask');

    expect(document.tree.require('boundary_first').get('attachedToRef')).toBe(element);
    expect(document.tree.require('lane_main').list('flowNodeRef')).toContain(element);
    expect(document.tree.require('flow_toChoice').get('sourceRef')).toBe(element);
    expect(shapesOf(document, 0)[0]?.get('bpmnElement')).toBe(element);
  });

  it('names the flows a sub-process must lose to become an event sub-process', async () => {
    await expect(retyping('sub_connected', 'eventSubProcess')).rejects.toMatchObject({ details: { candidates: ['flow_toConnected'] } });
  });

  it('notes a retype to the kind an element has, and binds its alias all the same', async () => {
    const plain = await retyping('task_first', 'task');
    const event = await retyping('catch_timer', 'intermediateCatchEvent:timer');
    const named = await retyping('send_paid', 'sendTask', undefined, { refAs: '$paid' });

    expect(plain.changes.notes).toEqual(['task_first is already a task; nothing changed']);
    expect(plain.changes.changed).toEqual([]);
    expect(event.changes.notes[0]).toContain('to drop the trigger use `<kind>:none`');
    expect(named.changes.bindings[0]?.el.id).toBe('Message_paid');
  });

  it.each([
    ['a sequence flow', 'flow_toFirst', 'task', 'E_INVALID_RETYPE'],
    ['a task to a gateway', 'task_first', 'parallelGateway', 'E_INVALID_RETYPE'],
    ['a start event to an end event', 'start', 'endEvent', 'E_INVALID_RETYPE'],
    ['a boundary event to a catch event', 'boundary_first', 'intermediateCatchEvent', 'E_INVALID_RETYPE'],
    ['a connected sub-process to an event sub-process', 'sub_connected', 'eventSubProcess', 'E_INVALID_RETYPE'],
    ['a task to a kind BPMN does not know', 'task_first', 'whatever', 'E_UNKNOWN_KIND'],
    ['a timer catch event to a throw event, which cannot wait', 'catch_timer', 'intermediateThrowEvent', 'E_INVALID_TRIGGER'],
    ['an id the file lacks', 'nobody', 'task', 'E_NOT_FOUND'],
  ])('refuses %s', async (_case, id, kind, code) => {
    await expect(retyping(id, kind)).rejects.toMatchObject({ code });
  });

  it('warns that trigger options mean nothing on a task', async () => {
    const { changes } = await retyping('task_first', 'serviceTask', { timer: 'PT1H' });

    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_OPTION_IGNORED', element: 'task_first' })]);
  });

  it('gives an event a new trigger and binds its root element', async () => {
    const { element, changes } = await retyping('boundary_first', 'boundaryEvent:message', { message: 'Paid' }, { refAs: '$paid' });

    expect(element.list('eventDefinitions')[0]?.get<BpmnElement>('messageRef').id).toBe('Message_paid');
    expect(changes.changed[0]?.detail).toBe('retyped from boundaryEvent:timer to boundaryEvent:message');
    expect(changes.bindings[0]?.el.id).toBe('Message_paid');
    expect((await retyping('throw_plain', 'intermediateCatchEvent:timer', { timer: 'PT1H' })).element.name).toBe('Say');
  });

  it('updates the options of the trigger an event keeps', async () => {
    const { element, changes } = await retyping('catch_timer', 'intermediateCatchEvent', { timer: 'PT9M' });

    expect(element.list('eventDefinitions')[0]?.get<BpmnElement>('timeDuration').get('body')).toBe('PT9M');
    expect(changes.changed[0]?.detail).toBe('trigger options updated (timer=PT9M)');
  });

  it.each([
    ['a throw event that sends a message flow, into a catcher', 'throw_invoice', 'intermediateCatchEvent:message', 'catching events cannot send messages'],
    ['a catch event that takes a message flow, into a thrower', 'catch_invoice', 'intermediateThrowEvent:message', 'throwing events cannot receive messages'],
  ])('refuses to retype %s', async (_case, id, kind, message) => {
    await expect(retyping(id, kind, undefined, { path: 'edit/events-message-flows.bpmn' })).rejects.toMatchObject({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining(message) });
  });

  it('warns about each property the new kind lacks', async () => {
    const send = await retyping('send_paid', 'task');
    const script = await retyping('script_run', 'task');
    const complex = await retyping('gateway_complex', 'exclusiveGateway');

    expect(send.changes.warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED', message: 'messageRef of send_paid (Message_paid) was dropped: a task has no messageRef' });
    expect(script.changes.warnings.map(({ message }) => message)).toContain('script of script_run (run()) was dropped: a task has no script');
    expect(complex.changes.warnings[0]?.message).toBe('activationCondition of gateway_complex (bpmn:FormalExpression) was dropped: a exclusiveGateway has no activationCondition');
  });

  it('keeps the default flow of a gateway that can have one, and tells of one that cannot', async () => {
    const inclusive = await retyping('gateway_choice', 'inclusiveGateway');
    const parallel = await retyping('gateway_choice', 'parallelGateway');

    expect(inclusive.element.get<BpmnElement>('default').id).toBe('flow_no');
    expect(parallel.changes.warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED', hint: 'The flow still exists but is no longer marked as default.' });
  });

  it('takes the conditions off the flows of a gateway that ignores them', async () => {
    const { document } = await retyping('gateway_choice', 'parallelGateway');

    expect(document.tree.require('flow_yes').get('conditionExpression')).toBeUndefined();
  });

  it('records the content a sub-process loses so the batch can refuse it', async () => {
    const { session, document, changes } = await retyping('sub_collapsed', 'task');

    expect(session.journal.droppedContent).toEqual([{ element: 'sub_collapsed', kind: 'task', removed: ['sub_inner'] }]);
    expect(changes.warnings[0]?.message).toContain('flowElements of sub_collapsed (1 element(s)) was dropped');
    expect(document.tree.has('sub_inner')).toBe(false);
  });

  it('drops the diagram of a sub-process that becomes something without a plane, and frees its ids', async () => {
    const { document } = await retyping('sub_collapsed', 'callActivity');

    expect(document.tree.definitions.list('diagrams').map(({ id }) => id)).toEqual(['BPMNDiagram_main']);
    expect(document.ids.registry.has('BPMNPlane_sub')).toBe(false);
    expect(document.ids.registry.has('BPMNDiagram_sub')).toBe(false);
    expect(shapesOf(document, 0)[1]?.get('bpmnElement')).toBe(document.tree.require('sub_collapsed'));
  });

  it('keeps the diagram of a sub-process that stays one', async () => {
    const { document, element } = await retyping('sub_collapsed', 'transaction');

    expect(document.tree.definitions.list('diagrams')[1]?.get<BpmnElement>('plane').get('bpmnElement')).toBe(element);
    expect(element.list('flowElements').map(({ id }) => id)).toEqual(['sub_inner']);
  });

  it('turns a sub-process into an event sub-process and leaves the event flag behind on the way back', async () => {
    const event = await retyping('sub_collapsed', 'eventSubProcess');
    const plain = await retyping('sub_handler', 'subProcess');
    const transaction = await retyping('sub_handler', 'transaction');
    const task = await retyping('sub_handler', 'task');

    expect(event.element.get('triggeredByEvent')).toBe(true);
    expect(plain.element.peek('triggeredByEvent')).toBeFalsy();
    expect(transaction.element.peek('triggeredByEvent')).toBeFalsy();
    expect(task.element.is('bpmn:Task')).toBe(true);
  });

  it('marks a new user task on Camunda 8 and says so', async () => {
    const { changes } = await retyping('ship', 'userTask', undefined, { path: 'edit/order-check.bpmn', platform: 'c8' });

    expect(changes.notes).toEqual(['ship is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)']);
  });

  it('warns about vendor attributes the new kind cannot use', async () => {
    const { changes } = await retyping('task_form', 'serviceTask', undefined, { path: 'model/c7-vendor.bpmn' });

    expect(changes.warnings.map(({ code }) => code)).toContain('W_PROPERTY_INAPPLICABLE');
  });

  it('lets an alias follow its element through each retype to another type', async () => {
    const document = await Fixtures.readForWrite('edit/order-check.bpmn');
    const operations = [
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'check', as: '$task' },
      { op: 'retype', id: '$task', kind: 'userTask' },
      { op: 'set', id: '$task', set: { name: 'Check the invoice' } },
      { op: 'retype', id: '$task', kind: 'manualTask' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', after: '$task', as: '$ok' },
      { op: 'retype', id: '$ok', kind: 'parallelGateway' },
    ];

    const { aliases } = new ModelOperationRunner(document).run(Fixtures.operations(operations));

    expect(document.tree.require(aliases['$task']!).is('bpmn:ManualTask')).toBe(true);
    expect(document.tree.require(aliases['$task']!).name).toBe('Check the invoice');
    expect(document.tree.require(aliases['$ok']!).is('bpmn:ParallelGateway')).toBe(true);
  });

  it('answers an alias of an element removed after its retype with the element it named', async () => {
    const document = await Fixtures.readForWrite('edit/order-check.bpmn');
    const operations = [
      { op: 'add', kind: 'task', name: 'Review', after: 'check', as: '$task' },
      { op: 'retype', id: '$task', kind: 'userTask' },
      { op: 'remove', ids: ['$task'] },
      { op: 'set', id: '$task', set: { name: 'Gone' } },
    ];

    expect(() => new ModelOperationRunner(document).run(Fixtures.operations(operations))).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND', message: expect.stringContaining('which an op before this one removed') }));
  });
});
