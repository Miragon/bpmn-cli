/**
 * Audit #14 for `move` (open after step 3 round 1): a node moved into a flow
 * between two lanes gets its lane by add's rule when it has none at its new
 * place (it came out of a sub-process or another pool): the lane of the row
 * the incremental layout draws it on (the target's after a branching
 * source, else the anchor's), with W_LANE_INHERITED naming the other lane;
 * before, it took the anchor's (the flow source's) lane, so after a
 * branching gateway it sat in the source lane but on the target's row. A
 * node that is in a lane keeps it (a note when the flow runs between two
 * other lanes) and is drawn on a row of that lane, like `add --lane` (before,
 * on the target's row with its lane stretched over to it); --lane decides up
 * front. Synthetic models only.
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

/**
 * Pool Claims, lanes Clerk / Accounting / Archive. Clerk: Claim received ->
 * Check claim -> Goodwill? -> (no) Reject -> Rejected, and a sub-process
 * Prepare (Collect documents inside) after Check claim; Accounting: (yes)
 * Refund -> Book refund (Archive) -> Refunded; Archive: Note (unconnected).
 * The engine draws Reject on Goodwill?'s row (its happy path runs on in
 * Accounting). `reminder`: a timer path on Reject in Clerk (Late -> Remind ->
 * Reminded), on a row below it.
 */
async function claims(reminder = false): Promise<string> {
  const result = await applyToXml((await newXml({ processName: 'Claims' })).xml, [
    { op: 'add', kind: 'participant', name: 'Claims' },
    { op: 'add', kind: 'lane', name: 'Clerk', in: 'participant_claims', as: '$clerk' },
    { op: 'add', kind: 'lane', name: 'Accounting', in: 'participant_claims', as: '$acc' },
    { op: 'add', kind: 'lane', name: 'Archive', in: 'participant_claims', as: '$arc' },
    { op: 'add', kind: 'start', name: 'Claim received', lane: '$clerk', in: 'claims', as: '$s' },
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
    { op: 'add', kind: 'task', name: 'Note', lane: '$arc', in: 'claims' },
    ...(reminder
      ? [
          { op: 'add', kind: 'boundaryEvent:timer', name: 'Late', on: '$reject', timer: 'P1D', nonInterrupting: true, as: '$late' },
          { op: 'add', kind: 'sendTask', name: 'Remind', after: '$late', lane: '$clerk', as: '$remind' },
          { op: 'add', kind: 'end', name: 'Reminded', after: '$remind' },
        ]
      : []),
  ]);
  return result.xml;
}

const laneIdOf = async (xml: string, id: string): Promise<string | undefined> => {
  const doc = await Doc.fromXml(xml);
  return laneOf(doc, doc.require(id))?.get<string>('id');
};

