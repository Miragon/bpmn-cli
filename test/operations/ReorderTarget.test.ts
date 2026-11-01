import { describe, expect, it } from 'vitest';
import type { OrderOperation } from '../../src/operations/model/OrderOperationDefinition.js';
import { ReorderTarget } from '../../src/operations/ReorderTarget.js';
import { Fixtures } from '../support/Fixtures.js';

const targetOf = async (fields: Omit<OrderOperation, 'op'>): Promise<ReorderTarget> => new ReorderTarget(await Fixtures.read('layout/agent__onb.bpmn'), { op: 'order', ...fields });

describe('ReorderTarget', () => {
  it.each<[string, Omit<OrderOperation, 'op'>, boolean, boolean]>([
    ['lanes named as lanes', { id: 'Participant_HR', lanes: ['Lane_HRAdmin'] }, true, false],
    ['pools named as pools', { id: 'Collaboration_1', pools: ['Participant_HR'] }, false, true],
    ['lane ids given as flows', { id: 'Participant_HR', flows: ['Lane_HRAdmin'] }, true, false],
    ['participant ids given as flows', { id: 'Activity_ReceiveFeedback', flows: ['Participant_HR'] }, false, true],
    ['a collaboration whatever the list says', { id: 'Collaboration_1', flows: ['Flow_14'] }, false, true],
    ['the outgoing flows of a node', { id: 'Activity_ReceiveFeedback', flows: ['Flow_14'] }, false, false],
  ])('tells what %s order', async (_case, fields, lanes, pools) => {
    const target = await targetOf(fields);
    expect(target.ordersLanes()).toBe(lanes);
    expect(target.ordersPools()).toBe(pools);
    expect(target.ordersBands()).toBe(lanes || pools);
  });
});
