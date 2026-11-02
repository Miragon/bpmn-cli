import { describe, expect, it } from 'vitest';
import { EventGatewayRule } from '../../../src/edit/events/EventGatewayRule.js';
import { FlowConnector } from '../../../src/edit/FlowConnector.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

async function ruling(platform: 'c7' | 'c8' | 'none') {
  const document = await Fixtures.readForWrite('edit/events-gateway.bpmn');
  const session = new EditSession(document, platform);
  return { document, session, rule: new EventGatewayRule(session) };
}

async function problem(platform: 'c7' | 'c8', gateway: string, target: string, leaving: string[] = []) {
  const { document, rule } = await ruling(platform);
  return rule.targetProblem(document.tree.require(gateway), document.tree.require(target), leaving.map((id) => document.tree.require(id)));
}

describe('EventGatewayRule', () => {
  it('holds Camunda 7 to what its engine takes and the others to BPMN 2.0', async () => {
    expect((await ruling('c7')).rule.rule).toBe('engines');
    expect((await ruling('c8')).rule.rule).toBe('bpmn');
    expect((await ruling('none')).rule.rule).toBe('bpmn');
  });

  it.each([
    ['a task', 'loose_task', 'is not an intermediate catch event'],
    ['a plain catch event', 'loose_plain', 'is a plain catch event'],
    ['a link catch event', 'loose_link', 'is a link catch event'],
    ['a catch event with another incoming flow', 'catch_joined', 'already has the incoming flow flow_toJoined; a catch event after an event-based gateway can have no other incoming flow'],
    ['a second wait for the same message', 'loose_paid', 'catch_paid on another branch of gateway_wait already waits for the message "Paid"'],
    ['a second wait for the same signal', 'loose_stop', 'catch_stop on another branch of gateway_wait already waits for the signal "Stop"'],
  ])('tells Camunda 7 that the gateway cannot lead to %s', async (_case, target, text) => {
    expect(await problem('c7', 'gateway_wait', target)).toContain(text);
  });

  it.each([
    ['a catch event for another message', 'loose_other'],
    ['a message catch event that names no message', 'loose_unnamed'],
    ['a timer catch event on a branch of its own', 'catch_timer'],
  ])('lets Camunda 7 lead the gateway to %s', async (_case, target) => {
    expect(await problem('c7', 'gateway_wait', target, target === 'catch_timer' ? ['flow_toTimer'] : [])).toBeUndefined();
  });

  it('forgets the flows that are about to leave', async () => {
    expect(await problem('c7', 'gateway_wait', 'catch_joined', ['flow_toJoined'])).toBeUndefined();
    expect(await problem('c7', 'gateway_wait', 'loose_paid', ['flow_toPaid'])).toBeUndefined();
  });

  it.each([
    ['a task', 'gateway_wait', 'loose_task', 'is neither an intermediate catch event nor a receive task'],
    ['a plain catch event', 'gateway_wait', 'loose_plain', 'is a plain catch event'],
    ['a link catch event', 'gateway_wait', 'loose_link', 'is a link catch event'],
    ['a catch event with another incoming flow', 'gateway_wait', 'catch_joined', 'a catch event after an event-based gateway can have no other incoming flow'],
    ['a receive task with a boundary event', 'gateway_wait', 'held_receive', 'has boundary events (boundary_held)'],
    ['a receive task beside a message catch event', 'gateway_wait', 'loose_receive', 'catch_paid on another branch of gateway_wait is a message catch event'],
    ['a message catch event beside a receive task', 'gateway_receiving', 'loose_other', 'branch_receive on another branch of gateway_receiving is a receive task'],
  ])('tells BPMN 2.0 models that the gateway cannot lead to %s', async (_case, gateway, target, text) => {
    expect(await problem('c8', gateway, target)).toContain(text);
  });

  it('lets a BPMN 2.0 gateway lead to a timer beside a receive task, and to a receive task beside timers', async () => {
    expect(await problem('c8', 'gateway_receiving', 'catch_timer')).toContain('already has the incoming flow');
    expect(await problem('c8', 'gateway_receiving', 'catch_timer', ['flow_toTimer'])).toBeUndefined();
    expect(await problem('c8', 'gateway_receiving', 'loose_receive', ['flow_toReceive'])).toBeUndefined();
  });

  it('warns about a flow that leads a gateway where BPMN 2.0 forbids it', async () => {
    const { document, rule } = await ruling('c8');
    const changes = new ChangeSet();

    rule.warnFlow(document.tree.require('flow_toTask'), changes);

    expect(changes.warnings[0]).toMatchObject({ code: 'W_EVENT_GATEWAY_TARGET', element: 'gateway_receiving', related: ['branch_task', 'flow_toTask'] });
  });

  it('stays silent about a good flow, a flow out of a task, and every flow on Camunda 7', async () => {
    const bpmn = await ruling('c8');
    const engines = await ruling('c7');
    const changes = new ChangeSet();

    bpmn.rule.warnFlow(bpmn.document.tree.require('flow_toLater'), changes);
    bpmn.rule.warnFlow(bpmn.document.tree.require('flow_toWait'), changes);
    engines.rule.warnFlow(engines.document.tree.require('flow_toTask'), changes);

    expect(changes.warnings).toEqual([]);
  });

  it.each(['c7', 'c8', 'none'] as const)('keeps a single incoming flow on a target of an event-based gateway on %s', async (platform) => {
    const { document, session } = await ruling(platform);
    const before = document.tree.require('catch_paid').list('incoming').length;
    const connecting = new FlowConnector(session);

    expect(() => connecting.connect({ op: 'connect', source: 'task_before', target: 'catch_paid' })).toThrow(expect.objectContaining({ code: 'E_INVALID_TARGET', message: expect.stringContaining('catch_paid follows event-based gateway gateway_wait') }));
    expect(() => connecting.connect({ op: 'connect', source: 'gateway_wait', target: 'catch_joined' })).toThrow(expect.objectContaining({ code: 'E_INVALID_TARGET' }));
    expect(document.tree.require('catch_paid').list('incoming')).toHaveLength(before);
  });
});
