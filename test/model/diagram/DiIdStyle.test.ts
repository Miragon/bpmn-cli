import { describe, expect, it } from 'vitest';
import { DiIdStyle, type IdClaims } from '../../../src/model/diagram/DiIdStyle.js';
import { Fixtures } from '../../support/Fixtures.js';

function claimsOver(taken: Set<string>): IdClaims {
  return { has: (id) => taken.has(id), claim: (id) => void taken.add(id), release: (id) => void taken.delete(id) };
}

describe('DiIdStyle', () => {
  it('lists every id of the file, the semantic ones and those of the diagram', async () => {
    const ids = DiIdStyle.allIds((await Fixtures.read('model/events.bpmn')).tree.definitions);

    expect(ids.has('task_review')).toBe(true);
    expect(ids.has('task_review_di')).toBe(true);
    expect(ids.has('BPMNPlane_1')).toBe(true);
    expect(ids.has('timer_cycle')).toBe(true);
  });

  it('takes the style most shapes follow, and lets edges without a style of their own follow the shapes', async () => {
    const suffixed = DiIdStyle.stylesOf((await Fixtures.read('model/events.bpmn')).tree.definitions);
    const bpmnShapes = DiIdStyle.stylesOf((await Fixtures.read('model/di-styles.bpmn')).tree.definitions);
    const undrawn = DiIdStyle.stylesOf((await Fixtures.read('model/c8-vendor.bpmn')).tree.definitions);

    expect(suffixed).toEqual({ shape: 'suffix', edge: 'suffix' });
    expect(bpmnShapes).toEqual({ shape: 'bpmn', edge: 'bpmn' });
    expect(undrawn).toEqual({ shape: undefined, edge: undefined });
  });

  it.each([
    ['suffix', 'Shape', 'task_a', 'task_a_di'],
    ['bpmn', 'Shape', 'task_a', 'BPMNShape_task_a'],
    ['short', 'Edge', 'flow_ab', 'Edge_flow_ab'],
    ['bpmn', 'Shape', 'Activity_ApproveTheIncomingSupplierInvoiceForPaymentInTheLedger', 'BPMNShape_Activity_ApproveTheIncomingSupplierInvoiceFor'],
    ['suffix', 'Shape', 'Activity_ApproveTheIncomingSupplierInvoiceForPaymentInTheLedger', 'Activity_ApproveTheIncomingSupplierInvoiceForPaymentInThe_di'],
  ] as const)('writes the %s style of a %s id %s as %s, cutting a long id at a word', (style, kind, id, expected) => {
    expect(DiIdStyle.styledId(style, kind, id)).toBe(expected);
  });

  it('derives plane and diagram ids from the root, cut to leave room for a collision suffix', () => {
    const longProcess = 'Process_SupplierInvoicesOfTheAccountsPayableDepartment';

    expect(DiIdStyle.rootDiId('Plane', 'Process_1')).toBe('BPMNPlane_Process_1');
    expect(DiIdStyle.rootDiId('Diagram', longProcess)).toBe('BPMNDiagram_Process_SupplierInvoicesOfTheAccountsPayable');
  });

  it('tells whether a plane or diagram id was derived from the root, in full or cut', () => {
    const longProcess = 'Process_SupplierInvoicesOfTheAccountsPayableDepartment';

    expect(DiIdStyle.namesRoot('Plane', 'BPMNPlane_Process_1', 'Process_1')).toBe(true);
    expect(DiIdStyle.namesRoot('Plane', 'BPMNPlane_Process_SupplierInvoicesOfTheAccountsPayable', longProcess)).toBe(true);
    expect(DiIdStyle.namesRoot('Plane', 'BPMNPlane_1', 'Process_1')).toBe(false);
    expect(DiIdStyle.namesRoot('Diagram', 'BPMNPlane_Process_1', 'Process_1')).toBe(false);
  });

  it('classifies a plane element as a shape, an edge or neither', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const plane = document.diagram.planes()[0]!;
    const [shape, , , edge] = plane.list('planeElement');

    expect([DiIdStyle.kindOf(shape!), DiIdStyle.kindOf(edge!), DiIdStyle.kindOf(plane)]).toEqual(['Shape', 'Edge', undefined]);
  });

  it('numbers an id that is taken and claims the one it returns', () => {
    const taken = new Set(['task_a_di', 'task_a_di_2']);

    expect(DiIdStyle.claimUnique(taken, 'task_a_di')).toBe('task_a_di_3');
    expect(DiIdStyle.claimUnique(taken, 'task_b_di')).toBe('task_b_di');
    expect(taken.has('task_a_di_3')).toBe(true);
  });

  it('renames the DI of a renamed element in the same style, and only the DI the old id gave its name', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const definitions = document.tree.definitions;
    const task = document.tree.require('A');
    const claims = claimsOver(DiIdStyle.allIds(definitions));

    const changed = DiIdStyle.followRename(definitions, task, 'A', 'Alpha', claims);

    const ids = definitions.list('diagrams').flatMap((diagram) => diagram.get<typeof task>('plane').list('planeElement').filter((element) => element.peek<typeof task>('bpmnElement') === task).map((element) => element.id));
    expect([changed, ids]).toEqual([true, ['Alpha_di', 'V2_A_di']]);
    expect([claims.has('A_di'), claims.has('Alpha_di')]).toEqual([false, true]);
  });

  it('numbers the new DI id when another element already holds it, and leaves a DI id that is still right', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const definitions = document.tree.definitions;
    const taken = DiIdStyle.allIds(definitions);
    taken.add('BPMNShape_task_z');

    const numbered = DiIdStyle.followRename(definitions, document.tree.require('task_a'), 'task_a', 'task_z', claimsOver(taken));
    const unchanged = DiIdStyle.followRename(definitions, document.tree.require('task_b'), 'task_b', 'task_b', claimsOver(taken));

    expect([numbered, taken.has('BPMNShape_task_z_2'), unchanged]).toEqual([true, true, false]);
  });

  it('leaves a DI id alone that was never derived from the element id', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const definitions = document.tree.definitions;

    expect(DiIdStyle.followRename(definitions, document.tree.require('flow_ab'), 'flow_ab', 'flow_xy', claimsOver(DiIdStyle.allIds(definitions)))).toBe(false);
  });
});
