import { describe, expect, it } from 'vitest';
import { FlowOrder } from '../../../src/checks/structure/FlowOrder.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FlowOrder', () => {
  const orderOf = async (path: string, scopeId = 'P') => {
    const document = await Fixtures.read(path);
    return { document, order: new FlowOrder(document, document.tree.require(scopeId)) };
  };

  it('follows the flows from the start event, a boundary event after its host', async () => {
    const { order } = await orderOf('engine/structure/cancel-boundary-on-a-task.bpmn');

    expect(order.ordered.map(({ id }) => id)).toEqual(['Start', 'T', 'End']);
    expect(order.unreachable.size).toBe(0);
  });

  it('holds a catching link event without a throw as unreachable', async () => {
    const { order } = await orderOf('engine/structure/link-catch-without-a-throw.bpmn');

    expect([...order.unreachable].map(({ id }) => id)).toEqual(['L']);
  });

  it('holds no node of an ad-hoc sub-process as unreachable', async () => {
    const { order } = await orderOf('engine/structure/empty-ad-hoc-sub-process.bpmn', 'Ad');

    expect(order.ordered.map(({ id }) => id)).toEqual(['A', 'B']);
    expect(order.unreachable.size).toBe(0);
  });

  it('reads the link name of a link event', async () => {
    const { document } = await orderOf('engine/structure/link-catch-without-a-throw.bpmn');

    expect(FlowOrder.linkNameOf(document.tree.require('L'))).toBe('Jump');
    expect(FlowOrder.linkNameOf(document.tree.require('Start'))).toBeUndefined();
  });
});
