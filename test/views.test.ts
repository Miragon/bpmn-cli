/**
 * The reading views of large models (step 3): `show --around`, `show <id>
 * --context`, lane membership and message-flow names in `show`, annotations
 * and message flows in `show <id>` (audit #21, #22), and a byte budget per
 * node. All on synthetic models.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { showXml, viewXml } from '../src/api.js';
import { aroundView, elementContext, implementationOf } from '../src/context.js';
import { Doc } from '../src/document.js';
import { buildView, elementDetail } from '../src/view.js';

const ROOT = join(import.meta.dirname, '..');
const CLAIMS = readFileSync(join(ROOT, 'test', 'fixtures', 'views', 'claims.bpmn'), 'utf8');

async function claims(): Promise<Doc> {
  return Doc.fromXml(CLAIMS);
}

const bytes = (text: string): number => Buffer.byteLength(text);

describe('show: lanes inline, message flows with names, collaboration annotations', () => {
  it('every node carries its lane; the lanes section is the tree of names', async () => {
    const text = await showXml(CLAIMS);
    expect(text).toContain('  startEvent:message Event_ClaimReceived "Claim received" [lane=Lane_Office, message Claim] -> Activity_Assess (Flow_ToAssess)');
    expect(text).toContain('  sendTask Activity_SendDecision "Send decision" [lane=Lane_Clerks, camunda:type=external, camunda:topic=send-decision] -> Event_Done (Flow_ToDone)');
    // nodes inside the sub-process are in its lane (shown on the sub-process only)
    expect(text).toMatch(/\n {4}serviceTask Activity_CheckPolicy "Check policy" \[camunda:type=external/);
    expect(text).toContain('  lanes:\n    Lane_Office "Office"\n      Lane_Clerks "Clerks"\n    Lane_Fraud "Fraud team"\n');
    expect(text).not.toMatch(/Lane_Office "Office" \[/);
  });

  it('message flows name their endpoints; the collaboration lists its annotations (#21)', async () => {
    const text = await showXml(CLAIMS);
    expect(text).toContain('  messageFlow Flow_Claim "Claim": Participant_Customer "Customer" -> Event_ClaimReceived "Claim received" [message Claim]');
    expect(text).toContain('  messageFlow Flow_Decision "Decision": Activity_SendDecision "Send decision" -> Participant_Customer "Customer"');
    expect(text).toContain('collaboration Collaboration_Claims\n');
    expect(text).toContain('  annotations:\n    TextAnnotation_Sla "Answer within 5 days" ~ Activity_SendDecision\nprocess Process_Claims');
    const view = buildView(await claims());
    expect(view.collaboration?.annotations).toEqual([{ id: 'TextAnnotation_Sla', text: 'Answer within 5 days', attachedTo: ['Activity_SendDecision'] }]);
    expect(view.collaboration?.messageFlows[1]).toEqual({ id: 'Flow_Decision', source: 'Activity_SendDecision', target: 'Participant_Customer', name: 'Decision', sourceName: 'Send decision', targetName: 'Customer' });
  });
});

describe('show <id>: message flows, annotations and data (#22)', () => {
  it('lists the message flows with the partner, the associated annotations and the data a node reads / writes', async () => {
    const doc = await claims();
    const send = elementDetail(doc, doc.require('Activity_SendDecision'));
    expect(send.messageFlows).toEqual([{ direction: 'out', id: 'Flow_Decision', name: 'Decision', partner: 'Participant_Customer', partnerName: 'Customer' }]);
    expect(send.annotations).toEqual([{ id: 'TextAnnotation_Sla', text: 'Answer within 5 days' }]);
    const start = elementDetail(doc, doc.require('Event_ClaimReceived'));
    expect(start.messageFlows).toEqual([{ direction: 'in', id: 'Flow_Claim', name: 'Claim', message: 'Claim', partner: 'Participant_Customer', partnerName: 'Customer' }]);
    expect(elementDetail(doc, doc.require('Activity_RateDamage')).data).toEqual({ writes: [{ id: 'DataObjectReference_ClaimFile', name: 'Claim file' }] });
    expect(elementDetail(doc, doc.require('Activity_Pay')).data).toEqual({ reads: [{ id: 'DataObjectReference_ClaimFile', name: 'Claim file' }] });
    expect(elementDetail(doc, doc.require('DataObjectReference_ClaimFile')).data).toEqual({ readBy: ['Activity_Pay'], writtenBy: ['Activity_RateDamage'] });
    expect(elementDetail(doc, doc.require('TextAnnotation_Pay')).attachedTo).toEqual(['Activity_Pay']);
    // a pool: the message flows of the pool itself, the partner with its pool
    expect(elementDetail(doc, doc.require('Participant_Customer')).messageFlows).toEqual([
      { direction: 'out', id: 'Flow_Claim', name: 'Claim', message: 'Claim', partner: 'Event_ClaimReceived', partnerName: 'Claim received', pool: 'Participant_Insurer', poolName: 'Insurer' },
      { direction: 'in', id: 'Flow_Decision', name: 'Decision', partner: 'Activity_SendDecision', partnerName: 'Send decision', pool: 'Participant_Insurer', poolName: 'Insurer' },
    ]);
    const text = await showXml(CLAIMS, { id: 'Activity_SendDecision' });
    expect(text).toContain('message flows: out Flow_Decision "Decision" -> Participant_Customer "Customer"');
    expect(text).toContain('annotations: TextAnnotation_Sla "Answer within 5 days"');
    expect(await showXml(CLAIMS, { id: 'Activity_Pay' })).toContain('reads: DataObjectReference_ClaimFile "Claim file"');
  });
});

describe('show --around', () => {
  it('shows the neighbourhood in flow order, nested like show, with what was left out', async () => {
    const text = await showXml(CLAIMS, { around: 'Activity_CheckPolicy' });
    expect(text).toBe(
      [
        'around Activity_CheckPolicy (depth 2): 5 of 16 nodes, 3 of 12 flows; 11 nodes, 9 flows omitted',
        'process Process_Claims "Claims" in Participant_Insurer "Insurer"',
        // the first node of the sub-process leads out to the sub-process
        '  subProcess Activity_Assess "Assess claim" [lane=Lane_Office, expanded] <- Event_ClaimReceived (Flow_ToAssess) -> Gateway_Covered (Flow_ToCovered)',
        '    startEvent Event_AssessStart "Assessment started" -> Activity_CheckPolicy (Flow_ToCheck)',
        '    serviceTask Activity_CheckPolicy "Check policy" [camunda:type=external, camunda:topic=check-policy, io: in policyId; out covered] -> Activity_RateDamage (Flow_ToRate)',
        '    userTask Activity_RateDamage "Rate damage" [camunda:assignee=clerk] -> Event_AssessEnd (Flow_ToAssessEnd)',
        '    endEvent Event_AssessEnd "Assessed"',
        'data:',
        '  dataObject DataObjectReference_ClaimFile "Claim file" (from Activity_RateDamage)',
      ].join('\n'),
    );
  });

  it('depth 1 inside a sub-process: the sub-process is a heading, incoming flows from outside follow <-', async () => {
    const view = aroundView(await claims(), 'Activity_RateDamage', { depth: 1 });
    expect(view.nodes.map((n) => [n.id, n.distance])).toEqual([
      ['Activity_CheckPolicy', 1],
      ['Activity_RateDamage', 0],
      ['Event_AssessEnd', 1],
    ]);
    expect(view.scopes).toEqual([
      { id: 'Process_Claims', kind: 'process', name: 'Claims', inWindow: false },
      { id: 'Activity_Assess', kind: 'subProcess', name: 'Assess claim', parent: 'Process_Claims', lane: 'Lane_Office', inWindow: false },
    ]);
    const text = await showXml(CLAIMS, { around: 'Activity_RateDamage', depth: 1 });
    expect(text).toContain('  in subProcess Activity_Assess "Assess claim" [lane=Lane_Office]:\n    serviceTask Activity_CheckPolicy "Check policy" [camunda:type=external, camunda:topic=check-policy, io: in policyId; out covered] <- Event_AssessStart (Flow_ToCheck) -> Activity_RateDamage (Flow_ToRate)');
  });

  it('a boundary event and its host are neighbours; a sub-process outside the window counts its content', async () => {
    const text = await showXml(CLAIMS, { around: 'Event_FraudSuspected', depth: 1 });
    expect(text).toContain('  subProcess Activity_Assess "Assess claim" [lane=Lane_Office, expanded, content: 4 nodes] <- Event_ClaimReceived (Flow_ToAssess) -> Gateway_Covered (Flow_ToCovered)\n    boundaryEvent:error Event_FraudSuspected "Fraud suspected" [error Fraud (FRAUD)] -> Activity_Investigate (Flow_ToInvestigate)');
    expect(text).toContain('  userTask Activity_Investigate "Investigate fraud" [lane=Lane_Fraud, camunda:candidateGroups=fraud] -> Event_Closed (Flow_ToClosed)');
    // a boundary event whose host is outside the window names it
    const fromInvestigate = await showXml(CLAIMS, { around: 'Activity_Investigate', depth: 1 });
    expect(fromInvestigate).toContain('  boundaryEvent:error Event_FraudSuspected "Fraud suspected" [on Activity_Assess, error Fraud (FRAUD)] -> Activity_Investigate (Flow_ToInvestigate)');
  });

  it('--inner enters a sub-process from outside; a sequence flow centres the window on both its ends', async () => {
    const inner = aroundView(await claims(), 'Activity_Assess', { depth: 1, inner: true });
    expect(inner.nodes.map((n) => n.id)).toEqual(['Event_ClaimReceived', 'Activity_Assess', 'Event_FraudSuspected', 'Event_AssessStart', 'Event_AssessEnd', 'Gateway_Covered']);
    const outer = aroundView(await claims(), 'Activity_Assess', { depth: 1 });
    expect(outer.nodes.map((n) => n.id)).toEqual(['Event_ClaimReceived', 'Activity_Assess', 'Event_FraudSuspected', 'Gateway_Covered']);
    const flow = aroundView(await claims(), 'Flow_Covered', { depth: 0 });
    expect(flow.nodes.map((n) => [n.id, n.distance])).toEqual([
      ['Gateway_Covered', 0],
      ['Activity_Pay', 0],
    ]);
  });

  it('lists the message flows, annotations and data of the window, and the counts add up', async () => {
    const view = aroundView(await claims(), 'Activity_Pay', { depth: 1 });
    expect(view.nodes.map((n) => n.id)).toEqual(['Gateway_Covered', 'Activity_Pay', 'Activity_SendDecision']);
    expect(view.messageFlows.map((m) => m.id)).toEqual(['Flow_Decision']);
    expect(view.annotations).toEqual([
      { id: 'TextAnnotation_Pay', text: 'Paid by bank transfer', attachedTo: ['Activity_Pay'] },
      { id: 'TextAnnotation_Sla', text: 'Answer within 5 days', attachedTo: ['Activity_SendDecision'] },
    ]);
    expect(view.data).toEqual([{ id: 'DataObjectReference_ClaimFile', kind: 'dataObject', name: 'Claim file', from: [], to: ['Activity_Pay'] }]);
    expect(view.shown.nodes + view.omitted.nodes).toBe(16);
    expect(view.shown.flows + view.omitted.flows).toBe(12);
    expect(view.shown).toEqual({ nodes: 3, flows: 3 });
  });

  it('addresses by id only and checks its options', async () => {
    await expect(viewXml(CLAIMS, { around: 'Pay claim' })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    await expect(viewXml(CLAIMS, { around: 'Lane_Office' })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(viewXml(CLAIMS, { around: 'Process_Claims' })).rejects.toMatchObject({ code: 'E_USAGE', details: { hint: expect.stringContaining('--scope') } });
    await expect(viewXml(CLAIMS, { around: 'Activity_Pay', depth: -1 })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(viewXml(CLAIMS, { around: 'Activity_Pay', id: 'Activity_Pay' })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(viewXml(CLAIMS, { around: 'Activity_Pay', scope: 'Process_Claims' })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(viewXml(CLAIMS, { depth: 1 })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(viewXml(CLAIMS, { layout: true, around: 'Activity_Pay' })).rejects.toMatchObject({ code: 'E_USAGE' });
  });
});

describe('show <id> --context', () => {
  it('names where the element is, its inherited lane, its neighbours and what catches it', async () => {
    const text = await showXml(CLAIMS, { id: 'Activity_CheckPolicy', context: true });
    expect(text).toBe(
      [
        'serviceTask Activity_CheckPolicy "Check policy"',
        'implementation: camunda:type=external, camunda:topic=check-policy, io: in policyId; out covered',
        'in: participant Participant_Insurer "Insurer" > process Process_Claims "Claims" > subProcess Activity_Assess "Assess claim"',
        'lane: Lane_Office "Office" (via Activity_Assess)',
        'from: startEvent Event_AssessStart "Assessment started" (Flow_ToCheck)',
        'to: userTask Activity_RateDamage "Rate damage" (Flow_ToRate)',
        'caught by: boundaryEvent:error Event_FraudSuspected "Fraud suspected" on Activity_Assess [error Fraud (FRAUD)] -> Activity_Investigate',
        'event sub-processes: eventSubProcess Activity_OnCancel "Handle cancellation" in Process_Claims [startEvent:message Event_CancelRequested "Cancellation requested" [message Cancel, non-interrupting] -> Event_Cancelled]',
      ].join('\n'),
    );
  });

  it('nested lanes, message flows with partners, annotations, conditions and data', async () => {
    const doc = await claims();
    const send = elementContext(doc, 'Activity_SendDecision');
    expect(send.lane).toEqual({ id: 'Lane_Clerks', name: 'Clerks', parents: [{ id: 'Lane_Office', name: 'Office' }] });
    expect(send.from).toEqual([
      { id: 'Activity_Pay', kind: 'serviceTask', name: 'Pay claim', flow: 'Flow_PaidToDecision' },
      { id: 'Gateway_Covered', kind: 'exclusiveGateway', name: 'Covered?', flow: 'Flow_NotCovered', flowName: 'no', default: true },
    ]);
    expect(send.messageFlows).toEqual([{ direction: 'out', id: 'Flow_Decision', name: 'Decision', partner: 'Participant_Customer', partnerName: 'Customer' }]);
    expect(send.annotations).toEqual([{ id: 'TextAnnotation_Sla', text: 'Answer within 5 days' }]);
    expect(send.caughtBy).toEqual([]);
    const gw = elementContext(doc, 'Gateway_Covered');
    expect(gw.to[0]).toEqual({ id: 'Activity_Pay', kind: 'serviceTask', name: 'Pay claim', flow: 'Flow_Covered', flowName: 'yes', condition: '${covered}' });
    const text = await showXml(CLAIMS, { id: 'Activity_SendDecision', context: true });
    expect(text).toContain('lane: Lane_Clerks "Clerks" (within Lane_Office "Office")');
    expect(text).toContain('message flows: out Flow_Decision "Decision" -> Participant_Customer "Customer"');
    expect(await showXml(CLAIMS, { id: 'Activity_RateDamage', context: true })).toContain('writes: DataObjectReference_ClaimFile "Claim file"');
  });

  it('a boundary event: its host and the host lane; an event sub-process does not catch what is inside it', async () => {
    const doc = await claims();
    const b = elementContext(doc, 'Event_FraudSuspected');
    expect(b.host).toEqual({ id: 'Activity_Assess', kind: 'subProcess', name: 'Assess claim' });
    expect(b.lane).toEqual({ id: 'Lane_Office', name: 'Office', via: 'Activity_Assess' });
    const inside = elementContext(doc, 'Event_CancelRequested');
    expect(inside.ancestors.map((a) => a.id)).toEqual(['Process_Claims', 'Activity_OnCancel']);
    expect(inside.eventSubProcesses).toEqual([]);
    expect(inside.lane).toEqual({ id: 'Lane_Fraud', name: 'Fraud team', via: 'Activity_OnCancel' });
    // the own boundary events of an activity
    const host = elementContext(doc, 'Activity_Assess');
    expect(host.boundary).toEqual([{ id: 'Event_FraudSuspected', kind: 'boundaryEvent:error', name: 'Fraud suspected', trigger: 'error Fraud (FRAUD)', on: 'Activity_Assess', to: ['Activity_Investigate'] }]);
    // a sequence flow: its ends; a pool: where it is
    const flow = elementContext(doc, 'Flow_Covered');
    expect([flow.from.map((f) => f.id), flow.to.map((f) => f.id)]).toEqual([['Gateway_Covered'], ['Activity_Pay']]);
    expect(elementContext(doc, 'Participant_Customer').messageFlows.map((m) => m.id)).toEqual(['Flow_Claim', 'Flow_Decision']);
    await expect(viewXml(CLAIMS, { context: true })).rejects.toMatchObject({ code: 'E_USAGE' });
  });
});

describe('implementation summary', () => {
  it('summarises Camunda 8 and Camunda 7 extension elements in one item per type', async () => {
    const doc = await Doc.fromXml(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="D" targetNamespace="x">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:serviceTask id="Charge" name="Charge">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="charge-card" retries="3" />
        <zeebe:ioMapping><zeebe:input source="=order.total" target="amount" /><zeebe:output source="=r" target="receipt" /></zeebe:ioMapping>
        <zeebe:taskHeaders><zeebe:header key="channel" value="web" /></zeebe:taskHeaders>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:callActivity id="Call" calledElement="billing">
      <bpmn:extensionElements><camunda:in source="a" target="a" /><camunda:in source="b" target="b" /><camunda:executionListener event="start" class="x.Y" /></bpmn:extensionElements>
    </bpmn:callActivity>
  </bpmn:process>
</bpmn:definitions>`);
    expect(implementationOf(doc.require('Charge'))).toEqual({ ext: ['zeebe:taskDefinition type=charge-card retries=3', 'io: in amount; out receipt', 'zeebe:taskHeaders: channel'] });
    expect(implementationOf(doc.require('Call'))).toEqual({ ext: ['camunda:in x2', 'camunda:executionListener event=start class=x.Y'] });
  });
});

/* ------------------------------------------------------------------ */
/* budget: bytes per node                                               */
/* ------------------------------------------------------------------ */

