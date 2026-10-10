/**
 * Audit #14: a node added into a flow between two lanes gets the lane of the
 * row the incremental layout puts it on (after a branching source: the
 * target's), and W_LANE_INHERITED names the other lane. The drawing keeps
 * both lane bands as they were. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { laneOf } from '../src/ops/containers.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function bounds(xml: string, id: string): Box {
  const m = new RegExp(`<bpmndi:BPMNShape [^>]*bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([-\\d.]+)" y="([-\\d.]+)" width="([-\\d.]+)" height="([-\\d.]+)"`).exec(xml);
  if (!m) throw new Error(`no shape for ${id}`);
  return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
}

const inside = (inner: Box, outer: Box): boolean => inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height && inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;

/** A pool with the lanes Clerk and Accounting: Goodwill? branches into Refund (Accounting); Approve (Clerk) -> Pay (Accounting). */
async function claims(): Promise<string> {
  const r = await applyToXml((await newXml({ processName: 'Claims' })).xml, [
    { op: 'add', kind: 'participant', name: 'Claims' },
    { op: 'add', kind: 'lane', name: 'Clerk', in: 'Participant_Claims', as: '$clerk' },
    { op: 'add', kind: 'lane', name: 'Accounting', in: 'Participant_Claims', as: '$acc' },
    { op: 'add', kind: 'start', name: 'Claim received', lane: '$clerk', in: 'Process_Claims', as: '$s' },
    { op: 'add', kind: 'userTask', name: 'Check claim', after: '$s', as: '$check' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Goodwill?', after: '$check', as: '$g' },
    { op: 'add', kind: 'userTask', name: 'Reject', after: '$g', flowName: 'no', as: '$reject' },
    { op: 'add', kind: 'end', name: 'Rejected', after: '$reject' },
    { op: 'add', kind: 'serviceTask', name: 'Refund', after: '$g', flowName: 'yes', lane: '$acc', as: '$refund' },
    { op: 'add', kind: 'end', name: 'Refunded', after: '$refund' },
    { op: 'add', kind: 'userTask', name: 'Approve', after: '$s', lane: '$clerk' },
  ]);
  return r.xml;
}

describe('a node added into a flow between two lanes (audit #14)', () => {
  it('after a branching node: the target lane, on the target row; no lane grows', async () => {
    const xml = await claims();
    const before = { clerk: bounds(xml, 'Lane_Clerk'), acc: bounds(xml, 'Lane_Accounting') };
    const r = await applyToXml(xml, [{ op: 'add', kind: 'exclusiveGateway', name: 'Amount > 500?', flow: 'Flow_GoodwillToRefund' }], { layout: 'incremental' });
    const doc = await Doc.fromXml(r.xml);
    expect(laneOf(doc, doc.require('Gateway_Amount500'))?.get('id')).toBe('Lane_Accounting');
    const w = r.result.warnings.find((x) => x.code === 'W_LANE_INHERITED');
    expect(w?.message).toBe('Gateway_Amount500 is in Lane_Accounting (the lane of Activity_Refund, on whose row the layout puts it after the branching Gateway_Goodwill); the flow it went into runs from Gateway_Goodwill in Lane_Clerk to Activity_Refund in Lane_Accounting');
    expect(w?.hint).toBe('If Lane_Clerk does it: `bpmn move <file> Gateway_Amount500 --lane Lane_Clerk` (or --lane Lane_Clerk when adding).');
    const after = { clerk: bounds(r.xml, 'Lane_Clerk'), acc: bounds(r.xml, 'Lane_Accounting') };
    expect(inside(bounds(r.xml, 'Gateway_Amount500'), after.acc)).toBe(true);
    expect([after.clerk.y, after.clerk.height, after.acc.height]).toEqual([before.clerk.y, before.clerk.height, before.acc.height]);
    // on the target's row
    const gw = bounds(r.xml, 'Gateway_Amount500');
    const refund = bounds(r.xml, 'Activity_Refund');
    expect(gw.y + gw.height / 2).toBeCloseTo(refund.y + refund.height / 2, 0);
    expect(r.result.layout.metrics?.added ?? []).toEqual([]);
  });

  it('after a plain node: its lane, on its row; --lane chooses the other one up front', async () => {
    const xml = await claims();
    const base = await applyToXml(xml, [{ op: 'add', kind: 'serviceTask', name: 'Pay', after: 'Activity_Approve', lane: 'Lane_Accounting' }]);
    const r = await applyToXml(base.xml, [{ op: 'add', kind: 'userTask', name: 'Sign', flow: 'Flow_ApproveToPay' }], { layout: 'incremental' });
    const doc = await Doc.fromXml(r.xml);
    expect(laneOf(doc, doc.require('Activity_Sign'))?.get('id')).toBe('Lane_Clerk');
    expect(r.result.warnings.map((x) => x.code)).toContain('W_LANE_INHERITED');
    expect(inside(bounds(r.xml, 'Activity_Sign'), bounds(r.xml, 'Lane_Clerk'))).toBe(true);
    const explicit = await applyToXml(base.xml, [{ op: 'add', kind: 'userTask', name: 'Sign', flow: 'Flow_ApproveToPay', lane: 'Lane_Accounting' }], { layout: 'incremental' });
    expect(explicit.result.warnings.map((x) => x.code)).not.toContain('W_LANE_INHERITED');
    expect(inside(bounds(explicit.xml, 'Activity_Sign'), bounds(explicit.xml, 'Lane_Accounting'))).toBe(true);
  });

  it('a splice inside one lane says nothing; --before takes the anchor lane', async () => {
    const xml = await claims();
    const same = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Log', flow: 'Flow_CheckClaimToGoodwill' }]);
    expect(same.result.warnings.map((x) => x.code)).not.toContain('W_LANE_INHERITED');
    const before = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Prepare refund', before: 'Activity_Refund' }], { layout: 'incremental' });
    const doc = await Doc.fromXml(before.xml);
    expect(laneOf(doc, doc.require('Activity_PrepareRefund'))?.get('id')).toBe('Lane_Accounting');
    expect(inside(bounds(before.xml, 'Activity_PrepareRefund'), bounds(before.xml, 'Lane_Accounting'))).toBe(true);
  });
});
