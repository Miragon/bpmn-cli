/**
 * Audit #14: a node added into a flow between two lanes gets the lane of the
 * row the incremental layout puts it on (after a branching source: the
 * target's), and W_LANE_INHERITED names the other lane. The drawing keeps
 * both lane bands as they were. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../../src/api.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { laneOf } from '../../../src/domain/document/utils/lanes.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function bounds(xml: string, id: string): Box {
  const match = new RegExp(`<bpmndi:BPMNShape [^>]*bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([-\\d.]+)" y="([-\\d.]+)" width="([-\\d.]+)" height="([-\\d.]+)"`).exec(xml);
  if (!match) throw new Error(`no shape for ${id}`);
  return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
}

const inside = (inner: Box, outer: Box): boolean => inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height && inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;

/** A pool with the lanes Clerk and Accounting: Goodwill? branches into Refund (Accounting); Approve (Clerk) -> Pay (Accounting). */
async function claims(): Promise<string> {
  const result = await applyToXml((await newXml({ processName: 'Claims' })).xml, [
    { op: 'add', kind: 'participant', name: 'Claims' },
    { op: 'add', kind: 'lane', name: 'Clerk', in: 'participant_claims', as: '$clerk' },
    { op: 'add', kind: 'lane', name: 'Accounting', in: 'participant_claims', as: '$acc' },
    { op: 'add', kind: 'start', name: 'Claim received', lane: '$clerk', in: 'claims', as: '$s' },
    { op: 'add', kind: 'userTask', name: 'Check claim', after: '$s', as: '$check' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Goodwill?', after: '$check', as: '$g' },
    { op: 'add', kind: 'userTask', name: 'Reject', after: '$g', flowName: 'no', as: '$reject' },
    { op: 'add', kind: 'end', name: 'Rejected', after: '$reject' },
    { op: 'add', kind: 'serviceTask', name: 'Refund', after: '$g', flowName: 'yes', lane: '$acc', as: '$refund' },
    { op: 'add', kind: 'end', name: 'Refunded', after: '$refund' },
    { op: 'add', kind: 'userTask', name: 'Approve', after: '$s', lane: '$clerk' },
  ]);
  return result.xml;
}

describe('a node added into a flow between two lanes (audit #14)', () => {
  it('after a branching node: the target lane, on the target row; no lane grows', async () => {
    const xml = await claims();
    const before = { clerk: bounds(xml, 'lane_clerk'), acc: bounds(xml, 'lane_accounting') };
    const result = await applyToXml(xml, [{ op: 'add', kind: 'exclusiveGateway', name: 'Amount > 500?', flow: 'flow_goodwillToRefund' }], { layout: 'incremental' });
    const doc = await Doc.fromXml(result.xml);
    expect(laneOf(doc, doc.require('gateway_amount500'))?.get('id')).toBe('lane_accounting');
    const inherited = result.result.warnings.added.find((warning) => warning.code === 'W_LANE_INHERITED');
    expect(inherited?.message).toBe('gateway_amount500 is in lane_accounting (the lane of serviceTask_refund, on whose row the layout puts it after the branching gateway_goodwill); the flow it went into runs from gateway_goodwill in lane_clerk to serviceTask_refund in lane_accounting');
    expect(inherited?.hint).toBe('If lane_clerk does it: `bpmn move <file> gateway_amount500 --lane lane_clerk` (or --lane lane_clerk when adding).');
    const after = { clerk: bounds(result.xml, 'lane_clerk'), acc: bounds(result.xml, 'lane_accounting') };
    expect(inside(bounds(result.xml, 'gateway_amount500'), after.acc)).toBe(true);
    expect([after.clerk.y, after.clerk.height, after.acc.height]).toEqual([before.clerk.y, before.clerk.height, before.acc.height]);
    // on the target's row
    const gw = bounds(result.xml, 'gateway_amount500');
    const refund = bounds(result.xml, 'serviceTask_refund');
    expect(gw.y + gw.height / 2).toBeCloseTo(refund.y + refund.height / 2, 0);
    expect(result.result.layout.metrics?.added ?? []).toEqual([]);
  });

  it('after a plain node: its lane, on its row; --lane chooses the other one up front', async () => {
    const xml = await claims();
    const base = await applyToXml(xml, [{ op: 'add', kind: 'serviceTask', name: 'Pay', after: 'userTask_approve', lane: 'lane_accounting' }]);
    const result = await applyToXml(base.xml, [{ op: 'add', kind: 'userTask', name: 'Sign', flow: 'flow_approveToPay' }], { layout: 'incremental' });
    const doc = await Doc.fromXml(result.xml);
    expect(laneOf(doc, doc.require('userTask_sign'))?.get('id')).toBe('lane_clerk');
    expect(result.result.warnings.added.map((warning) => warning.code)).toContain('W_LANE_INHERITED');
    expect(inside(bounds(result.xml, 'userTask_sign'), bounds(result.xml, 'lane_clerk'))).toBe(true);
    const explicit = await applyToXml(base.xml, [{ op: 'add', kind: 'userTask', name: 'Sign', flow: 'flow_approveToPay', lane: 'lane_accounting' }], { layout: 'incremental' });
    expect(explicit.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANE_INHERITED');
    expect(inside(bounds(explicit.xml, 'userTask_sign'), bounds(explicit.xml, 'lane_accounting'))).toBe(true);
  });

  it('a splice inside one lane says nothing; --before takes the anchor lane', async () => {
    const xml = await claims();
    const same = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Log', flow: 'flow_checkClaimToGoodwill' }]);
    expect(same.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANE_INHERITED');
    const before = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Prepare refund', before: 'serviceTask_refund' }], { layout: 'incremental' });
    const doc = await Doc.fromXml(before.xml);
    expect(laneOf(doc, doc.require('task_prepareRefund'))?.get('id')).toBe('lane_accounting');
    expect(inside(bounds(before.xml, 'task_prepareRefund'), bounds(before.xml, 'lane_accounting'))).toBe(true);
    // before a node whose predecessor does not branch: the anchor's lane, and the message says so
    const plain = await applyToXml(xml, [{ op: 'add', kind: 'serviceTask', name: 'Pay', after: 'userTask_approve', lane: 'lane_accounting' }]);
    const result = await applyToXml(plain.xml, [{ op: 'add', kind: 'task', name: 'Prepare', before: 'serviceTask_pay' }], { layout: 'incremental' });
    expect(result.result.warnings.added.find((warning) => warning.code === 'W_LANE_INHERITED')?.message).toBe('task_prepare is in lane_accounting (the lane of serviceTask_pay); the flow it went into runs from userTask_approve in lane_clerk to serviceTask_pay in lane_accounting');
    expect(inside(bounds(result.xml, 'task_prepare'), bounds(result.xml, 'lane_accounting'))).toBe(true);
  });
});
