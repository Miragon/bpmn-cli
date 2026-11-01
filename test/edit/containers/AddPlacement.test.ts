import { describe, expect, it } from 'vitest';
import { AddPlacement } from '../../../src/edit/containers/AddPlacement.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import type { AddOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

const ORDER = 'edit/order-check.bpmn';
const LANES = 'edit/containers-lanes.bpmn';

function addOperation(placement: object): AddOperation {
  return Fixtures.operations([{ op: 'add', kind: 'task', name: 'Review', ...placement }]).model[0] as AddOperation;
}

async function placementOn(path: string, placement: object): Promise<AddPlacement> {
  return new AddPlacement(new EditSession(await Fixtures.readForWrite(path)), addOperation(placement));
}

describe('AddPlacement', () => {
  it('refuses a placement the kind does not take and lists those it does', () => {
    expect(() => AddPlacement.reject(addOperation({ after: 'check' }), ['in', 'to'], 'lane')).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT', details: expect.objectContaining({ hint: 'lane accepts --in, --to only.' }) }));
  });

  it('tells that a pool takes no placement at all', () => {
    expect(() => AddPlacement.reject(addOperation({ in: 'Process_orderCheck' }), [], 'participant')).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: 'participant takes no placement options.' }) }));
    expect(() => AddPlacement.reject(addOperation({}), [], 'participant')).not.toThrow();
  });

  it.each([
    ['after', { after: 'check' }, 'After check'],
    ['between', { after: 'check', before: 'gateway_ok' }, 'After check'],
    ['before', { before: 'ship' }, 'Before ship'],
    ['flow', { flow: 'flow_checkToOk' }, 'After check'],
    ['on', { on: 'ship' }, 'On ship'],
  ])('reads the id context of a node placed %s from its anchor', async (_mode, placement, context) => {
    const anchorContext = (await placementOn(ORDER, placement)).context();

    expect(anchorContext?.context).toBe(context);
  });

  it('keeps the bare word when the anchor a batch names does not exist', async () => {
    expect((await placementOn(ORDER, { after: 'nobody' })).context()).toEqual({ context: 'After' });
    expect((await placementOn(ORDER, { flow: 'nobody' })).context()).toBeUndefined();
  });

  it('names a scope only for a sub-process or in a file of several processes', async () => {
    expect((await placementOn('edit/sub-process.bpmn', { in: 'Sub' })).context()?.context).toBe('In Sub');
    expect((await placementOn('edit/sub-process.bpmn', { in: 'Process_sub' })).context()).toBeUndefined();
    expect((await placementOn(LANES, { in: 'Process_other' })).context()).toBeDefined();
    expect((await placementOn(ORDER, {})).context()).toBeUndefined();
    expect((await placementOn(ORDER, { in: 'nobody' })).context()).toBeUndefined();
  });

  it.each([
    [{ after: 'check', before: 'gateway_ok' }, 'between check and gateway_ok'],
    [{ after: 'check' }, 'after check'],
    [{ before: 'ship' }, 'before ship'],
    [{ flow: 'flow_checkToOk' }, 'in flow flow_checkToOk'],
    [{ on: 'ship' }, 'on ship'],
    [{}, 'in Process_orderCheck'],
  ])('reports where %j put the node', async (placement, detail) => {
    expect((await placementOn(ORDER, placement)).detail()).toBe(detail);
  });
});
