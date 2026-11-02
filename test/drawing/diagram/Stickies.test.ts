import { describe, expect, it } from 'vitest';
import { Stickies } from '../../../src/drawing/diagram/Stickies.js';
import { type BpmnElement, DocumentWriter } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Stickies', () => {
  it('anchors each placed sticky to the nearest flow node', async () => {
    const document = await Fixtures.read('drawing/stickies.bpmn');

    const anchors = new Stickies(document.tree.definitions).anchors();

    expect(anchors.map(({ node, stickyId, index }) => [node.id, stickyId, index])).toEqual([['task', 'sticky_near_task', 0], ['next', undefined, 1]]);
  });

  it('has no anchor without a sticky or without a shape', async () => {
    const plain = await Fixtures.read('models/incremental/boundary.bpmn');
    const undrawn = await Fixtures.read('drawing/stickies.bpmn');
    undrawn.tree.definitions.set('diagrams', []);

    expect(new Stickies(plain.tree.definitions).anchors()).toEqual([]);
    expect(new Stickies(undrawn.tree.definitions).anchors()).toEqual([]);
  });

  it('moves a sticky by the shift of its node and writes it to the file', async () => {
    const document = await Fixtures.read('drawing/stickies.bpmn');
    const stickies = new Stickies(document.tree.definitions);
    const [anchor] = stickies.anchors();
    const task = document.diagram.planes()[0]!.list('planeElement').find((element) => element.peek<BpmnElement>('bpmnElement')?.id === 'task')!;
    task.peek<BpmnElement>('bounds')!.set('x', 130);

    const moved = stickies.follow([{ processId: 'process', index: 0, stickyId: anchor!.stickyId!, nodeId: 'task', centre: anchor!.centre }]);

    expect(moved).toEqual([{ sticky: 'sticky_near_task', node: 'task' }]);
    expect(await new DocumentWriter().plain(document)).toContain('x="180"');
  });

  it('names a sticky without id by its place in the process', async () => {
    const document = await Fixtures.read('drawing/stickies.bpmn');
    const stickies = new Stickies(document.tree.definitions);
    const anchor = stickies.anchors()[1]!;
    const next = document.diagram.planes()[0]!.list('planeElement').find((element) => element.peek<BpmnElement>('bpmnElement')?.id === 'next')!;
    next.peek<BpmnElement>('bounds')!.set('y', 150);

    expect(stickies.follow([{ processId: 'process', index: 1, nodeId: 'next', centre: anchor.centre }])).toEqual([{ sticky: 'process#1', node: 'next' }]);
  });

  it('leaves a sticky alone when its node did not move or is gone', async () => {
    const document = await Fixtures.read('drawing/stickies.bpmn');
    const stickies = new Stickies(document.tree.definitions);
    const anchor = stickies.anchors()[0]!;

    expect(stickies.follow([])).toEqual([]);
    expect(stickies.follow([{ processId: 'process', index: 0, nodeId: 'task', centre: anchor.centre }])).toEqual([]);
    expect(stickies.follow([{ processId: 'process', index: 0, nodeId: 'gone', centre: anchor.centre }])).toEqual([]);
  });
});
