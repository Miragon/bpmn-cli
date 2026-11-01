import { describe, expect, it } from 'vitest';
import { ElementOrder } from '../../src/edit/ElementOrder.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import type { OrderOperation } from '../../src/operations/index.js';
import { Fixtures } from '../support/Fixtures.js';

async function order(path: string, operation: Omit<OrderOperation, 'op'>) {
  const document = await Fixtures.readForWrite(path);
  const changes = new ElementOrder(new EditSession(document)).reorder({ op: 'order', ...operation });
  const ids = (id: string, list: string): string[] => document.tree.require(id).list(list).map((element) => element.id);
  return { document, changes, ids };
}

describe('ElementOrder', () => {
  it('rewrites the outgoing flows of a gateway and declares them behind it in that order', async () => {
    const { changes, ids } = await order('edit/shop-full.bpmn', { id: 'Gw', flows: ['F_no'] });

    expect(ids('Gw', 'outgoing')).toEqual(['F_no', 'F_yes']);
    const declared = ids('Process_1', 'flowElements');
    expect(declared.slice(declared.indexOf('Gw'), declared.indexOf('Gw') + 3)).toEqual(['Gw', 'F_no', 'F_yes']);
    expect(changes.changed[0]).toMatchObject({ id: 'Gw', kind: 'exclusiveGateway', detail: 'outgoing order: F_no, F_yes' });
  });

  it('moves flows declared before their gateway behind it', async () => {
    const { ids } = await order('edit/out-of-order-flows.bpmn', { id: 'gateway', flows: ['flow_toB', 'flow_toA'] });

    expect(ids('Process_order', 'flowElements')).toEqual(['gateway', 'flow_toB', 'flow_toA', 'taskA', 'taskB']);
  });

  it('notes outgoing flows that already are in the order asked for', async () => {
    const { changes } = await order('edit/shop-full.bpmn', { id: 'Gw', flows: ['F_yes', 'F_no'] });

    expect(changes.notes).toEqual(['Gw: outgoing flows already in this order']);
    expect(changes.changed).toEqual([]);
  });

  it.each([
    ['a flow out of another node', { id: 'Gw', flows: ['F1'] }, 'E_NOT_OUTGOING'],
    ['a flow listed twice', { id: 'Gw', flows: ['F_no', 'F_no'] }, 'E_USAGE'],
    ['a node without flows listed', { id: 'Gw' }, 'E_USAGE'],
    ['a flow in the place of the node', { id: 'F1', flows: ['F1'] }, 'E_WRONG_KIND'],
  ])('refuses %s', async (_case, operation, code) => {
    await expect(order('edit/shop-full.bpmn', operation)).rejects.toMatchObject({ code });
  });

  it('puts the pools listed first and keeps the others behind them, in their old order', async () => {
    const { changes, ids } = await order('edit/two-pools.bpmn', { id: 'Collaboration_shop', pools: ['participant_bank'] });

    expect(ids('Collaboration_shop', 'participants')).toEqual(['participant_bank', 'participant_customer', 'participant_shop']);
    expect(changes.changed[0]?.detail).toBe('pool order: participant_bank, participant_customer, participant_shop');
  });

  it('notes pools that already are in the order asked for', async () => {
    const { changes } = await order('edit/two-pools.bpmn', { id: 'Collaboration_shop', flows: ['participant_customer'] });

    expect(changes.notes).toEqual(['Collaboration_shop: pools already declared in this order (the drawing follows it)']);
  });

  it.each([
    ['a collaboration without pools listed', { id: 'Collaboration_shop' }, 'E_USAGE'],
    ['a pool listed twice', { id: 'Collaboration_shop', pools: ['participant_bank', 'participant_bank'] }, 'E_USAGE'],
    ['a lane in the place of a pool', { id: 'Collaboration_shop', pools: ['lane_sales'] }, 'E_WRONG_KIND'],
  ])('refuses %s', async (_case, operation, code) => {
    await expect(order('edit/two-pools.bpmn', operation)).rejects.toMatchObject({ code });
  });

  it('refuses a pool of another collaboration and lists the pools it has', async () => {
    await expect(order('model/operaton.bpmn', { id: 'Collaboration_shop', pools: ['participant_bank'] })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('orders the lanes of a pool, top to bottom', async () => {
    const { changes, ids } = await order('edit/two-pools.bpmn', { id: 'participant_shop', lanes: ['lane_stock'] });

    expect(ids('LaneSet_shop', 'lanes')).toEqual(['lane_stock', 'lane_sales']);
    expect(changes.changed[0]).toMatchObject({ id: 'participant_shop', detail: 'lane order: lane_stock, lane_sales' });
  });

  it('notes lanes that already are in the order asked for', async () => {
    const { changes } = await order('edit/two-pools.bpmn', { id: 'Process_shop', flows: ['lane_sales', 'lane_stock'] });

    expect(changes.notes).toEqual(['Process_shop: lanes already in this order']);
  });

  it('refuses a lane listed twice', async () => {
    await expect(order('edit/two-pools.bpmn', { id: 'Process_shop', lanes: ['lane_stock', 'lane_stock'] })).rejects.toMatchObject({ code: 'E_USAGE' });
  });

  it('refuses a lane of another owner and says a process without lanes has none', async () => {
    await expect(order('edit/two-pools.bpmn', { id: 'Process_customer', lanes: ['lane_stock'] })).rejects.toMatchObject({
      code: 'E_NOT_CHILD_LANE',
      details: { candidates: [], hint: expect.stringContaining('has no lanes') },
    });
  });
});
