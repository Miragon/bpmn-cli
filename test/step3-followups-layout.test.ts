/**
 * Step 3 follow-ups, layout (from the Claude Code plugin evals):
 *
 *  - One batch that splices a task into a flow and then a gateway after it
 *    places both like two commands: in the row, between the old ends (the
 *    chain of new nodes is spliced, diagram/place.ts spliceTarget), not on
 *    a new branch row below.
 *  - A full layout sizes pools and lanes around the labels right of their
 *    content (an end event at the right edge, its label wider than the
 *    event), and a label the engine moves aside prefers a free spot inside
 *    its frame (labelOutsideFrame).
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, metricsXml, newXml, viewXml } from '../src/api.js';

/** start -> check -> gateway -(yes)-> order -> end, -(no)-> notify -> end: drawn once, then kept */
async function purchase(): Promise<string> {
  const r = await applyToXml((await newXml({ processName: 'Purchase' })).xml, [
    { op: 'add', kind: 'startEvent', name: 'Request submitted', in: 'Process_Purchase', as: '$s' },
    { op: 'add', kind: 'userTask', name: 'Check budget', after: '$s', as: '$c' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Budget available?', after: '$c', as: '$g' },
    { op: 'add', kind: 'serviceTask', name: 'Order goods', after: '$g', condition: '${ok}', flowName: 'yes', flowAs: '$yes', as: '$o' },
    { op: 'add', kind: 'endEvent', name: 'Goods ordered', after: '$o' },
    { op: 'add', kind: 'sendTask', name: 'Notify requester', after: '$g', default: true, flowName: 'no', as: '$n' },
    { op: 'add', kind: 'endEvent', name: 'Request rejected', after: '$n' },
  ]);
  return r.xml;
}

const rows = async (xml: string): Promise<string[][]> => {
  const v = await viewXml(xml, { layout: true });
  return v.diagrams.flatMap((d) => d.groups.flatMap((g) => g.rows));
};

describe('batch splices place like separate commands', () => {
  it('a task spliced into a flow and a gateway after it stay in the row', async () => {
    const xml = await purchase();
    const flow = /<bpmn:sequenceFlow id="([^"]+)" name="yes"/.exec(xml)![1]!;
    const ops = [
      { op: 'add', kind: 'userTask', name: 'Approve purchase', flow },
      { op: 'add', kind: 'exclusiveGateway', name: 'Purchase approved?', after: 'Activity_ApprovePurchase', before: 'Activity_OrderGoods' },
    ];
    const batch = await applyToXml(xml, ops, { layout: 'incremental' });
    let seq = xml;
    for (const op of ops) seq = (await applyToXml(seq, [op], { layout: 'incremental' })).xml;
    const batchRows = await rows(batch.xml);
    expect(batchRows[0]).toEqual(['Event_RequestSubmitted', 'Activity_CheckBudget', 'Gateway_BudgetAvailable', 'Activity_ApprovePurchase', 'Gateway_PurchaseApproved', 'Activity_OrderGoods', 'Event_GoodsOrdered']);
    expect(batchRows).toEqual(await rows(seq));
    expect((await metricsXml(batch.xml)).score).toBe(0);
    // the same geometry as two commands
    const shapes = (x: string): string[] => [...x.matchAll(/bpmnElement="([^"]+)"[^>]*>\s*<dc:Bounds ([^/]+)\/>/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(shapes(batch.xml)).toEqual(shapes(seq));
  });

  it('three new nodes in one flow: one chain in the row', async () => {
    const xml = await purchase();
    const flow = /<bpmn:sequenceFlow id="([^"]+)" name="yes"/.exec(xml)![1]!;
    const r = await applyToXml(
      xml,
      [
        { op: 'add', kind: 'userTask', name: 'Approve purchase', flow, as: '$a' },
        { op: 'add', kind: 'serviceTask', name: 'Reserve budget', after: '$a', as: '$r' },
        { op: 'add', kind: 'exclusiveGateway', name: 'Reserved?', after: '$r' },
      ],
      { layout: 'incremental' },
    );
    expect((await rows(r.xml))[0]).toEqual(['Event_RequestSubmitted', 'Activity_CheckBudget', 'Gateway_BudgetAvailable', 'Activity_ApprovePurchase', 'Activity_ReserveBudget', 'Gateway_Reserved', 'Activity_OrderGoods', 'Event_GoodsOrdered']);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });
});

describe('full layout: labels inside their pool', () => {
  it('an end event with a long name at the right edge of the bottom lane', async () => {
    const r = await applyToXml((await newXml({ processName: 'Order to cash' })).xml, [
      { op: 'add', kind: 'participant', name: 'Company', id: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Sales', id: 'Lane_Sales', in: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Accounting', id: 'Lane_Accounting', in: 'Participant_Company' },
      { op: 'add', kind: 'startEvent', name: 'Order received', in: 'Participant_Company', lane: 'Lane_Sales', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Check order', after: '$s', lane: 'Lane_Sales', as: '$c' },
      { op: 'add', kind: 'sendTask', name: 'Send invoice', after: '$c', lane: 'Lane_Accounting', as: '$i' },
      { op: 'add', kind: 'receiveTask', name: 'Receive payment', after: '$i', lane: 'Lane_Accounting', as: '$p' },
      { op: 'add', kind: 'endEvent', name: 'Bestellung abgeschlossen und bezahlt', after: '$p', lane: 'Lane_Accounting' },
    ]);
    expect(r.result.layout.mode).toBe('full');
    const m = await metricsXml(r.xml);
    expect(m.problems.filter((p) => p.kind === 'labelOutsideFrame')).toEqual([]);
    const pool = /bpmnElement="Participant_Company"[^>]*>\s*<dc:Bounds x="(\d+)" y="\d+" width="(\d+)"/.exec(r.xml)!;
    const label = /bpmnElement="Event_BestellungAbgeschlossenUndBezahlt"[\s\S]*?<bpmndi:BPMNLabel>\s*<dc:Bounds x="(\d+)" y="\d+" width="(\d+)"/.exec(r.xml)!;
    expect(Number(label[1]) + Number(label[2])).toBeLessThanOrEqual(Number(pool[1]) + Number(pool[2]));
  });
});
