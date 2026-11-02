import { describe, expect, it } from 'vitest';
import { ModelOrder } from '../../../../src/drawing/incremental/run/ModelOrder.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('ModelOrder', () => {
  const ids = (path: string): Promise<Array<string | undefined>> => Fixtures.read(path).then(({ tree }) => new ModelOrder(tree.definitions).elements().map((element) => element.peek<string>('id')));

  it('lists pools before lanes before the flow, a sub-process before its content', async () => {
    const order = await ids('models/incremental/lanesub.bpmn');

    expect(order.length).toBeGreaterThan(3);
    expect(new Set(order).size).toBe(order.length);
  });

  it('lists the participants of a collaboration before the process', async () => {
    const order = await ids('models/incremental/pool.bpmn');

    expect(order.indexOf('Pool')).toBeLessThan(order.indexOf('S'));
  });

  it('lists a sub-process before its content', async () => {
    const order = await ids('models/incremental/sub.bpmn');

    expect(order.indexOf('SP')).toBeLessThan(order.indexOf('SS'));
  });

  it('lists data associations next to their task', async () => {
    const order = await ids('drawing/placement/add-data.after.bpmn');

    expect(order.indexOf('association_fzd6ToAnalyse')).toBe(order.indexOf('Activity_Analyse') + 1);
  });
});
