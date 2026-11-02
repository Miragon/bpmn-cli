import { describe, expect, it } from 'vitest';
import { VendorHosts } from '../../../src/edit/properties/VendorHosts.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function hosts(id: string) {
  const document = await Fixtures.readForWrite('edit/properties-hosts.bpmn');
  return { vendor: new VendorHosts(new EditSession(document)), element: document.tree.require(id) };
}

async function assertVendorHost(id: string, key: string, value = 'x') {
  const { vendor, element } = await hosts(id);
  vendor.assertVendorHost(element, key, value);
}

async function assertZeebeHost(id: string, key: string, value = '3') {
  const { vendor, element } = await hosts(id);
  vendor.assertZeebeHost(element, key, value);
}

describe('VendorHosts', () => {
  describe('assertVendorHost', () => {
    it.each([
      ['a key of no Camunda namespace', 'task_user', 'zeebe:modelerTemplate'],
      ['an attribute of the element', 'task_user', 'camunda:assignee'],
      ['an attribute Camunda does not know', 'task_user', 'camunda:nosuch'],
      ['an attribute with no other place on the element', 'task_plain', 'camunda:assignee'],
      ['an attribute no trigger of the event takes', 'throw_none', 'camunda:assignee'],
      ['a process attribute on a pool without a process', 'participant_blackBox', 'camunda:historyTimeToLive'],
      ['a task attribute on a pool', 'participant_process', 'camunda:assignee'],
    ])('lets %s pass', async (_case, id, key) => {
      await expect(assertVendorHost(id, key)).resolves.toBeUndefined();
    });

    it.each([
      ['the event definition of an event', 'catch_message', 'camunda:class', 'bpmn set <file> catch_message definition.camunda:class=x'],
      ['the one fitting definition of two', 'end_mixed', 'camunda:class', "bpmn set <file> end_mixed 'definition[1].camunda:class=x'"],
      ['the condition of a conditional event', 'catch_script', 'camunda:resource', 'bpmn set <file> catch_script condition.camunda:resource=x'],
      ['the condition of a flow', 'flow_plain', 'camunda:resource', 'bpmn set <file> flow_plain condition.camunda:resource=x'],
      ['the loop of an activity', 'task_plain', 'camunda:collection', 'bpmn set <file> task_plain loop.camunda:collection=x'],
    ])('sends a key to %s', async (_case, id, key, command) => {
      await expect(assertVendorHost(id, key)).rejects.toMatchObject({ code: 'E_WRONG_HOST', details: { element: id, hint: expect.stringContaining(command) } });
    });

    it('asks for the trigger whose definition takes the key', async () => {
      await expect(assertVendorHost('throw_none', 'camunda:class')).rejects.toMatchObject({
        code: 'E_WRONG_HOST',
        message: expect.stringContaining('(MessageEventDefinition)'),
        details: { hint: 'Use `bpmn set <file> throw_none trigger=message definition.camunda:class=x` (throw_none needs a message trigger for it).' },
      });
    });

    it('sends a process attribute from a pool to its process', async () => {
      await expect(assertVendorHost('participant_process', 'camunda:historyTimeToLive', '30')).rejects.toMatchObject({
        code: 'E_WRONG_HOST',
        details: { element: 'participant_process', related: ['Process_hosts'], hint: 'Use `bpmn set <file> Process_hosts camunda:historyTimeToLive=30`.' },
      });
    });

    it('quotes a value the shell would split', async () => {
      await expect(assertVendorHost('task_plain', 'camunda:collection', "it's many")).rejects.toMatchObject({ details: { hint: expect.stringContaining("'loop.camunda:collection=it'\\''s many'") } });
    });
  });

  describe('assertZeebeHost', () => {
    it.each([
      ['a key of no Zeebe namespace', 'task_service', 'camunda:class'],
      ['an attribute Zeebe reads on the element', 'task_service', 'zeebe:modelerTemplate'],
      ['an attribute of no Zeebe extension element', 'task_service', 'zeebe:nosuch'],
      ['an attribute of an extension element the element cannot host', 'gateway_split', 'zeebe:retries'],
    ])('lets %s pass', async (_case, id, key) => {
      await expect(assertZeebeHost(id, key)).resolves.toBeUndefined();
    });

    it('sends an attribute to the extension element the task hosts', async () => {
      await expect(assertZeebeHost('task_service', 'zeebe:retries')).rejects.toMatchObject({
        code: 'E_WRONG_HOST',
        message: expect.stringContaining('Camunda 8 reads retries on the zeebe:taskDefinition extension element'),
        details: { hint: 'Use `bpmn ext add <file> task_service zeebe:taskDefinition retries=3`.' },
      });
    });

    it('sends a loop attribute to the loop', async () => {
      await expect(assertZeebeHost('task_plain', 'zeebe:inputCollection')).rejects.toMatchObject({ details: { hint: expect.stringContaining('`bpmn ext add <file> task_plain loop.zeebe:loopCharacteristics inputCollection=3`') } });
    });

    it.each([
      ['a receive task', 'task_receive'],
      ['a message event', 'catch_message'],
    ])('sends a correlation key on %s to its message first', async (_case, id) => {
      await expect(assertZeebeHost(id, 'zeebe:correlationKey')).rejects.toMatchObject({ details: { hint: expect.stringContaining(`bpmn set <file> ${id} message=<MessageName>`) } });
    });

    it('sends a correlation key on an event that waits for no message to a message', async () => {
      await expect(assertZeebeHost('catch_timer', 'zeebe:correlationKey')).rejects.toMatchObject({ details: { hint: expect.stringContaining('on a bpmn:Message (') } });
    });
  });
});
