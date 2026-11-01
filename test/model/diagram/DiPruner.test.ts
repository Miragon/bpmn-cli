import { describe, expect, it } from 'vitest';
import { DiPruner } from '../../../src/model/diagram/DiPruner.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DiPruner', () => {
  it('removes the shape of an element that is gone from every diagram and reports its id', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const process = document.tree.require('P1');
    process.remove('flowElements', document.tree.require('E2'));
    document.tree.invalidate();

    const pruned = DiPruner.prune(document.tree.definitions, document.tree.all());

    const remaining = document.diagram.planes().flatMap((plane) => plane.list('planeElement').map((element) => element.id));
    expect(pruned).toEqual(['E2', 'E2']);
    expect(remaining).not.toContain('E2_di');
    expect(remaining).not.toContain('V2_E2_di');
    expect(remaining).toHaveLength(22);
  });

  it('removes a shape that draws no element, named by its own id or by a question mark, and a diagram without a plane', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const { tree } = document;
    const plane = document.diagram.planes()[0]!;
    plane.add('planeElement', tree.build('bpmndi:BPMNShape', { id: 'orphan_di' }), tree.build('bpmndi:BPMNShape'));
    tree.definitions.add('diagrams', tree.build('bpmndi:BPMNDiagram', { id: 'empty_diagram' }));

    const pruned = DiPruner.prune(tree.definitions, tree.all());

    expect(pruned).toEqual(['orphan_di', DiPruner.UNKNOWN_ID]);
    expect(tree.definitions.list('diagrams').map((diagram) => diagram.id)).toEqual(['D1', 'V2_D1']);
  });

  it('removes a diagram whose root is gone, with its shapes unreported', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    document.tree.definitions.remove('rootElements', document.tree.require('P1'));
    document.tree.invalidate();

    const pruned = DiPruner.prune(document.tree.definitions, document.tree.all());

    expect([pruned, document.tree.definitions.list('diagrams')]).toEqual([[], []]);
  });

  it('keeps a plane without a root, which shows the first process, and prunes nothing from a whole diagram', async () => {
    const document = await Fixtures.read('models/incremental/noroot.bpmn');

    expect(DiPruner.prune(document.tree.definitions, document.tree.all())).toEqual([]);
    expect(document.diagram.planes()).toHaveLength(1);
  });

  it('removes the edges the caller calls stale and reports the ids of their flows in document order', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');

    const pruned = DiPruner.pruneEdges(document.tree.definitions, (edge) => ['F3_di', 'V2_F1_di'].includes(edge.id));

    expect(pruned).toEqual(['F3', 'F1']);
    expect(document.diagram.planes().map((plane) => plane.list('planeElement').filter((element) => element.is('bpmndi:BPMNEdge')).length)).toEqual([4, 4]);
  });

  it('tells the stale check which diagram shows a root an earlier diagram already shows', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');

    const pruned = DiPruner.pruneEdges(document.tree.definitions, (_edge, _plane, further) => further);

    expect(pruned).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(document.diagram.planes().map((plane) => plane.list('planeElement').some((element) => element.is('bpmndi:BPMNEdge')))).toEqual([true, false]);
  });
});