describe('move into a flow between two lanes (audit #14 for move)', () => {
  it('a node out of a sub-process into the flow after a branching gateway: the target lane, on its row, W_LANE_INHERITED', async () => {
    const xml = await claims();
    const lanes = { clerk: bounds(xml, 'lane_clerk'), acc: bounds(xml, 'lane_accounting') };
    const result = await applyToXml(xml, [{ op: 'move', ids: ['task_collectDocuments'], flow: 'flow_goodwillToRefund' }], { layout: 'incremental' });
    expect(await laneIdOf(result.xml, 'task_collectDocuments')).toBe('lane_accounting');
    const inherited = result.result.warnings.added.find((warning) => warning.code === 'W_LANE_INHERITED');
    expect(inherited?.message).toBe(
      'task_collectDocuments is in lane_accounting (the lane of serviceTask_refund, on whose row the layout puts it after the branching gateway_goodwill); the flow it went into runs from gateway_goodwill in lane_clerk to serviceTask_refund in lane_accounting',
    );
    expect(inherited?.hint).toBe('If lane_clerk does it: `bpmn move <file> task_collectDocuments --lane lane_clerk` (or --lane lane_clerk when adding).');
    expect(inside(bounds(result.xml, 'task_collectDocuments'), bounds(result.xml, 'lane_accounting'))).toBe(true);
    // on the target's row; neither lane grew
    const moved = bounds(result.xml, 'task_collectDocuments');
    const refund = bounds(result.xml, 'serviceTask_refund');
    expect(moved.y + moved.height / 2).toBeCloseTo(refund.y + refund.height / 2, 0);
    expect([bounds(result.xml, 'lane_clerk').height, bounds(result.xml, 'lane_accounting').height]).toEqual([lanes.clerk.height, lanes.acc.height]);
    expect((result.result.layout.metrics?.added ?? []).filter((problem) => problem.kind.startsWith('outside'))).toEqual([]);
  });

  it('--after a plain node whose flow crosses lanes: the anchor lane, W_LANE_INHERITED; --lane decides up front', async () => {
    const xml = await claims();
    const result = await applyToXml(xml, [{ op: 'move', ids: ['task_collectDocuments'], after: 'serviceTask_refund' }], { layout: 'incremental' });
    expect(await laneIdOf(result.xml, 'task_collectDocuments')).toBe('lane_accounting');
    expect(result.result.warnings.added.find((warning) => warning.code === 'W_LANE_INHERITED')?.message).toBe(
      'task_collectDocuments is in lane_accounting (the lane of serviceTask_refund); the flow it went into runs from serviceTask_refund in lane_accounting to serviceTask_bookRefund in lane_archive',
    );
    const explicit = await applyToXml(xml, [{ op: 'move', ids: ['task_collectDocuments'], after: 'serviceTask_refund', lane: 'lane_archive' }], { layout: 'incremental' });
    expect(await laneIdOf(explicit.xml, 'task_collectDocuments')).toBe('lane_archive');
    expect(explicit.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANE_INHERITED');
    expect(inside(bounds(explicit.xml, 'task_collectDocuments'), bounds(explicit.xml, 'lane_archive'))).toBe(true);
  });

  it('a node in a lane keeps it: a note when the flow runs between two other lanes, nothing when its lane is one of them', async () => {
    const xml = await claims();
    const result = await applyToXml(xml, [{ op: 'move', ids: ['task_note'], flow: 'flow_goodwillToRefund' }], { layout: 'incremental' });
    expect(await laneIdOf(result.xml, 'task_note')).toBe('lane_archive');
    expect(result.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANE_INHERITED');
    expect(result.result.notes).toContain(
      'task_note stays in its lane lane_archive; the flow it went into runs from gateway_goodwill in lane_clerk to serviceTask_refund in lane_accounting (`bpmn move <file> task_note --lane lane_accounting` puts it on the row the layout gives a node there)',
    );
    expect(inside(bounds(result.xml, 'task_note'), bounds(result.xml, 'lane_archive'))).toBe(true);
    const one = await applyToXml(xml, [{ op: 'move', ids: ['task_note'], flow: 'flow_refundToBookRefund' }], { layout: 'incremental' });
    expect(await laneIdOf(one.xml, 'task_note')).toBe('lane_archive');
    expect(one.result.notes.filter((note) => note.includes('stays in its lane'))).toEqual([]);
  });

  it('a node that keeps the branching anchor\'s lane goes on a row of that lane: the lane never stretches over to the target\'s row (move and add --lane)', async () => {
    // the reminder path keeps a row in Clerk below Goodwill?'s, free in the column the node goes to
    const xml = await claims(true);
    const before = { clerk: bounds(xml, 'lane_clerk'), acc: bounds(xml, 'lane_accounting') };
    const moved = await applyToXml(xml, [{ op: 'move', ids: ['userTask_checkClaim'], flow: 'flow_goodwillToRefund' }], { layout: 'incremental' });
    const added = await applyToXml(xml, [{ op: 'add', kind: 'task', id: 'Activity_Log', name: 'Log', flow: 'flow_goodwillToRefund', lane: 'lane_clerk' }], { layout: 'incremental' });
    for (const [result, id] of [
      [moved, 'userTask_checkClaim'],
      [added, 'Activity_Log'],
    ] as const) {
      expect(await laneIdOf(result.xml, id)).toBe('lane_clerk');
      expect(inside(bounds(result.xml, id), bounds(result.xml, 'lane_clerk'))).toBe(true);
      // before: drawn on serviceTask_refund's row, lane_clerk stretched down over it and pushed lane_accounting away
      expect(bounds(result.xml, 'lane_clerk').height).toBe(before.clerk.height);
      expect(bounds(result.xml, 'lane_accounting').y).toBe(before.acc.y);
      expect((result.result.layout.metrics?.added ?? []).filter((problem) => problem.kind.startsWith('outside') || problem.kind === 'overlaps')).toEqual([]);
    }
  });

  it('a flow inside one lane: the lane of the anchor, no warning', async () => {
    const xml = await claims();
    const result = await applyToXml(xml, [{ op: 'move', ids: ['task_collectDocuments'], flow: 'flow_goodwillToReject' }], { layout: 'incremental' });
    expect(await laneIdOf(result.xml, 'task_collectDocuments')).toBe('lane_clerk');
    expect(result.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANE_INHERITED');
  });
});
