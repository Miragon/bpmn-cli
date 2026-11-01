import { describe, expect, it } from 'vitest';
import type { BpmnElement } from '../../../src/model/document/BpmnElement.js';
import { DiIdMemo } from '../../../src/model/diagram/DiIdMemo.js';
import { Fixtures } from '../../support/Fixtures.js';

function diElementsOf(definitions: BpmnElement): BpmnElement[] {
  return definitions.list('diagrams').flatMap((diagram) => [diagram, diagram.get<BpmnElement>('plane'), ...diagram.get<BpmnElement>('plane').list('planeElement')]);
}

function renameAllDi(definitions: BpmnElement): void {
  diElementsOf(definitions).forEach((element, index) => element.set('id', `redrawn_${index}`));
}

describe('DiIdMemo', () => {
  it('remembers the DI id of each shape and edge, and the ids of each diagram with its root', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');

    const memo = DiIdMemo.remember(document.tree.definitions);

    expect(memo.shapes).toEqual(new Map([['task_a', 'BPMNShape_task_a'], ['task_b', 'BPMNShape_task_b'], ['task_c', 'Shape_task_c']]));
    expect(memo.edges).toEqual(new Map([['flow_ab', 'line_ab'], ['flow_bc', 'line_bc']]));
    expect(memo.diagrams).toEqual([{ root: 'Process_styles', plane: 'BPMNPlane_Process_styles', diagram: 'BPMNDiagram_Process_styles' }]);
    expect(memo.styles).toEqual({ shape: 'bpmn', edge: 'bpmn' });
  });

  it('keeps the DI id of the first diagram when two diagrams draw the same element', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');

    const memo = DiIdMemo.remember(document.tree.definitions);

    expect(memo.shapes.get('A')).toBe('A_di');
    expect(memo.diagrams.map((entry) => entry.diagram)).toEqual(['D1', 'V2_D1']);
  });

  it('gives a redrawn diagram its former ids back, and numbers what a second view of the same elements draws', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const memo = DiIdMemo.remember(document.tree.definitions);
    renameAllDi(document.tree.definitions);

    memo.restore(document.tree.definitions);

    const [first, second] = document.diagram.planes();
    expect(document.tree.definitions.list('diagrams').map((diagram) => [diagram.id, diagram.get<BpmnElement>('plane').id])).toEqual([['D1', 'PL1'], ['V2_D1', 'V2_PL1']]);
    expect(first!.list('planeElement').map((element) => element.id)).toEqual(['S_di', 'A_di', 'B_di', 'E2_di', 'C_di', 'D_di', 'E_di', 'F1_di', 'F2_di', 'F3_di', 'F4_di', 'F5_di']);
    expect(second!.list('planeElement').map((element) => element.id).slice(0, 2)).toEqual(['S_di_2', 'A_di_2']);
  });

  it('gives a drawing of one view all its former ids back', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const former = diElementsOf(document.tree.definitions).map((element) => element.id);
    const memo = DiIdMemo.remember(document.tree.definitions);
    renameAllDi(document.tree.definitions);

    memo.restore(document.tree.definitions);

    expect(diElementsOf(document.tree.definitions).map((element) => element.id)).toEqual(former);
  });

  it('names the shape of a new element in the style of the file, and numbers a shape whose old id another one holds', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const { tree } = document;
    const memo = DiIdMemo.remember(tree.definitions);
    const newTask = tree.create('bpmn:Task', { id: 'task_d' });
    tree.require('Process_styles').add('flowElements', newTask);
    const plane = document.diagram.planes()[0]!;
    const shape = tree.build('bpmndi:BPMNShape', { id: 'drawn_d' });
    shape.set('bpmnElement', newTask);
    plane.add('planeElement', shape);
    const twin = tree.build('bpmndi:BPMNShape', { id: 'drawn_twin' });
    twin.set('bpmnElement', tree.require('task_a'));
    plane.add('planeElement', twin);

    memo.restore(tree.definitions);

    expect([shape.id, twin.id]).toEqual(['BPMNShape_task_d', 'BPMNShape_task_a_2']);
  });

  it('leaves a plane element that draws no element as it is', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const { tree } = document;
    const memo = DiIdMemo.remember(tree.definitions);
    const stray = tree.build('bpmndi:BPMNShape', { id: 'stray_di' });
    document.diagram.planes()[0]!.add('planeElement', stray);

    memo.restore(tree.definitions);

    expect(stray.id).toBe('stray_di');
  });

  it('lets the main diagram keep its ids when its root changed, unless they were derived from the old root', async () => {
    const document = await Fixtures.read('models/incremental/pool.bpmn');
    const { tree } = document;
    const memo = DiIdMemo.remember(tree.definitions);
    const plane = document.diagram.planes()[0]!;
    plane.set('bpmnElement', tree.require('P1'));
    renameAllDi(tree.definitions);

    memo.restore(tree.definitions);

    expect([plane.id, plane.parent?.id]).toEqual(['PL1', 'D1']);
  });

  it('gives a plane and diagram id derived from the old root the form of the new root', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const { tree } = document;
    const memo = DiIdMemo.remember(tree.definitions);
    const plane = document.diagram.planes()[0]!;
    const other = tree.create('bpmn:Process', { id: 'Process_other' });
    tree.definitions.add('rootElements', other);
    plane.set('bpmnElement', other);
    renameAllDi(tree.definitions);

    memo.restore(tree.definitions);

    expect([plane.id, plane.parent?.id]).toEqual(['BPMNPlane_Process_other', 'BPMNDiagram_Process_other']);
  });
});
