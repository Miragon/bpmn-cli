import { describe, expect, it } from 'vitest';
import { DiIds } from '../../../src/model/diagram/DiIds.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DiIds', () => {
  it('names a new shape and a new edge in the style the diagram already uses', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const ids = new DiIds(document.tree.definitions);

    expect([ids.shape('task_d'), ids.edge('flow_cd')]).toEqual(['BPMNShape_task_d', 'BPMNEdge_flow_cd']);
  });

  it('appends _di in a file without a diagram and numbers an id asked for twice', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');
    const ids = new DiIds(document.tree.definitions);

    expect([ids.shape('task_worker'), ids.shape('task_worker'), ids.edge('flow_out')]).toEqual(['task_worker_di', 'task_worker_di_2', 'flow_out_di']);
  });

  it('derives plane and diagram ids from the root and never hands out an id of the file again', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const ids = new DiIds(document.tree.definitions);

    expect([ids.plane('Process_events'), ids.plane('Process_events'), ids.diagram('Process_events')]).toEqual(['BPMNPlane_Process_events', 'BPMNPlane_Process_events_2', 'BPMNDiagram_Process_events']);
    expect(ids.shape('task_review')).toBe('task_review_di_2');
  });

  it('cuts the id of a long element at a word boundary so the shape id stays within 64 characters', async () => {
    const document = await Fixtures.read('model/di-styles.bpmn');
    const ids = new DiIds(document.tree.definitions);

    expect(ids.shape('Activity_ApproveTheIncomingSupplierInvoiceForPaymentInTheLedger')).toBe('BPMNShape_Activity_ApproveTheIncomingSupplierInvoiceFor');
    expect(ids.plane('Process_SupplierInvoicesOfTheAccountsPayableDepartment')).toBe('BPMNPlane_Process_SupplierInvoicesOfTheAccountsPayable');
  });
});