/** A large synthetic model: `n` service tasks in a chain over three lanes, a gateway every tenth node, Camunda 7 attributes. */
function largeModel(n: number): string {
  const nodes: string[] = [];
  const flows: string[] = [];
  const lanes: string[][] = [[], [], []];
  const flow = (from: string, to: string, extra = '', inner = '') => `<bpmn:sequenceFlow id="Flow_${from}_${to}" ${extra}sourceRef="${from}" targetRef="${to}">${inner}</bpmn:sequenceFlow>`;
  let prev = 'Event_Start';
  nodes.push('<bpmn:startEvent id="Event_Start" name="Started" />');
  lanes[0]!.push('Event_Start');
  for (let i = 1; i <= n; i++) {
    const id = `Activity_Step${i}`;
    nodes.push(
      `<bpmn:serviceTask id="${id}" name="Step ${i} of the order" camunda:type="external" camunda:topic="order.step${i}"><bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="orderId">\${orderId}</camunda:inputParameter><camunda:outputParameter name="result${i}">\${r}</camunda:outputParameter></camunda:inputOutput></bpmn:extensionElements></bpmn:serviceTask>`,
    );
    lanes[i % 3]!.push(id);
    flows.push(flow(prev, id, prev.startsWith('Gateway_') ? 'name="yes" ' : ''));
    prev = id;
    if (i % 10 === 0 && i < n) {
      // a check every tenth step: yes continues (default), no loops back five steps
      const gw = `Gateway_Check${i}`;
      nodes.push(`<bpmn:exclusiveGateway id="${gw}" name="Step ${i} ok?" default="Flow_${gw}_Activity_Step${i + 1}" />`);
      lanes[i % 3]!.push(gw);
      flows.push(flow(id, gw));
      flows.push(flow(gw, `Activity_Step${i - 5}`, 'name="no" ', '<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${!ok}</bpmn:conditionExpression>'));
      prev = gw;
    }
  }
  nodes.push('<bpmn:endEvent id="Event_End" name="Done" />');
  lanes[0]!.push('Event_End');
  const chain = [...flows, flow(prev, 'Event_End')];
  const laneXml = lanes.map((members, i) => `<bpmn:lane id="Lane_${i}" name="Team ${i}">${members.map((m) => `<bpmn:flowNodeRef>${m}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="D" targetNamespace="x">
  <bpmn:process id="Process_Order" name="Order" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:laneSet id="LaneSet_1">${laneXml}</bpmn:laneSet>
    ${nodes.join('\n    ')}
    ${chain.join('\n    ')}
  </bpmn:process>
</bpmn:definitions>`;
}

describe('budget: the neighbourhood costs a fixed amount per node, not the model', () => {
  it('on a model of 120 tasks --around (depth 2) stays under 320 bytes per node and a tenth of show', async () => {
    const xml = largeModel(120);
    const full = await showXml(xml);
    const around = await showXml(xml, { around: 'Activity_Step55' });
    const view = await viewXml(xml, { around: 'Activity_Step55' });
    expect(view.nodes.length).toBeGreaterThanOrEqual(5);
    expect(bytes(around) / view.nodes.length).toBeLessThan(320);
    expect(bytes(around)).toBeLessThan(bytes(full) / 10);
    // the cost does not grow with the model: the same window in a model twice as large
    const around2 = await showXml(largeModel(240), { around: 'Activity_Step55' });
    expect(Math.abs(bytes(around2) - bytes(around))).toBeLessThan(40);
    // the context of one element is smaller than its neighbourhood
    expect(bytes(await showXml(xml, { id: 'Activity_Step55', context: true }))).toBeLessThan(bytes(around));
  });

  it('on the claims model --around stays under 320 bytes per node', async () => {
    for (const id of ['Activity_CheckPolicy', 'Gateway_Covered', 'Event_FraudSuspected', 'Activity_SendDecision']) {
      const view = await viewXml(CLAIMS, { around: id });
      const text = await showXml(CLAIMS, { around: id });
      expect(bytes(text) / view.nodes.length, id).toBeLessThan(320);
    }
  });
});
