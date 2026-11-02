import { describe, expect, it } from 'vitest';
import { PropertyEditor } from '../../src/edit/PropertyEditor.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import { Fixtures } from '../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../support/ModelValues.js';

async function set(id: string, values: Record<string, string>, refAs?: string) {
  const document = await Fixtures.readForWrite('edit/properties-editor.bpmn');
  const operation = Fixtures.operations([{ op: 'set', id, set: values, ...(refAs ? { refAs } : {}) }]).model[0] as Parameters<PropertyEditor['set']>[0];
  const changes = new PropertyEditor(new EditSession(document)).set(operation);
  const details = changes.changed.map(({ detail }) => detail);
  return { document, changes, details, element: document.tree.byId(values['id'] ?? id)! };
}

function conditionOf(flow: BpmnElement): BpmnElement | undefined {
  return flow.get<BpmnElement | undefined>('conditionExpression');
}

describe('PropertyEditor', () => {
  it.each<[string, string, Record<string, string>, string[]]>([
    ['a name', 'task_plain', { name: 'Check' }, ['name=Check']],
    ['an empty value as removal', 'task_plain', { name: '' }, ['name removed']],
    ['a key with a bpmn: prefix', 'task_plain', { 'bpmn:name': 'Check' }, ['name=Check']],
    ['a key with spaces', 'task_plain', { ' name ': 'Check' }, ['name=Check']],
    ['the long name of the documentation', 'task_plain', { documentation: 'Check' }, ['doc=Check']],
    ['an id, naming the former one', 'task_bare', { id: 'task_renamed' }, ['renamed from task_bare']],
    ['the loop keys of an activity', 'task_bare', { cardinality: '3', completion: '${done}' }, ['cardinality=3', 'completion=${done}']],
    ['a decision of a business rule task', 'task_rule', { calledDecision: 'risk' }, ['calledDecision=risk (camunda:decisionRef)']],
    ['the default flow of a gateway', 'gateway_split', { default: 'flow_plain' }, ['no longer the default flow of gateway_split', 'default=flow_plain']],
    ['the message of a send task', 'task_send', { message: 'Order' }, ['message=Order']],
    ['a vendor attribute', 'task_service', { 'camunda:class': 'com.Acme' }, ['camunda:class=com.Acme']],
    ['the removal of a vendor attribute', 'task_service', { 'camunda:class': '' }, ['camunda:class removed']],
    ['a BPMN attribute no key of its own handles', 'task_plain', { isForCompensation: 'true' }, ['isForCompensation=true']],
    ['a condition with its language', 'flow_plain', { condition: 'x > 1', language: 'groovy' }, ['condition=x > 1 (groovy)']],
    ['another key of a condition after the condition', 'flow_juel', { 'condition.language': 'juel' }, ['condition.language=juel']],
  ])('writes and records %s', async (_case, id, values, details) => {
    expect((await set(id, values)).details).toEqual(details);
  });

  it('names a group through its category value', async () => {
    const { element } = await set('group_named', { name: 'Marked' });

    expect(element.get<BpmnElement>('categoryValueRef').get('value')).toBe('Marked');
  });

  it('writes the first documentation, keeps the others, and removes them all with an empty value', async () => {
    const texts = (element: BpmnElement) => element.list<BpmnElement>('documentation').map((entry) => entry.get('text'));

    expect(texts((await set('task_plain', { doc: 'New' })).element)).toEqual(['New', 'Second']);
    expect(texts((await set('task_bare', { doc: 'New' })).element)).toEqual(['New']);
    expect(texts((await set('task_plain', { doc: '' })).element)).toEqual([]);
  });

  it('redirects a flow to a new end and names the change', async () => {
    const { element, document, details } = await set('flow_other', { target: 'task_bare' });

    expect(element.get('targetRef')).toBe(document.tree.require('task_bare'));
    expect(details[0]).toContain('(target changed)');
  });

  it('drops the condition of a flow moved behind a parallel gateway', async () => {
    const { element, changes } = await set('flow_juel', { source: 'gateway_fork' });

    expect(conditionOf(element)).toBeUndefined();
    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', element: 'flow_juel' })]);
  });

  it('asks for a sub-process to open or close', async () => {
    expect((await set('sub_plain', { expanded: '' })).changes.expansions.expansion().expand).toEqual(['sub_plain']);
    expect((await set('sub_plain', { expanded: 'false' })).changes.expansions.expansion().collapse).toEqual(['sub_plain']);
  });

  it('removes a stray decision attribute from a task that calls none', async () => {
    expect((await set('task_service', { calledDecision: '' })).element.attrs).not.toHaveProperty('calledDecision');
  });

  it('moves a node into a lane and out of it', async () => {
    const { document } = await set('task_plain', { lane: 'Lane_billing' });

    expect(document.tree.require('Lane_billing').list('flowNodeRef')).toContain(document.tree.require('task_plain'));
    expect((await set('task_plain', { lane: '' })).document.tree.require('Lane_sales').list('flowNodeRef')).toEqual([]);
  });

  it('writes a correlation key on the subscription of the message an event waits for', async () => {
    const { document, element } = await set('catch_message', { 'zeebe:correlationKey': '=id' });

    expect(element.attrs).not.toHaveProperty('zeebe:correlationKey');
    expect(document.tree.require('Message_order').get<BpmnElement>('extensionElements').list('values')).toHaveLength(1);
  });

  it('sends the trigger keys of an event to the event, and nested keys to their slot', async () => {
    const { element, details } = await set('catch_timer', { timer: 'PT5M', 'definition.id': 'timer_renamed' });

    expect(element.list<BpmnElement>('eventDefinitions')[0]?.id).toBe('timer_renamed');
    expect(details).toContain('definition.id=timer_renamed');
  });

  it('turns an inline condition into a script resource when condition= is emptied with it', async () => {
    const { element } = await set('flow_juel', { condition: '', 'condition.camunda:resource': 'deployment://new.groovy' });

    expect(conditionOf(element)?.get('body')).toBeUndefined();
    expect(conditionOf(element)?.attrs['camunda:resource']).toBe('deployment://new.groovy');
  });

  it('replaces a script resource with an inline condition in one command', async () => {
    const { element } = await set('flow_script', { 'condition.camunda:resource': '', condition: '${ok}' });

    expect(conditionOf(element)?.attrs).not.toHaveProperty('camunda:resource');
    expect(conditionOf(element)?.get('body')).toBe('${ok}');
  });

  it('replaces the script resource of a conditional event with when= in one command', async () => {
    const { element } = await set('catch_script', { 'condition.camunda:resource': '', when: '${ready}' });
    const condition = element.list<BpmnElement>('eventDefinitions')[0]?.get<BpmnElement>('condition');

    expect(condition?.attrs).not.toHaveProperty('camunda:resource');
    expect(condition?.get('body')).toBe('${ready}');
  });

  it('binds refAs to the message a task sends', async () => {
    expect((await set('task_send', { name: 'Send' }, '$message')).changes.bindings).toEqual([expect.objectContaining({ alias: '$message' })]);
  });

  it.each<[string, string, Record<string, string>, object]>([
    ['an empty id', 'task_plain', { id: '' }, { code: 'E_INVALID_VALUE' }],
    ['a flow that is the default and has a condition', 'flow_other', { default: 'true', condition: '${x}' }, { code: 'E_INVALID_VALUE', message: expect.stringContaining('default=true and condition cannot be combined') }],
    ['a value for default on a flow that is no boolean', 'flow_other', { default: 'maybe', condition: '${x}' }, { code: 'E_INVALID_VALUE' }],
    ['an inline condition next to a script resource', 'flow_juel', { condition: '${x}', 'condition.camunda:resource': 'deployment://new.groovy' }, { code: 'E_INVALID_VALUE', message: expect.stringContaining('either an inline expression') }],
    ['source on a task', 'task_plain', { source: 'start' }, { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('applies to sequence flows') }],
    ['target on a task', 'task_plain', { target: 'start' }, { code: 'E_UNKNOWN_KEY' }],
    ['a flow without an end', 'flow_other', { target: '' }, { code: 'E_INVALID_VALUE', message: expect.stringContaining('a flow always needs a source and a target') }],
    ['an end that is no flow node', 'flow_other', { target: 'Lane_sales' }, { code: 'E_WRONG_KIND' }],
    ['a loop on a gateway', 'gateway_split', { loop: 'standard' }, { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('applies to activities') }],
    ['expanded on a task', 'task_plain', { expanded: 'true' }, { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('applies to sub-processes') }],
    ['a message on a plain task', 'task_plain', { message: 'Order' }, { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('applies to events, send tasks') }],
    ['a decision on a service task', 'task_service', { calledDecision: 'risk' }, { code: 'E_UNKNOWN_KEY' }],
    ['a lane on a flow', 'flow_other', { lane: 'Lane_sales' }, { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('applies to flow nodes') }],
    ['a lane that is no lane', 'task_plain', { lane: 'task_bare' }, { code: 'E_WRONG_KIND' }],
    ['a Camunda attribute of another element', 'task_plain', { 'camunda:collection': 'items' }, { code: 'E_WRONG_HOST' }],
    ['a Zeebe attribute of an extension element', 'task_service', { 'zeebe:retries': '3' }, { code: 'E_WRONG_HOST' }],
    ['a key without a prefix before its colon', 'task_plain', { ':name': 'x' }, { code: 'E_UNKNOWN_KEY', message: expect.stringContaining('vendor attributes look like prefix:name') }],
    ['a trigger key on anything but an event', 'task_plain', { timer: 'PT5M' }, { code: 'E_UNKNOWN_KEY' }],
    ['an element that does not exist', 'nobody', { name: 'x' }, { code: 'E_NOT_FOUND' }],
  ])('refuses %s', async (_case, id, values, refusal) => {
    await expect(set(id, values)).rejects.toMatchObject(refusal);
  });

  describe('an empty message on an event', () => {
    it('keeps the message event definition and drops only its reference', async () => {
      const { element } = await set('catch_message', { message: '' });
      const [definition] = element.get<BpmnElement[]>('eventDefinitions');

      expect(definition!.is('bpmn:MessageEventDefinition')).toBe(true);
      expect(definition!.get('messageRef')).toBeUndefined();
    });

    it('keeps the message while another element still refers to it', async () => {
      const { document } = await set('catch_message', { message: '' });

      expect(document.tree.byId('Message_order')).toBeDefined();
    });
  });

  describe('setTaskMessage', () => {
    async function setMessage(id: string, name: string) {
      const document = await Fixtures.readForWrite('edit/properties-editor.bpmn');
      const element = document.tree.require(id);
      const changes = new ChangeSet();
      new PropertyEditor(new EditSession(document)).setTaskMessage(element, name, changes);
      return { document, element, changes };
    }

    it('links a message the file has, without creating one', async () => {
      const { document, element, changes } = await setMessage('task_receive', 'Order');

      expect(element.get('messageRef')).toBe(document.tree.require('Message_order'));
      expect(changes.created).toEqual([]);
    });

    it('creates the message a name asks for', async () => {
      const { element, changes } = await setMessage('task_receive', 'Invoice');

      expect(element.get<BpmnElement>('messageRef').get('name')).toBe('Invoice');
      expect(changes.created).toEqual([expect.objectContaining({ kind: 'message', name: 'Invoice', detail: 'root element' })]);
    });

    it('unlinks the message with an empty name', async () => {
      expect((await setMessage('task_send', '')).element.get('messageRef')).toBeUndefined();
    });

    it('sets the message of a message flow', async () => {
      const { document } = await setMessage('flow_message', 'Order');

      expect(document.tree.require('flow_message').get('messageRef')).toBe(document.tree.require('Message_order'));
    });
  });
});
