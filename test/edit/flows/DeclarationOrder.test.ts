import { describe, expect, it } from 'vitest';
import { DeclarationOrder } from '../../../src/edit/flows/DeclarationOrder.js';
import { Fixtures } from '../../support/Fixtures.js';

async function line() {
  const document = await Fixtures.readForWrite('edit/flows-line.bpmn');
  const process = document.tree.processes()[0]!;
  const ids = () => process.list('flowElements').map((element) => element.id);
  return { process, ids, order: new DeclarationOrder(process), element: (id: string) => document.tree.require(id) };
}

describe('DeclarationOrder', () => {
  it('declares a task right behind the element it follows, not where it stood', async () => {
    const { ids, order, element } = await line();

    order.insertAfter(element('startEvent_start'), element('task_c'));

    expect(ids().slice(0, 3)).toEqual(['startEvent_start', 'task_c', 'task_a']);
  });

  it('declares a task right before the element it precedes', async () => {
    const { ids, order, element } = await line();

    order.insertBefore(element('task_a'), element('endEvent_done'));

    expect(ids().indexOf('endEvent_done')).toBe(ids().indexOf('task_a') - 1);
  });

  it('declares a task last when there is no anchor in the scope', async () => {
    const { ids, order, element } = await line();

    order.insertAfter(undefined, element('task_a'));
    expect(ids().at(-1)).toBe('task_a');

    order.insertBefore(undefined, element('task_b'));
    expect(ids().at(-1)).toBe('task_b');
  });

  it('finds the flow declared last among those leaving a node', async () => {
    const { order, element } = await line();

    expect(order.lastFlowOf(element('task_a'))?.id).toBe('flow_aToB');
    expect(order.lastFlowOf(element('endEvent_done'))).toBeUndefined();
  });
});
