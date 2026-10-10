/**
 * Audit #14 for `move` (open after step 3 round 1): a node moved into a flow
 * between two lanes gets its lane by add's rule when it has none at its new
 * place (it came out of a sub-process or another pool): the lane of the row
 * the incremental layout draws it on (the target's after a branching
 * source, else the anchor's), with W_LANE_INHERITED naming the other lane;
 * before, it took the anchor's (the flow source's) lane, so after a
 * branching gateway it sat in the source lane but on the target's row. A
 * node that is in a lane keeps it (a note when the flow runs between two
 * other lanes); --lane decides up front. Synthetic models only.
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

/**
 * Pool Claims, lanes Clerk / Accounting / Archive. Clerk: Claim received ->
 * Check claim -> Goodwill? -> (no) Reject -> Rejected, and a sub-process
 * Prepare (Collect documents inside) after Check claim; Accounting: (yes)
 * Refund -> Book refund (Archive) -> Refunded; Archive: Note (unconnected).
 */
async function claims(): Promise<string> {
  const r = await applyToXml((await newXml({ processName: 'Claims' })).xml, [
    { op: 'add', kind: 'participant', name: 'Claims' },
    { op: 'add', kind: 'lane', name: 'Clerk', in: 'Participant_Claims', as: '$clerk' },
    { op: 'add', kind: 'lane', name: 'Accounting', in: 'Participant_Claims', as: '$acc' },
    { op: 'add', kind: 'lane', name: 'Archive', in: 'Participant_Claims', as: '$arc' },
    { op: 'add', kind: 'start', name: 'Claim received', lane: '$clerk', in: 'Process_Claims', as: '$s' },
    { op: 'add', kind: 'userTask', name: 'Check claim', after: '$s', as: '$check' },
    { op: 'add', kind: 'subProcess', name: 'Prepare', after: '$check', as: '$prep' },
    { op: 'add', kind: 'startEvent', name: 'Prepare started', in: '$prep', as: '$ps' },
    { op: 'add', kind: 'task', name: 'Collect documents', after: '$ps', as: '$collect' },
    { op: 'add', kind: 'task', name: 'Scan documents', after: '$collect' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Goodwill?', after: '$prep', as: '$g' },
    { op: 'add', kind: 'userTask', name: 'Reject', after: '$g', flowName: 'no', as: '$reject' },
    { op: 'add', kind: 'end', name: 'Rejected', after: '$reject' },
    { op: 'add', kind: 'serviceTask', name: 'Refund', after: '$g', flowName: 'yes', lane: '$acc', as: '$refund' },
    { op: 'add', kind: 'serviceTask', name: 'Book refund', after: '$refund', lane: '$arc', as: '$book' },
    { op: 'add', kind: 'end', name: 'Refunded', after: '$book' },
    { op: 'add', kind: 'task', name: 'Note', lane: '$arc', in: 'Process_Claims' },
  ]);
  return r.xml;
}

const laneIdOf = async (xml: string, id: string): Promise<string | undefined> => {
  const doc = await Doc.fromXml(xml);
  return laneOf(doc, doc.require(id))?.get<string>('id');
};

describe('move into a flow between two lanes (audit #14 for move)', () => {
  it('a node out of a sub-process into the flow after a branching gateway: the target lane, on its row, W_LANE_INHERITED', async () => {
    const xml = await claims();
    const lanes = { clerk: bounds(xml, 'Lane_Clerk'), acc: bounds(xml, 'Lane_Accounting') };
    const r = await applyToXml(xml, [{ op: 'move', ids: ['Activity_CollectDocuments'], flow: 'Flow_GoodwillToRefund' }], { layout: 'incremental' });
    expect(await laneIdOf(r.xml, 'Activity_CollectDocuments')).toBe('Lane_Accounting');
    const w = r.result.warnings.added.find((x) => x.code === 'W_LANE_INHERITED');
    expect(w?.message).toBe(
      'Activity_CollectDocuments is in Lane_Accounting (the lane of Activity_Refund, on whose row the layout puts it after the branching Gateway_Goodwill); the flow it went into runs from Gateway_Goodwill in Lane_Clerk to Activity_Refund in Lane_Accounting',
    );
    expect(w?.hint).toBe('If Lane_Clerk does it: `bpmn move <file> Activity_CollectDocuments --lane Lane_Clerk` (or --lane Lane_Clerk when adding).');
    expect(inside(bounds(r.xml, 'Activity_CollectDocuments'), bounds(r.xml, 'Lane_Accounting'))).toBe(true);
    // on the target's row; neither lane grew
    const moved = bounds(r.xml, 'Activity_CollectDocuments');
    const refund = bounds(r.xml, 'Activity_Refund');
    expect(moved.y + moved.height / 2).toBeCloseTo(refund.y + refund.height / 2, 0);
    expect([bounds(r.xml, 'Lane_Clerk').height, bounds(r.xml, 'Lane_Accounting').height]).toEqual([lanes.clerk.height, lanes.acc.height]);
    expect((r.result.layout.metrics?.added ?? []).filter((p) => p.kind.startsWith('outside'))).toEqual([]);
  });

  it('--after a plain node whose flow crosses lanes: the anchor lane, W_LANE_INHERITED; --lane decides up front', async () => {
    const xml = await claims();
    const r = await applyToXml(xml, [{ op: 'move', ids: ['Activity_CollectDocuments'], after: 'Activity_Refund' }], { layout: 'incremental' });
    expect(await laneIdOf(r.xml, 'Activity_CollectDocuments')).toBe('Lane_Accounting');
    expect(r.result.warnings.added.find((x) => x.code === 'W_LANE_INHERITED')?.message).toBe(
      'Activity_CollectDocuments is in Lane_Accounting (the lane of Activity_Refund); the flow it went into runs from Activity_Refund in Lane_Accounting to Activity_BookRefund in Lane_Archive',
    );
    const explicit = await applyToXml(xml, [{ op: 'move', ids: ['Activity_CollectDocuments'], after: 'Activity_Refund', lane: 'Lane_Archive' }], { layout: 'incremental' });
    expect(await laneIdOf(explicit.xml, 'Activity_CollectDocuments')).toBe('Lane_Archive');
    expect(explicit.result.warnings.added.map((x) => x.code)).not.toContain('W_LANE_INHERITED');
    expect(inside(bounds(explicit.xml, 'Activity_CollectDocuments'), bounds(explicit.xml, 'Lane_Archive'))).toBe(true);
  });

  it('a node in a lane keeps it: a note when the flow runs between two other lanes, nothing when its lane is one of them', async () => {
    const xml = await claims();
    const r = await applyToXml(xml, [{ op: 'move', ids: ['Activity_Note'], flow: 'Flow_GoodwillToRefund' }], { layout: 'incremental' });
    expect(await laneIdOf(r.xml, 'Activity_Note')).toBe('Lane_Archive');
    expect(r.result.warnings.added.map((x) => x.code)).not.toContain('W_LANE_INHERITED');
    expect(r.result.notes).toContain(
      'Activity_Note stays in its lane Lane_Archive; the flow it went into runs from Gateway_Goodwill in Lane_Clerk to Activity_Refund in Lane_Accounting (`bpmn move <file> Activity_Note --lane Lane_Accounting` puts it on the row the layout gives a node there)',
    );
    expect(inside(bounds(r.xml, 'Activity_Note'), bounds(r.xml, 'Lane_Archive'))).toBe(true);
    const one = await applyToXml(xml, [{ op: 'move', ids: ['Activity_Note'], flow: 'Flow_RefundToBookRefund' }], { layout: 'incremental' });
    expect(await laneIdOf(one.xml, 'Activity_Note')).toBe('Lane_Archive');
    expect(one.result.notes.filter((n) => n.includes('stays in its lane'))).toEqual([]);
  });

  it('a flow inside one lane: the lane of the anchor, no warning', async () => {
    const xml = await claims();
    const r = await applyToXml(xml, [{ op: 'move', ids: ['Activity_CollectDocuments'], flow: 'Flow_GoodwillToReject' }], { layout: 'incremental' });
    expect(await laneIdOf(r.xml, 'Activity_CollectDocuments')).toBe('Lane_Clerk');
    expect(r.result.warnings.added.map((x) => x.code)).not.toContain('W_LANE_INHERITED');
  });
});
