import { describe, expect, it } from 'vitest';
import { FlowAliases } from '../../../src/edit/containers/FlowAliases.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import type { AddOperation } from '../../../src/operations/index.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

function addOperation(placement: object): AddOperation {
  return Fixtures.operations([{ op: 'add', kind: 'task', name: 'Review', ...placement }]).model[0] as AddOperation;
}

async function setUp() {
  const session = new EditSession(await Fixtures.readForWrite('edit/order-check.bpmn'));
  return { session, aliases: new FlowAliases(session), changes: new ChangeSet() };
}

function bound(changes: ChangeSet) {
  return changes.bindings.map(({ alias, el }) => [alias, el.id]);
}

describe('FlowAliases', () => {
  it('names the flow a placement led into the new node', async () => {
    const { session, aliases, changes } = await setUp();

    aliases.bindFlowAs(addOperation({ flowAs: '$in', after: 'check' }), session.require('ship'), session.require('flow_okToShip'), changes);

    expect(bound(changes)).toEqual([['$in', 'flow_okToShip']]);
  });

  it('names the flow out of a node prepended before another', async () => {
    const { session, aliases, changes } = await setUp();

    aliases.bindFlowAs(addOperation({ flowAs: '$in', before: 'startEvent_orderReceived' }), session.require('startEvent_orderReceived'), undefined, changes);

    expect(bound(changes)).toEqual([['$in', 'flow_receivedToCheck']]);
  });

  it('binds nothing for an add that names no flow alias', async () => {
    const { session, aliases, changes } = await setUp();
    const ship = session.require('ship');

    aliases.bindFlowAs(addOperation({}), ship, ship.list('outgoing')[0], changes);
    aliases.bindOutAs(addOperation({}), ship, changes);

    expect(changes.bindings).toEqual([]);
  });

  it('names the one flow out of a node a splice created', async () => {
    const { session, aliases, changes } = await setUp();

    aliases.bindOutAs(addOperation({ outAs: '$out', after: 'check' }), session.require('ship'), changes);

    expect(bound(changes)).toEqual([['$out', 'flow_shipToJoin']]);
  });

  it('refuses outAs on a node appended after the end of a path', async () => {
    const { session, aliases, changes } = await setUp();

    expect(() => aliases.bindOutAs(addOperation({ outAs: '$out', after: 'endEvent_done' }), session.require('endEvent_done'), changes)).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining('(--after endEvent_done appends it)') }));
  });

  it('refuses outAs when two flows leave the node and names them', async () => {
    const { session, aliases, changes } = await setUp();

    expect(() => aliases.bindOutAs(addOperation({ outAs: '$out', to: 'ship' }), session.require('gateway_ok'), changes)).toThrow(expect.objectContaining({ code: 'E_USAGE', details: expect.objectContaining({ related: ['flow_okToShip', 'flow_okToReject'] }) }));
  });

  it('names the only flow out of an existing node', async () => {
    const { session, aliases, changes } = await setUp();

    aliases.bindExistingOutAs('$out', session.require('check'), changes);

    expect(bound(changes)).toEqual([['$out', 'flow_checkToOk']]);
  });

  it('refuses outAs on an existing node with two flows out, none, or no flow node', async () => {
    const { session, aliases, changes } = await setUp();
    const refusal = (id: string) => {
      try {
        aliases.bindExistingOutAs('$out', session.require(id), changes);
      } catch (error) {
        return error as Error & { details: { candidates?: string[] } };
      }
      throw new Error(`no refusal for ${id}`);
    };

    expect(refusal('gateway_ok').message).toContain('has 2 flows out of it (flow_okToShip, flow_okToReject)');
    expect(refusal('gateway_ok').details.candidates).toEqual(['flow_okToShip', 'flow_okToReject']);
    expect(refusal('endEvent_done').message).toContain('has no flow out of it');
    expect(refusal('endEvent_done').details.candidates).toBeUndefined();
    expect(refusal('flow_okToShip').message).toContain('no flow node');
  });
});
