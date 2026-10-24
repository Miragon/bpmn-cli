/**
 * Issue #18, stage B: a crossing-aware row choice with room-making (2) and a
 * local repair after placement (3), on synthetic hand-drawn models
 * (test/fixtures/layout-room), the plugin eval's fixture and a public
 * scenario (tools/scenarios):
 *
 *  - a branch or exception path whose rows below all cross a line opens the
 *    row right below its anchor: the space tool pushes the shapes and the
 *    horizontal segments of the lines running under the anchor down (bypass
 *    and loop-back lines); a branch also tries the rows above its anchor, a
 *    boundary path its host's top border with the path above it. The row
 *    choice counts the chain that follows on the row (diagram/place.ts
 *    chainCost). Single commands and the batch give the same shapes.
 *  - a branch row keeps clear of the boundary events on its frame's bottom
 *    border (audit #63).
 *  - a crossing left between a new and an existing connection: the existing
 *    one is routed again with the new shapes as obstacles, else the chain
 *    starts at its next row candidate; a trial is kept only when it adds no
 *    hard problem and lowers the score (incremental.ts repairCrossings).
 *
 * The later blocks hold the findings of the stage B verification, each
 * failing on the stage B build: the path of an event on its host's top
 * border, the top-border spot and lines, hand-drawn boundary events, a line
 * along a new end event, the repair's guard against crossings between drawn
 * lines, the trials it does not measure, and associations routed at once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml, metricsXml, newXml } from '../src/api.js';
import { diffProblems } from '../src/diagram/utils/problems.js';
import { LayoutAnalysis } from '../src/diagram/LayoutAnalysis.js';

const ROOT = join(import.meta.dirname, '..');
const fixture = (name: string): string => readFileSync(join(ROOT, 'test', 'fixtures', 'layout-room', name), 'utf8');
const EVAL = (() => {
  const script = readFileSync(join(ROOT, 'plugins', 'bpmn-cli', 'evals', 'edit-hand-drawn-model', 'scaffold.sh'), 'utf8');
  return /<<'BPMN_FIXTURE'\n([\s\S]*?)\nBPMN_FIXTURE/.exec(script)![1]! + '\n';
})();

const shapes = (xml: string): string[] => [...xml.matchAll(/bpmnElement="([^"]+)"[^>]*>\s*<dc:Bounds ([^/]+)\/>/g)].map((m) => `${m[1]} ${m[2]}`).sort();
const boundsOf = (xml: string, id: string): { x: number; y: number; width: number; height: number } => {
  const m = new RegExp(`bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`).exec(xml)!;
  return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
};
const waypoints = (xml: string, id: string): Array<{ x: number; y: number }> => {
  const edge = new RegExp(`<bpmndi:BPMNEdge [^>]*bpmnElement="${id}"[^>]*>([\\s\\S]*?)</bpmndi:BPMNEdge>`).exec(xml)![1]!;
  return [...edge.matchAll(/<di:waypoint x="([-\d.]+)" y="([-\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
};
const added = async (before: string, after: string): Promise<string[]> => diffProblems((await LayoutAnalysis.ofXml(before)).problems, (await LayoutAnalysis.ofXml(after)).problems).added.map((p) => p.kind);
const cy = (b: { y: number; height: number }): number => b.y + b.height / 2;

async function batch(xml: string, ops: object[]): Promise<string> {
  return (await applyToXml(xml, ops, { force: true })).xml;
}
async function singles(xml: string, ops: object[]): Promise<string> {
  for (const op of ops) xml = (await applyToXml(xml, [op], { force: true })).xml;
  return xml;
}

describe('a crossing-aware row choice that makes room (issue #18 (2))', () => {
  const reminder = [
    { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', id: 'Event_ApprovalOverdue', on: 'Activity_ApproveClaim', timer: 'P2D', nonInterrupting: true },
    { op: 'add', kind: 'sendTask', name: 'Remind approver', id: 'Activity_RemindApprover', after: 'Event_ApprovalOverdue' },
    { op: 'add', kind: 'endEvent', name: 'Approver reminded', id: 'Event_ApproverReminded', after: 'Activity_RemindApprover' },
  ];

  it('a boundary path above a line from an earlier boundary event: the row below the host is opened, the line goes down, no crossing', async () => {
    const xml = fixture('bypass-under-host.bpmn');
    const s = await singles(xml, reminder);
    expect(await added(xml, s)).toEqual([]);
    expect(shapes(await batch(xml, reminder))).toEqual(shapes(s));
    const host = boundsOf(s, 'Activity_ApproveClaim');
    const remind = boundsOf(s, 'Activity_RemindApprover');
    // the path right below the host, the line from "Claim invalid" and its end pushed below the path
    expect(remind.y).toBeGreaterThan(host.y + host.height);
    const line = waypoints(s, 'Flow_ClaimInvalidToClaimRejected');
    expect(Math.max(...line.map((p) => p.y))).toBeGreaterThan(remind.y + remind.height);
    expect(boundsOf(s, 'Event_ClaimRejected').y).toBeGreaterThan(remind.y + remind.height);
  });

  it('a decision spliced into a branch with a bypass right under it: the new "no" branch goes above the row, no crossing', async () => {
    const xml = fixture('bypass-under-split.bpmn');
    const ops = [
      { op: 'add', kind: 'userTask', name: 'Check parcel weight', id: 'Activity_CheckWeight', flow: 'Flow_ExpressYes' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Weight ok?', id: 'Gateway_WeightOk', after: 'Activity_CheckWeight', before: 'Activity_PackExpress' },
      { op: 'add', kind: 'sendTask', name: 'Offer standard shipping', id: 'Activity_OfferStandard', after: 'Gateway_WeightOk', flowName: 'no' },
      { op: 'add', kind: 'endEvent', name: 'Standard offered', id: 'Event_StandardOffered', after: 'Activity_OfferStandard' },
    ];
    const s = await singles(xml, ops);
    expect(await added(xml, s)).toEqual([]);
    expect(shapes(await batch(xml, ops))).toEqual(shapes(s));
    expect(cy(boundsOf(s, 'Activity_OfferStandard'))).toBeLessThan(boundsOf(s, 'Gateway_WeightOk').y);
    expect(cy(boundsOf(s, 'Gateway_WeightOk'))).toBe(cy(boundsOf(s, 'Gateway_Express')));
  });

  const approve = { op: 'add', kind: 'userTask', name: 'Approve purchase', id: 'Activity_ApprovePurchase', flow: 'Flow_0yq6cfd' };
  const decision = { op: 'add', kind: 'exclusiveGateway', name: 'Purchase approved?', id: 'Gateway_PurchaseApproved', after: 'Activity_ApprovePurchase', before: 'Activity_1v0w8zr' };
  const evalReminder = [
    { op: 'add', kind: 'boundaryEvent:timer', name: '3 days', id: 'Event_ApprovalOverdue', on: 'Activity_ApprovePurchase', timer: 'P3D', nonInterrupting: true },
    { op: 'add', kind: 'sendTask', name: 'Send reminder to manager', id: 'Activity_SendApprovalReminder', after: 'Event_ApprovalOverdue' },
    { op: 'add', kind: 'endEvent', name: 'Reminder sent', id: 'Event_ReminderSent', after: 'Activity_SendApprovalReminder' },
  ];
  const evalBatches: Record<string, object[]> = {
    'decision, "no" to the existing node': [approve, decision, { op: 'connect', source: 'Gateway_PurchaseApproved', target: 'Activity_0f3j5ny', name: 'no' }],
    'decision, a new "no" branch': [
      approve,
      decision,
      { op: 'add', kind: 'sendTask', name: 'Notify requester of rejection', id: 'Activity_NotifyRequesterOfRejection', after: 'Gateway_PurchaseApproved', flowName: 'no' },
      { op: 'add', kind: 'endEvent', name: 'Purchase rejected', id: 'Event_PurchaseRejected', after: 'Activity_NotifyRequesterOfRejection' },
    ],
    'a merge gateway': [approve, decision, { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_MergeRejection', flow: 'Flow_1r2x9bv' }, { op: 'connect', source: 'Gateway_PurchaseApproved', target: 'Gateway_MergeRejection', name: 'no' }],
  };
  for (const [name, ops] of Object.entries(evalBatches)) {
    it(`the eval's model, ${name} + the reminder path: score 0, batch and single commands alike`, async () => {
      const all = [...ops, ...evalReminder];
      const b = await batch(EVAL, all);
      expect((await metricsXml(b)).score).toBe(0);
      expect(shapes(await singles(EVAL, all))).toEqual(shapes(b));
    });
  }

  it('the eval\'s reminder path that crossed the "no" flow goes above the approval on its own (the event on the top border)', async () => {
    const r = await applyToXml(EVAL, [...evalBatches['decision, "no" to the existing node']!, ...evalReminder], { force: true });
    const host = boundsOf(r.xml, 'Activity_ApprovePurchase');
    expect(cy(boundsOf(r.xml, 'Event_ApprovalOverdue'))).toBe(host.y);
    expect(boundsOf(r.xml, 'Activity_SendApprovalReminder').y + 80).toBeLessThanOrEqual(host.y);
    expect(r.result.layout?.notes?.join(' ')).toContain('Event_ApprovalOverdue moved to the top border of Activity_ApprovePurchase');
  });

  it('a branch row keeps clear of the boundary event on its frame\'s bottom border (audit #63)', async () => {
    let xml = (await newXml({ processName: 'Booking' })).xml;
    xml = await batch(xml, [
      { op: 'add', kind: 'startEvent', name: 'Booking requested', id: 'Event_Requested' },
      { op: 'add', kind: 'transaction', name: 'Book trip', id: 'Activity_BookTrip', after: 'Event_Requested' },
      { op: 'add', kind: 'startEvent', name: 'Start booking', id: 'Event_TxStart', in: 'Activity_BookTrip' },
      { op: 'add', kind: 'serviceTask', name: 'Reserve flight', id: 'Activity_ReserveFlight', after: 'Event_TxStart' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Hotel needed?', id: 'Gateway_HotelNeeded', after: 'Activity_ReserveFlight' },
      { op: 'add', kind: 'endEvent', name: 'Booked', id: 'Event_TxBooked', after: 'Gateway_HotelNeeded', flowName: 'yes' },
      { op: 'add', kind: 'endEvent', name: 'Flight only', id: 'Event_TxFlightOnly', after: 'Gateway_HotelNeeded', flowName: 'no' },
      { op: 'add', kind: 'endEvent', name: 'Trip booked', id: 'Event_TripBooked', after: 'Activity_BookTrip' },
      { op: 'add', kind: 'boundaryEvent:cancel', name: 'Booking cancelled', id: 'Event_Cancelled', on: 'Activity_BookTrip' },
      { op: 'add', kind: 'sendTask', name: 'Inform customer', id: 'Activity_Inform', after: 'Event_Cancelled' },
      { op: 'add', kind: 'endEvent', name: 'Trip cancelled', id: 'Event_TripCancelled', after: 'Activity_Inform' },
    ]);
    // a format command makes the drawing hand-made: the next edit keeps it
    xml = (await applyToXml(xml, [{ op: 'space', after: 'Event_Requested', by: 10 }])).xml;
    const r = await applyToXml(xml, [
      { op: 'add', kind: 'serviceTask', name: 'Reserve car', id: 'Activity_ReserveCar', after: 'Gateway_HotelNeeded', flowName: 'car' },
      { op: 'add', kind: 'endEvent', name: 'Car booked', id: 'Event_CarBooked', after: 'Activity_ReserveCar' },
    ]);
    expect(r.result.layout?.mode).toBe('incremental');
    expect(await added(xml, r.xml)).not.toContain('overlaps');
    const car = boundsOf(r.xml, 'Activity_ReserveCar');
    const cancel = boundsOf(r.xml, 'Event_Cancelled');
    const tx = boundsOf(r.xml, 'Activity_BookTrip');
    // the event stays on the frame's border, 10 px clear of the new task
    expect(cy(cancel)).toBe(tx.y + tx.height);
    expect(cancel.y).toBeGreaterThanOrEqual(car.y + car.height + 10);
  });
});

describe('the local repair after placement (issue #18 (3))', () => {
  it('an existing line a new flow crosses is routed again around the new shape; the run reports it', async () => {
    const xml = fixture('line-next-to-task.bpmn');
    const r = await applyToXml(xml, [{ op: 'add', kind: 'sendTask', name: 'Send offer', id: 'Activity_SendOffer', after: 'Activity_PrepareOffer' }], { force: true });
    expect(await added(xml, r.xml)).toEqual([]);
    expect(r.result.layout?.rerouted).toContain('Flow_CollectDataToArchiveData');
    expect(r.result.layout?.notes).toContain('Flow_CollectDataToArchiveData routed again: it crossed the new Flow_PrepareOfferToSendOffer');
    // the hand drawing is kept otherwise: the new task where a single command puts it, nothing moved
    expect(r.result.layout?.moved ?? []).toEqual([]);
    expect(cy(boundsOf(r.xml, 'Activity_SendOffer'))).toBe(cy(boundsOf(xml, 'Activity_PrepareOffer')));
  });

  it('a chain that still crosses starts at its next row candidate, kept because the score goes down (public scenario)', async () => {
    const xml = readFileSync(join(ROOT, 'tools', 'scenarios', 'agent__o2c.bpmn'), 'utf8');
    const ops = [
      { op: 'add', kind: 'userTask', id: 'Activity_ProbeApprove', name: 'Probe approve', after: 'Activity_RequestPrepayment', before: 'Activity_WaitForPrepayment' },
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_ProbeOk', name: 'Probe ok?', after: 'Activity_ProbeApprove', before: 'Activity_WaitForPrepayment' },
      { op: 'add', kind: 'sendTask', id: 'Activity_ProbeReject', name: 'Probe reject', after: 'Gateway_ProbeOk', flowName: 'no' },
      { op: 'add', kind: 'endEvent', id: 'Event_ProbeRejected', name: 'Probe rejected', after: 'Activity_ProbeReject' },
    ];
    const r = await applyToXml(xml, ops, { force: true });
    expect(r.result.layout?.notes).toContain('Activity_ProbeReject placed at another row: at the first one its path crossed a line');
    const kinds = await added(xml, r.xml);
    expect(kinds).not.toContain('crossings');
    expect(kinds.filter((k) => ['overlaps', 'through', 'outsideLane', 'outsidePool', 'frameIntrusion', 'frameOverlap'].includes(k))).toEqual([]);
    // deterministic: the same input gives the same bytes
    expect((await applyToXml(xml, ops, { force: true })).xml).toBe(r.xml);
  });
});

describe('the findings of the stage B verification (issue #18)', () => {
  const approve = { op: 'add', kind: 'userTask', name: 'Approve purchase', id: 'Activity_ApprovePurchase', flow: 'Flow_0yq6cfd' };
  const timer = { op: 'add', kind: 'boundaryEvent:timer', name: '3 days', id: 'Event_ApprovalOverdue', on: 'Activity_ApprovePurchase', timer: 'P3D', nonInterrupting: true };
  const remind = { op: 'add', kind: 'sendTask', name: 'Send reminder to manager', id: 'Activity_SendApprovalReminder', after: 'Event_ApprovalOverdue' };
  const mainRow = ['StartEvent_1', 'Activity_0k3x9qa', 'Gateway_1hd8x2m', 'Activity_1v0w8zr', 'Event_0q2mb7c'];

  it('a path added to an event on its host\'s top border runs above the host; the hand-drawn row stays where it is', async () => {
    // the plugin's own recovery: the event goes to the top border first, then the reminder is added after it
    let xml = await singles(EVAL, [approve, timer]);
    xml = (await applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], side: 'top' }])).xml;
    const r = await applyToXml(xml, [remind], { force: true });
    expect(await added(xml, r.xml)).toEqual([]);
    expect(r.result.layout?.moved ?? []).toEqual([]);
    for (const id of mainRow) expect(boundsOf(r.xml, id)).toEqual(boundsOf(xml, id));
    const host = boundsOf(r.xml, 'Activity_ApprovePurchase');
    expect(boundsOf(r.xml, 'Activity_SendApprovalReminder').y + 80).toBeLessThanOrEqual(host.y);
  });

  it('a batch with two exception paths from one new timer (one connected later) keeps the row', async () => {
    const ops = [
      approve,
      { op: 'add', kind: 'exclusiveGateway', name: 'Purchase approved?', id: 'Gateway_PurchaseApproved', after: 'Activity_ApprovePurchase', before: 'Activity_1v0w8zr' },
      { op: 'connect', source: 'Gateway_PurchaseApproved', target: 'Activity_0f3j5ny', name: 'no' },
      timer,
      remind,
      { op: 'add', kind: 'endEvent', name: 'Reminder sent', id: 'Event_ReminderSent', after: 'Activity_SendApprovalReminder' },
      { op: 'add', kind: 'serviceTask', name: 'Log overdue approval', id: 'Activity_LogOverdueApproval', in: 'Process_0c4m2wd' },
      { op: 'connect', source: 'Event_ApprovalOverdue', target: 'Activity_LogOverdueApproval' },
      { op: 'add', kind: 'endEvent', name: 'Overdue logged', id: 'Event_OverdueLogged', after: 'Activity_LogOverdueApproval' },
    ];
    const b = await batch(EVAL, ops);
    expect(await added(EVAL, b)).toEqual([]);
    for (const id of ['StartEvent_1', 'Activity_0k3x9qa', 'Event_0q2mb7c']) expect(cy(boundsOf(b, id))).toBe(cy(boundsOf(EVAL, id)));
  });
});

describe('the top-border spot of a boundary path (stage B verification)', () => {
  it('a line running through the spot on the host\'s top border keeps the event below: the line is not broken, no crossing', async () => {
    const xml = fixture('rework-line-over-host.bpmn');
    const ops = [
      { op: 'add', kind: 'boundaryEvent:timer', name: '3 days', id: 'Event_CheckOverdue', on: 'Activity_CheckOrder', timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', name: 'Remind checker', id: 'Activity_RemindChecker', after: 'Event_CheckOverdue' },
      { op: 'add', kind: 'endEvent', name: 'Checker reminded', id: 'Event_CheckerReminded', after: 'Activity_RemindChecker' },
    ];
    for (const xmlAfter of [await batch(xml, ops), await singles(xml, ops)]) {
      expect(await added(xml, xmlAfter)).toEqual([]);
      expect(waypoints(xmlAfter, 'Flow_ShipOrderToEnterOrder')).toEqual(waypoints(xml, 'Flow_ShipOrderToEnterOrder'));
      const host = boundsOf(xmlAfter, 'Activity_CheckOrder');
      expect(cy(boundsOf(xmlAfter, 'Event_CheckOverdue'))).toBe(host.y + host.height);
    }
  });

  it('an event drawn by hand on the bottom border keeps it when its path is added; one a command placed goes to the top', async () => {
    const xml = fixture('timer-on-subprocess.bpmn');
    const path = [
      { op: 'add', kind: 'sendTask', name: 'Escalate case', id: 'Activity_EscalateCase', after: 'Event_CaseOverdue' },
      { op: 'add', kind: 'endEvent', name: 'Case escalated', id: 'Event_CaseEscalated', after: 'Activity_EscalateCase' },
    ];
    const r = await applyToXml(xml, path, { force: true });
    expect(boundsOf(r.xml, 'Event_CaseOverdue')).toEqual(boundsOf(xml, 'Event_CaseOverdue'));
    expect(r.result.layout?.moved ?? []).not.toContain('Event_CaseOverdue');
    expect(r.result.layout?.notes?.join(' ')).not.toContain('top border');
    expect(await added(xml, r.xml)).toEqual([]);
    // the same event added by a command first: it sits where the command put it, and its path goes above the host
    const bare = xml.replace(/<bpmn:boundaryEvent id="Event_CaseOverdue"[\s\S]*?<\/bpmn:boundaryEvent>/, '').replace(/<bpmndi:BPMNShape id="Event_CaseOverdue_di"[\s\S]*?<\/bpmndi:BPMNShape>/, '');
    const added1 = (await applyToXml(bare, [{ op: 'add', kind: 'boundaryEvent:timer', name: '1 week', id: 'Event_CaseOverdue', on: 'Activity_HandleCase', timer: 'P1W' }], { force: true })).xml;
    const s = await singles(added1, path);
    expect(cy(boundsOf(s, 'Event_CaseOverdue'))).toBe(boundsOf(s, 'Activity_HandleCase').y);
    expect(shapes(await batch(bare, [{ op: 'add', kind: 'boundaryEvent:timer', name: '1 week', id: 'Event_CaseOverdue', on: 'Activity_HandleCase', timer: 'P1W' }, ...path]))).toEqual(shapes(s));
  });
});

describe('connections the placement breaks are routed at once (stage B verification)', () => {
  it('an association a splice breaks is routed again before the next op of the batch places its node: the batch gives the shapes of single commands', async () => {
    // a note above the row on "Notify requester": the splice of the approval moves the target's row neighbours, the
    // association breaks; left in its old place it would run through the rows the reminder path weighs
    const xml = EVAL.replace('</bpmn:process>', '  <bpmn:textAnnotation id="TextAnnotation_NotifyNote"><bpmn:text>Mail and chat</bpmn:text></bpmn:textAnnotation>\n    <bpmn:association id="Association_NotifyNote" sourceRef="Activity_0f3j5ny" targetRef="TextAnnotation_NotifyNote" />\n  </bpmn:process>')
      .replace('</bpmndi:BPMNPlane>', '  <bpmndi:BPMNShape id="TextAnnotation_NotifyNote_di" bpmnElement="TextAnnotation_NotifyNote"><dc:Bounds x="420" y="40" width="100" height="30" /></bpmndi:BPMNShape>\n      <bpmndi:BPMNEdge id="Association_NotifyNote_di" bpmnElement="Association_NotifyNote"><di:waypoint x="600" y="300" /><di:waypoint x="470" y="70" /></bpmndi:BPMNEdge>\n    </bpmndi:BPMNPlane>');
    const ops = [
      { op: 'add', kind: 'userTask', name: 'Approve purchase', id: 'Activity_ApprovePurchase', flow: 'Flow_0yq6cfd' },
      { op: 'add', kind: 'boundaryEvent:timer', name: '3 days', id: 'Event_ApprovalOverdue', on: 'Activity_ApprovePurchase', timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', name: 'Send reminder to manager', id: 'Activity_SendApprovalReminder', after: 'Event_ApprovalOverdue' },
      { op: 'add', kind: 'endEvent', name: 'Reminder sent', id: 'Event_ReminderSent', after: 'Activity_SendApprovalReminder' },
    ];
    expect(shapes(await batch(xml, ops))).toEqual(shapes(await singles(xml, ops)));
  });
});

describe('a line along a new shape (stage B verification)', () => {
  it('an existing line a new end event would sit on (its border on the line) is routed again around it', async () => {
    const xml = fixture('claims-two-lanes.bpmn');
    const ops = [
      { op: 'add', kind: 'boundaryEvent:timer', name: '3 days', id: 'Event_RegisterOverdue', on: 'Activity_RegisterClaim', timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', name: 'Remind clerk', id: 'Activity_RemindClerk', after: 'Event_RegisterOverdue' },
      { op: 'add', kind: 'endEvent', name: 'Clerk reminded', id: 'Event_ClerkReminded', after: 'Activity_RemindClerk' },
    ];
    // a segment touching the box (its border included, 1 px around it)
    const touches = (pts: Array<{ x: number; y: number }>, b: { x: number; y: number; width: number; height: number }): boolean =>
      pts.slice(1).some((q, i) => {
        const p = pts[i]!;
        return Math.min(p.x, q.x) <= b.x + b.width + 1 && Math.max(p.x, q.x) >= b.x - 1 && Math.min(p.y, q.y) <= b.y + b.height + 1 && Math.max(p.y, q.y) >= b.y - 1;
      });
    for (const after of [await batch(xml, ops), await singles(xml, ops)]) {
      expect(await added(xml, after)).toEqual([]);
      const end = boundsOf(after, 'Event_ClerkReminded');
      const others = [...after.matchAll(/<bpmndi:BPMNEdge [^>]*bpmnElement="([^"]+)"/g)].map((m) => m[1]!).filter((id) => id !== 'Flow_RemindClerkToClerkReminded');
      for (const id of others) expect(touches(waypoints(after, id), end), id).toBe(false);
    }
  });
});

describe('the guard of the local repair (stage B verification)', () => {
  it('a reroute that trades a crossing with a new flow for one between two drawn lines is undone, even when the score falls', async () => {
    // three flows share the reject line at the bottom; the reminder path's chain crosses the "no" flow of "Approved?",
    // and routing that flow again off the shared line would cross the "no" flow of "In stock?"
    const xml = fixture('shared-reject-line.bpmn');
    const ops = [
      { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', id: 'Event_ApprovalOverdue', on: 'Activity_ApproveOrder', timer: 'P2D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', name: 'Remind approver', id: 'Activity_RemindApprover', after: 'Event_ApprovalOverdue' },
      { op: 'add', kind: 'endEvent', name: 'Approver reminded', id: 'Event_ApproverReminded', after: 'Activity_RemindApprover' },
    ];
    const r = await applyToXml(xml, ops, { force: true });
    const drawn = new Set([...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((m) => m[1]!));
    // the crossings between two flows drawn before the edit
    const among = async (x: string): Promise<string[]> =>
      (await LayoutAnalysis.ofXml(x)).problems.filter((p) => p.kind === 'crossings' && p.ids.every((id) => drawn.has(id))).map((p) => p.ids.join(' x '));
    expect(await among(r.xml)).toEqual(await among(xml));
    expect(r.result.layout?.rerouted ?? []).not.toContain('Flow_ApprovedNo');
  });
});

describe('the cost of the local repair (stage B verification)', () => {
  it('a reroute that still crosses the line it is tried for is not measured (each measurement writes and measures the whole drawing)', async () => {
    const xml = readFileSync(join(ROOT, 'tools', 'scenarios', 'agent__o2c.bpmn'), 'utf8');
    const ops = [
      { op: 'add', kind: 'userTask', id: 'Activity_ProbeApprove', name: 'Probe approve', after: 'Activity_RequestPrepayment', before: 'Activity_WaitForPrepayment' },
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_ProbeOk', name: 'Probe ok?', after: 'Activity_ProbeApprove', before: 'Activity_WaitForPrepayment' },
      { op: 'add', kind: 'sendTask', id: 'Activity_ProbeReject', name: 'Probe reject', after: 'Gateway_ProbeOk', flowName: 'no' },
      { op: 'add', kind: 'endEvent', id: 'Event_ProbeRejected', name: 'Probe rejected', after: 'Activity_ProbeReject' },
    ];
    const lines: string[] = [];
    const r = await applyToXml(xml, ops, { force: true, debug: (l) => lines.push(l) });
    const repair = lines.filter((l) => l.startsWith('[repair]'));
    expect(repair.some((l) => l.endsWith('still crossing, not measured'))).toBe(true);
    // every measured trial is judged (kept or undone); the skipped ones are not
    for (const l of repair.filter((x) => x.includes('not measured'))) expect(l).not.toMatch(/score \d+ ->/);
    // the same drawing as without the debug sink
    expect((await applyToXml(xml, ops, { force: true })).xml).toBe(r.xml);
  });
});
