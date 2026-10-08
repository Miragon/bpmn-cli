import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { is, many, type El } from '../src/model.js';
import { addElement, collapsedIds } from '../src/ops/add.js';
import { createDataAssociation, removeDataAssociation, PLACEHOLDER_PROPERTY } from '../src/ops/artifacts.js';
import { connectElements } from '../src/ops/connect.js';
import { assignLane, laneOf } from '../src/ops/containers.js';
import { applyTrigger, describeTrigger, triggerDetails } from '../src/ops/events.js';
import { splitFlow } from '../src/ops/split.js';
import type { AddOp, ConnectOp, SplitOp } from '../src/ops/types.js';
import { ChangeSet } from '../src/result.js';
import { definitionsXml, docFromXml, linearDoc } from './helpers.js';

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

/** Serialises and re-parses; the result must import without any warning. */
async function roundTrip(doc: Doc): Promise<{ xml: string; doc: Doc }> {
  const xml = await doc.toXml();
  const re = await Doc.fromXml(xml);
  expect(re.importWarnings.map((w) => w.message)).toEqual([]);
  return { xml, doc: re };
}

function add(doc: Doc, op: Omit<AddOp, 'op'>): ChangeSet {
  return addElement(doc, { op: 'add', ...op });
}

function connect(doc: Doc, op: Omit<ConnectOp, 'op'>): ChangeSet {
  return connectElements(doc, { op: 'connect', ...op });
}

function ids(els: El[]): string[] {
  return els.map((e) => e.get<string>('id'));
}

function flowIds(doc: Doc, scopeId = 'Process_1'): string[] {
  return ids(doc.flowElements(doc.require(scopeId)));
}

function edge(doc: Doc, flowId: string): string {
  const f = doc.require(flowId);
  return `${f.get<El>('sourceRef').get('id')}->${f.get<El>('targetRef').get('id')}`;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? 'NO_CODE';
  }
  return 'NO_ERROR';
}

const WITH_GATEWAY = definitionsXml(`
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="GW" name="Ok?"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:userTask id="Task_A" name="Do A"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="Loose" name="Loose" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="GW" />
    <bpmn:sequenceFlow id="F2" sourceRef="GW" targetRef="Task_A" name="yes" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_A" targetRef="End" />`);

const WITH_JOIN = definitionsXml(`
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="Fork"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2a</bpmn:outgoing><bpmn:outgoing>F2b</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:task id="A"><bpmn:incoming>F2a</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:task id="B"><bpmn:incoming>F2b</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing></bpmn:task>
    <bpmn:parallelGateway id="Join"><bpmn:incoming>F3</bpmn:incoming><bpmn:incoming>F4</bpmn:incoming><bpmn:outgoing>F5</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:endEvent id="End"><bpmn:incoming>F5</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="Loose" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Fork" />
    <bpmn:sequenceFlow id="F2a" sourceRef="Fork" targetRef="A" />
    <bpmn:sequenceFlow id="F2b" sourceRef="Fork" targetRef="B" />
    <bpmn:sequenceFlow id="F3" sourceRef="A" targetRef="Join" />
    <bpmn:sequenceFlow id="F4" sourceRef="B" targetRef="Join" />
    <bpmn:sequenceFlow id="F5" sourceRef="Join" targetRef="End" />`);

const WITH_LANES = definitionsXml(`
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Sales" name="Sales"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>Task_A</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane_Backoffice" name="Backoffice"><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_A" name="Do A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="End" />`);

/* ------------------------------------------------------------------ */
/* add: placement                                                       */
/* ------------------------------------------------------------------ */

describe('add: placement modes', () => {
  it('after a node with one outgoing flow splices into it', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'userTask', name: 'Do B', after: 'Task_A' });
    expect(cs.created[0]).toMatchObject({ id: 'Activity_DoB', kind: 'userTask', name: 'Do B', detail: 'after Task_A' });
    expect(edge(doc, 'F2')).toBe('Task_A->Activity_DoB');
    const second = cs.created.find((c) => c.kind === 'sequenceFlow')!;
    expect(edge(doc, second.id)).toBe('Activity_DoB->End');
    expect(flowIds(doc)).toEqual(['Start', 'Task_A', 'End', 'F1', 'F2', 'Activity_DoB', second.id]);
    expect(cs.notes.some((n) => n.includes('inserted between Task_A and End'))).toBe(true);
    await roundTrip(doc);
  });

  it('after a gateway or an unconnected node appends a new branch', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = add(doc, { kind: 'serviceTask', name: 'Reject', after: 'GW', flowName: 'no', default: true });
    const flow = cs.created.find((c) => c.kind === 'sequenceFlow')!;
    expect(edge(doc, flow.id)).toBe('GW->Activity_Reject');
    expect(doc.require('GW').get<El>('default').get('id')).toBe(flow.id);
    expect(ids(doc.outgoing(doc.require('GW')))).toEqual(['F2', flow.id]);
    // declaration order: new node and flow right after the gateway's last flow
    expect(flowIds(doc).indexOf('Activity_Reject')).toBe(flowIds(doc).indexOf('F2') + 1);

    const cs2 = add(doc, { kind: 'task', name: 'After loose', after: 'Loose' });
    const f2 = cs2.created.find((c) => c.kind === 'sequenceFlow')!;
    expect(edge(doc, f2.id)).toBe('Loose->Activity_AfterLoose');
    await roundTrip(doc);
  });

  it('after a node with several outgoing flows fails with candidates', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    add(doc, { kind: 'task', name: 'X', after: 'GW' });
    // Task_A -> End plus Task_A -> Loose makes Task_A ambiguous
    connect(doc, { source: 'Task_A', target: 'Loose' });
    let err: { code?: string; details?: { candidates?: string[] } } | undefined;
    try {
      add(doc, { kind: 'task', name: 'Y', after: 'Task_A' });
    } catch (e) {
      err = e as typeof err;
    }
    expect(err?.code).toBe('E_HAS_SUCCESSOR');
    expect(err?.details?.candidates?.length).toBe(2);
  });

  it('before a node splices into its incoming flow', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'task', name: 'Prep', before: 'Task_A' });
    expect(cs.created[0]!.detail).toBe('before Task_A');
    expect(edge(doc, 'F1')).toBe('Start->Activity_Prep');
    expect(ids(doc.outgoing(doc.require('Activity_Prep')))).toHaveLength(1);
    expect(edge(doc, ids(doc.outgoing(doc.require('Activity_Prep')))[0]!)).toBe('Activity_Prep->Task_A');
    // declared right after its (spliced) incoming flow F1
    expect(flowIds(doc).indexOf('Activity_Prep')).toBe(flowIds(doc).indexOf('F1') + 1);
    await roundTrip(doc);
  });

  it('before a join gateway or an unconnected node prepends a new incoming flow', async () => {
    const doc = await docFromXml(WITH_JOIN);
    const cs = add(doc, { kind: 'task', name: 'Third', before: 'Join' });
    const flow = cs.created.find((c) => c.kind === 'sequenceFlow')!;
    expect(edge(doc, flow.id)).toBe('Activity_Third->Join');
    expect(ids(doc.incoming(doc.require('Join')))).toEqual(['F3', 'F4', flow.id]);
    expect(edge(doc, 'F3')).toBe('A->Join');
    const cs2 = add(doc, { kind: 'task', name: 'Pre loose', before: 'Loose' });
    expect(edge(doc, cs2.created.find((c) => c.kind === 'sequenceFlow')!.id)).toBe('Activity_PreLoose->Loose');
    await roundTrip(doc);
  });

  it('before a start event is rejected', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'task', name: 'Nope', before: 'Start' }))).toBe('E_INVALID_TARGET');
  });

  it('between two nodes splices into the flow between them', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'scriptTask', name: 'Mid', after: 'Start', before: 'Task_A' });
    expect(cs.created[0]!.detail).toBe('between Start and Task_A');
    expect(edge(doc, 'F1')).toBe('Start->Activity_Mid');
    expect(codeOf(() => add(doc, { kind: 'task', name: 'No', after: 'Start', before: 'End' }))).toBe('E_NO_FLOW');
    await roundTrip(doc);
  });

  it('flow splices into a given sequence flow', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'manualTask', name: 'Check', flow: 'F2', condition: '${ok}' });
    expect(edge(doc, 'F2')).toBe('Task_A->Activity_Check');
    expect(doc.require('F2').get<El>('conditionExpression').get('body')).toBe('${ok}');
    expect(cs.created[0]!.detail).toBe('in flow F2');
    await roundTrip(doc);
  });

  it('in places an unconnected node in a scope (process, sub-process, participant)', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'subProcess', name: 'Sub', after: 'Task_A' });
    const cs = add(doc, { kind: 'startEvent', name: 'Inner start', in: 'Activity_Sub' });
    expect(cs.created[0]!.detail).toBe('in Activity_Sub');
    expect(ids(doc.flowElements(doc.require('Activity_Sub')))).toEqual(['Event_InnerStart']);
    const cs2 = add(doc, { kind: 'task', name: 'Orphan' });
    expect(cs2.created[0]!.detail).toBe('in Process_1');
    expect(doc.incoming(doc.require('Activity_Orphan'))).toHaveLength(0);
    await roundTrip(doc);
  });

  it('to connects the new node onward and warns about implicit joins', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = add(doc, { kind: 'task', name: 'Alt', after: 'GW', to: 'End' });
    expect(cs.created.filter((c) => c.kind === 'sequenceFlow')).toHaveLength(2);
    expect(cs.warnings.map((w) => w.code)).toContain('W_IMPLICIT_JOIN');
    await roundTrip(doc);
  });

  it('on attaches boundary events (inheriting the lane of the host)', async () => {
    const doc = await docFromXml(WITH_LANES);
    const cs = add(doc, { kind: 'boundaryEvent:timer', name: 'Too late', on: 'Task_A', timer: 'PT2D' });
    const be = doc.require('Event_TooLate');
    expect(cs.created[0]).toMatchObject({ id: 'Event_TooLate', kind: 'boundaryEvent:timer', detail: 'on Task_A' });
    expect(be.get<El>('attachedToRef').get('id')).toBe('Task_A');
    expect(ids(doc.boundaryEventsOf(doc.require('Task_A')))).toEqual(['Event_TooLate']);
    expect(laneOf(doc, be)?.get('id')).toBe('Lane_Sales');
    expect(flowIds(doc).indexOf('Event_TooLate')).toBe(flowIds(doc).indexOf('Task_A') + 1);
    expect(cs.changed.some((c) => c.id === 'Event_TooLate' && c.detail === 'lane Lane_Sales')).toBe(true);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:boundaryEvent id="Event_TooLate" name="Too late" attachedToRef="Task_A">/);
    expect(xml).toMatch(/<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT2D<\/bpmn:timeDuration>/);
  });

  it('rejects boundary events without --on and --on for non-boundary nodes', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent:timer', after: 'Task_A' }))).toBe('E_INVALID_PLACEMENT');
    expect(codeOf(() => add(doc, { kind: 'task', on: 'Task_A' }))).toBe('E_INVALID_PLACEMENT');
  });

  it('inherits the lane of the after/before anchor', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'task', name: 'Next', after: 'Task_A' });
    expect(laneOf(doc, doc.require('Activity_Next'))?.get('id')).toBe('Lane_Sales');
    add(doc, { kind: 'task', name: 'Last', before: 'End' });
    expect(laneOf(doc, doc.require('Activity_Last'))?.get('id')).toBe('Lane_Backoffice');
    add(doc, { kind: 'task', name: 'Explicit', after: 'Activity_Last', lane: 'Lane_Sales' });
    expect(laneOf(doc, doc.require('Activity_Explicit'))?.get('id')).toBe('Lane_Sales');
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* add: ids, ifAbsent, kinds                                            */
/* ------------------------------------------------------------------ */

describe('add: ids and options', () => {
  it('uses Prefix_Slug ids, numeric ids for unnamed nodes and warns on suffixes', async () => {
    const doc = await linearDoc();
    expect(add(doc, { kind: 'task', name: 'Check invoice', in: 'Process_1' }).created[0]!.id).toBe('Activity_CheckInvoice');
    const cs = add(doc, { kind: 'task', name: 'Check invoice', in: 'Process_1' });
    expect(cs.created[0]!.id).toBe('Activity_CheckInvoice_2');
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_ID_SUFFIXED']);
    expect(add(doc, { kind: 'task', in: 'Process_1' }).created[0]!.id).toBe('Activity_1');
    expect(add(doc, { kind: 'xor', name: 'Invoice ok?', in: 'Process_1' }).created[0]!.id).toBe('Gateway_InvoiceOk');
    expect(add(doc, { kind: 'bpmn:StartEvent', name: 'Order received', in: 'Process_1' }).created[0]!.id).toBe('Event_OrderReceived');
    await roundTrip(doc);
  });

  it('honours explicit ids and rejects duplicates / invalid ids', async () => {
    const doc = await linearDoc();
    expect(add(doc, { kind: 'task', id: 'MyTask', in: 'Process_1' }).created[0]!.id).toBe('MyTask');
    expect(codeOf(() => add(doc, { kind: 'task', id: 'MyTask', in: 'Process_1' }))).toBe('E_DUPLICATE_ID');
    expect(codeOf(() => add(doc, { kind: 'task', id: '1bad', in: 'Process_1' }))).toBe('E_INVALID_ID');
  });

  it('ifAbsent with an existing id is a no-op', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'userTask', id: 'Task_A', ifAbsent: true, after: 'Start' });
    expect(cs.isEmpty).toBe(true);
    expect(cs.notes[0]).toMatch(/already exists/);
    expect(cs.warnings).toHaveLength(0);
    const cs2 = add(doc, { kind: 'serviceTask', id: 'Task_A', ifAbsent: true });
    expect(cs2.warnings.map((w) => w.code)).toEqual(['W_KIND_MISMATCH']);
    const cs3 = add(doc, { kind: 'task', id: 'Task_B', name: 'B', ifAbsent: true, after: 'Task_A' });
    expect(cs3.created[0]!.id).toBe('Task_B');
  });

  it('rejects unknown and unsupported kinds', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'complexGateway' }))).toBe('E_UNSUPPORTED_KIND');
    expect(codeOf(() => add(doc, { kind: 'userTsk' }))).toBe('E_UNKNOWN_KIND');
    expect(codeOf(() => add(doc, { kind: 'userTask:timer' }))).toBe('E_INVALID_TRIGGER');
  });

  it('adds documentation and records collapse requests for sub-processes', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'subProcess', name: 'Details', after: 'Task_A', collapsed: true, doc: 'Explains it' });
    expect(collapsedIds(doc)).toEqual(['Activity_Details']);
    expect(many(doc.require('Activity_Details'), 'documentation')[0]!.get('text')).toBe('Explains it');
    const cs = add(doc, { kind: 'task', name: 'T', in: 'Process_1', collapsed: true });
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:documentation>Explains it<\/bpmn:documentation>/);
  });

  it('eventSubProcess sets triggeredByEvent', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'eventSubProcess', name: 'Handle errors' });
    expect(cs.created[0]!.kind).toBe('eventSubProcess');
    expect(doc.require('Activity_HandleErrors').get('triggeredByEvent')).toBe(true);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:subProcess id="Activity_HandleErrors" name="Handle errors" triggeredByEvent="true"/);
  });
});

/* ------------------------------------------------------------------ */
/* triggers                                                             */
/* ------------------------------------------------------------------ */

describe('triggers', () => {
  it('creates root messages by name and reuses them', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'startEvent:message', name: 'Order received', message: 'Order received', in: 'Process_1' });
    expect(cs.created.map((c) => c.id)).toEqual(['Event_OrderReceived', 'Message_OrderReceived']);
    expect(cs.created[1]).toMatchObject({ kind: 'message', name: 'Order received' });
    add(doc, { kind: 'intermediateCatchEvent:message', name: 'Wait', message: 'Order received', after: 'Task_A' });
    add(doc, { kind: 'endEvent:message', name: 'Notify', message: 'Message_OrderReceived', in: 'Process_1' });
    expect(doc.rootElementsOfType('bpmn:Message')).toHaveLength(1);
    expect(describeTrigger(doc.require('Event_Wait'))).toBe('message Order received');
    expect(triggerDetails(doc.require('Event_Notify'))).toEqual({ trigger: 'message', message: { id: 'Message_OrderReceived', name: 'Order received' } });
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:message id="Message_OrderReceived" name="Order received" \/>/);
    expect(xml).toMatch(/<bpmn:messageEventDefinition messageRef="Message_OrderReceived" \/>/);
  });

  it('creates errors with codes, signals and escalations (reused by name)', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'endEvent:error', name: 'Failed', error: 'PaymentFailed', errorCode: 'PAY-001', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent:error', name: 'Catch', on: 'Task_A', error: 'PaymentFailed' });
    expect(doc.rootElementsOfType('bpmn:Error')).toHaveLength(1);
    expect(describeTrigger(doc.require('Event_Catch'))).toBe('error PaymentFailed (PAY-001)');
    expect(triggerDetails(doc.require('Event_Catch'))).toEqual({ trigger: 'error', error: { id: 'Error_PaymentFailed', name: 'PaymentFailed', code: 'PAY-001' } });

    add(doc, { kind: 'endEvent:signal', name: 'Sig', signal: 'Done', in: 'Process_1' });
    add(doc, { kind: 'startEvent:signal', name: 'Sig start', signal: 'Done', in: 'Process_1' });
    expect(doc.rootElementsOfType('bpmn:Signal').map((s) => s.get('id'))).toEqual(['Signal_Done']);
    expect(describeTrigger(doc.require('Event_SigStart'))).toBe('signal Done');

    add(doc, { kind: 'endEvent:escalation', name: 'Esc', escalation: 'Too slow', escalationCode: 'SLOW', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent:escalation', name: 'Esc catch', on: 'Task_A', escalation: 'Too slow', nonInterrupting: true });
    expect(doc.rootElementsOfType('bpmn:Escalation')).toHaveLength(1);
    expect(describeTrigger(doc.require('Event_EscCatch'))).toBe('escalation Too slow (SLOW)');
    expect(triggerDetails(doc.require('Event_EscCatch'))?.nonInterrupting).toBe(true);

    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:error id="Error_PaymentFailed" name="PaymentFailed" errorCode="PAY-001" \/>/);
    expect(xml).toMatch(/<bpmn:escalation id="Escalation_TooSlow" name="Too slow" escalationCode="SLOW" \/>/);
    expect(xml).toMatch(/<bpmn:boundaryEvent id="Event_EscCatch" name="Esc catch" cancelActivity="false" attachedToRef="Task_A">/);
  });

  it('classifies timers and accepts an override', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'startEvent:timer', name: 'Cycle', timer: 'R/PT1H', in: 'Process_1' });
    add(doc, { kind: 'intermediateCatchEvent:timer', name: 'Duration', timer: 'PT5M', after: 'Task_A' });
    add(doc, { kind: 'startEvent:timer', name: 'Date', timer: '2030-01-01T00:00:00Z', in: 'Process_1' });
    add(doc, { kind: 'startEvent:timer', name: 'Cron', timer: '0 0 * * *', timerKind: 'cycle', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent', name: 'Inferred', on: 'Task_A', timer: 'PT1H' });
    expect(triggerDetails(doc.require('Event_Cycle'))?.timer).toEqual({ kind: 'cycle', value: 'R/PT1H' });
    expect(triggerDetails(doc.require('Event_Duration'))?.timer).toEqual({ kind: 'duration', value: 'PT5M' });
    expect(triggerDetails(doc.require('Event_Date'))?.timer).toEqual({ kind: 'date', value: '2030-01-01T00:00:00Z' });
    expect(triggerDetails(doc.require('Event_Cron'))?.timer).toEqual({ kind: 'cycle', value: '0 0 * * *' });
    expect(describeTrigger(doc.require('Event_Inferred'))).toBe('PT1H');
    expect(describeTrigger(doc.require('Event_Duration'))).toBe('PT5M');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R\/PT1H<\/bpmn:timeCycle>/);
    expect(xml).toMatch(/<bpmn:timeDate xsi:type="bpmn:tFormalExpression">2030-01-01T00:00:00Z<\/bpmn:timeDate>/);
  });

  it('handles conditional, link, compensate, terminate and cancel triggers', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'intermediateCatchEvent:conditional', name: 'Cond', when: '${x > 1}', after: 'Task_A' });
    add(doc, { kind: 'intermediateThrowEvent:link', name: 'Jump', link: 'L1', in: 'Process_1' });
    add(doc, { kind: 'intermediateCatchEvent:link', name: 'L1', in: 'Process_1' });
    add(doc, { kind: 'endEvent:terminate', name: 'Stop', in: 'Process_1' });
    add(doc, { kind: 'endEvent:compensate', name: 'Comp', in: 'Process_1' });
    add(doc, { kind: 'endEvent:cancel', name: 'Cancel', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent:compensate', name: 'Undo', on: 'Task_A' });
    expect(describeTrigger(doc.require('Event_Cond'))).toBe('condition ${x > 1}');
    expect(describeTrigger(doc.require('Event_Jump'))).toBe('link L1');
    expect(describeTrigger(doc.require('Event_L1'))).toBe('link L1');
    expect(describeTrigger(doc.require('Event_Stop'))).toBe('terminate');
    expect(describeTrigger(doc.require('Event_Comp'))).toBe('compensate');
    expect(describeTrigger(doc.require('Event_Cancel'))).toBe('cancel');
    expect(describeTrigger(doc.require('Event_Undo'))).toBe('compensate');
    expect(describeTrigger(doc.require('Start'))).toBe('');
    expect(triggerDetails(doc.require('Task_A'))).toBeUndefined();
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:linkEventDefinition name="L1" \/>/);
    expect(xml).toMatch(/<bpmn:terminateEventDefinition \/>/);
  });

  it('enforces non-interrupting rules', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'boundaryEvent:timer', name: 'NI', on: 'Task_A', timer: 'PT1H', nonInterrupting: true });
    expect(cs.created[0]!.kind).toBe('boundaryEvent:timer');
    expect(doc.require('Event_NI').get('cancelActivity')).toBe(false);
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent:error', on: 'Task_A', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent:cancel', on: 'Task_A', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'startEvent:message', message: 'M', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'endEvent', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    // retriggering a non-interrupting boundary event to error makes it interrupting again
    applyTrigger(doc, doc.require('Event_NI'), 'error', { error: 'E' });
    expect(doc.require('Event_NI').get('cancelActivity')).toBe(true);
    applyTrigger(doc, doc.require('Event_NI'), 'timer', { timer: 'PT1H', nonInterrupting: true });
    applyTrigger(doc, doc.require('Event_NI'), 'timer', { timer: 'PT1H', nonInterrupting: false });
    expect(doc.require('Event_NI').get('cancelActivity')).toBe(true);
    await roundTrip(doc);
  });

  it('restricts start event triggers to event sub-processes and requires them there', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'startEvent:error', error: 'E', in: 'Process_1' }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'startEvent:escalation', escalation: 'E', in: 'Process_1' }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'startEvent:compensate', in: 'Process_1' }))).toBe('E_INVALID_TRIGGER');
    add(doc, { kind: 'eventSubProcess', name: 'On error' });
    expect(codeOf(() => add(doc, { kind: 'startEvent', in: 'Activity_OnError' }))).toBe('E_TRIGGER_REQUIRED');
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent', on: 'Task_A' }))).toBe('E_TRIGGER_REQUIRED');
    const cs = add(doc, { kind: 'startEvent:error', name: 'Err', error: 'Boom', errorCode: 'B1', in: 'Activity_OnError' });
    expect(cs.created.map((c) => c.id)).toEqual(['Event_Err', 'Error_Boom']);
    add(doc, { kind: 'startEvent:message', name: 'Msg', message: 'Ping', nonInterrupting: true, in: 'Activity_OnError' });
    expect(doc.require('Event_Msg').get('isInterrupting')).toBe(false);
    expect(triggerDetails(doc.require('Event_Msg'))?.nonInterrupting).toBe(true);
    expect(codeOf(() => add(doc, { kind: 'startEvent:error', error: 'Boom', nonInterrupting: true, in: 'Activity_OnError' }))).toBe('E_INVALID_TRIGGER');
    add(doc, { kind: 'startEvent:timer', name: 'Tick', timer: 'R/PT1H', in: 'Activity_OnError' });
    add(doc, { kind: 'startEvent:signal', name: 'Sig', signal: 'S', in: 'Activity_OnError' });
    add(doc, { kind: 'startEvent:conditional', name: 'Cnd', when: '${a}', in: 'Activity_OnError' });
    add(doc, { kind: 'startEvent:escalation', name: 'Esc', escalation: 'Up', in: 'Activity_OnError' });
    add(doc, { kind: 'startEvent:compensate', name: 'Cmp', in: 'Activity_OnError' });
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:startEvent id="Event_Msg" name="Msg" isInterrupting="false">/);
    expect(xml).toMatch(/<bpmn:errorEventDefinition errorRef="Error_Boom" \/>/);
  });

  it('warns about trigger options on non-events and switches triggers to none', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'userTask', name: 'T', in: 'Process_1', timer: 'PT1H' });
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    add(doc, { kind: 'startEvent:message', name: 'M', message: 'X', in: 'Process_1' });
    applyTrigger(doc, doc.require('Event_M'), 'none');
    expect(many(doc.require('Event_M'), 'eventDefinitions')).toHaveLength(0);
    expect(describeTrigger(doc.require('Event_M'))).toBe('');
    expect(codeOf(() => applyTrigger(doc, doc.require('Task_A'), 'timer'))).toBe('E_WRONG_KIND');
    expect(codeOf(() => applyTrigger(doc, doc.require('Start'), 'terminate'))).toBe('E_INVALID_TRIGGER');
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* participants                                                         */
/* ------------------------------------------------------------------ */

describe('participants', () => {
  it('wraps the single process, then creates new processes and black boxes', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'participant', name: 'Shop' });
    expect(cs.created.map((c) => [c.id, c.kind])).toEqual([
      ['Collaboration_1', 'collaboration'],
      ['Participant_Shop', 'participant'],
    ]);
    expect(cs.created[1]!.detail).toBe('wraps process Process_1');
    expect(ids(many(doc.definitions, 'rootElements'))).toEqual(['Collaboration_1', 'Process_1']);
    expect(doc.require('Participant_Shop').get<El>('processRef').get('id')).toBe('Process_1');

    const cs2 = add(doc, { kind: 'pool', name: 'Customer' });
    expect(cs2.created.map((c) => c.id)).toEqual(['Process_Customer', 'Participant_Customer']);
    const proc = doc.require('Process_Customer');
    expect(proc.get('isExecutable')).toBe(false);
    expect(doc.participantOf(proc)?.get('id')).toBe('Participant_Customer');
    expect(ids(many(doc.definitions, 'rootElements'))).toEqual(['Collaboration_1', 'Process_1', 'Process_Customer']);

    const cs3 = add(doc, { kind: 'participant', name: 'Bank', blackBox: true });
    expect(cs3.created.map((c) => c.id)).toEqual(['Participant_Bank']);
    expect(doc.require('Participant_Bank').get('processRef')).toBeUndefined();
    expect(ids(doc.participants())).toEqual(['Participant_Shop', 'Participant_Customer', 'Participant_Bank']);

    expect(codeOf(() => add(doc, { kind: 'participant', name: 'X', process: 'Process_1' }))).toBe('E_PROCESS_BOUND');
    expect(codeOf(() => add(doc, { kind: 'participant', name: 'X', after: 'Task_A' }))).toBe('E_INVALID_PLACEMENT');
    expect(codeOf(() => add(doc, { kind: 'participant', name: 'X', blackBox: true, process: 'Process_1' }))).toBe('E_INVALID_VALUE');

    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:collaboration id="Collaboration_1">\s*<bpmn:participant id="Participant_Shop" name="Shop" processRef="Process_1" \/>/);
    expect(xml).toMatch(/<bpmn:participant id="Participant_Bank" name="Bank" \/>/);
  });

  it('binds an explicitly named unbound process', async () => {
    const doc = await docFromXml(
      definitionsXml('<bpmn:startEvent id="S1" />', { extraRoots: '<bpmn:process id="Process_2" isExecutable="false"><bpmn:startEvent id="S2" /></bpmn:process>' }),
    );
    expect(codeOf(() => add(doc, { kind: 'participant', name: 'A' }))).toBe('E_AMBIGUOUS_SCOPE');
    add(doc, { kind: 'participant', name: 'A', process: 'Process_1' });
    add(doc, { kind: 'participant', name: 'B', process: 'Process_2' });
    expect(doc.participantOf(doc.require('Process_2'))?.get('id')).toBe('Participant_B');
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* lanes                                                                */
/* ------------------------------------------------------------------ */

describe('lanes', () => {
  it('creates the lane set, assigns members and warns without a pool', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'lane', name: 'Sales', members: ['Start', 'Task_A'] });
    expect(cs.created[0]).toMatchObject({ id: 'Lane_Sales', kind: 'lane', name: 'Sales', detail: 'in Process_1' });
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_LANES_WITHOUT_POOL']);
    expect(cs.changed.map((c) => `${c.id}:${c.detail}`)).toEqual(['Start:lane Lane_Sales', 'Task_A:lane Lane_Sales']);
    expect(ids(many(doc.require('Process_1'), 'laneSets'))).toEqual(['LaneSet_1']);
    expect(ids(many(doc.require('Lane_Sales'), 'flowNodeRef'))).toEqual(['Start', 'Task_A']);

    add(doc, { kind: 'participant', name: 'Shop' });
    const cs2 = add(doc, { kind: 'lane', name: 'Backoffice', in: 'Participant_Shop', members: ['End', 'Task_A'] });
    expect(cs2.warnings).toHaveLength(0);
    expect(ids(many(doc.require('Lane_Sales'), 'flowNodeRef'))).toEqual(['Start']);
    expect(ids(many(doc.require('Lane_Backoffice'), 'flowNodeRef'))).toEqual(['End', 'Task_A']);
    expect(laneOf(doc, doc.require('Task_A'))?.get('id')).toBe('Lane_Backoffice');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:laneSet id="LaneSet_1">\s*<bpmn:lane id="Lane_Sales" name="Sales">\s*<bpmn:flowNodeRef>Start<\/bpmn:flowNodeRef>/);
  });

  it('nests lanes inside a lane, moving the parent members into the first child', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'participant', name: 'Shop' });
    const cs = add(doc, { kind: 'lane', name: 'Inbound', in: 'Lane_Sales' });
    expect(cs.created[0]!.detail).toBe('in lane Lane_Sales');
    expect(cs.notes.some((n) => n.includes('moved 2 member(s)'))).toBe(true);
    expect(ids(many(doc.require('Lane_Sales'), 'flowNodeRef'))).toEqual([]);
    expect(ids(many(doc.require('Lane_Inbound'), 'flowNodeRef'))).toEqual(['Start', 'Task_A']);
    add(doc, { kind: 'lane', name: 'Outbound', in: 'Lane_Sales', members: ['Task_A'] });
    expect(ids(many(doc.require('Lane_Inbound'), 'flowNodeRef'))).toEqual(['Start']);
    expect(laneOf(doc, doc.require('Task_A'))?.get('id')).toBe('Lane_Outbound');
    expect(ids(doc.allLanes(doc.require('Process_1')))).toEqual(['Lane_Sales', 'Lane_Inbound', 'Lane_Outbound', 'Lane_Backoffice']);
    // parent lanes with children cannot take members directly
    expect(codeOf(() => assignLane(doc, doc.require('End'), doc.require('Lane_Sales'), new ChangeSet()))).toBe('E_INVALID_LANE_MEMBERSHIP');
    // nodes added after a member inherit the nested lane
    add(doc, { kind: 'task', name: 'Ship', after: 'Task_A' });
    expect(laneOf(doc, doc.require('Activity_Ship'))?.get('id')).toBe('Lane_Outbound');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:lane id="Lane_Sales" name="Sales">\s*<bpmn:childLaneSet id="LaneSet_2">\s*<bpmn:lane id="Lane_Inbound" name="Inbound">/);
  });

  it('assignLane moves nodes with their boundary events and rejects sub-process children', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'boundaryEvent:timer', name: 'BE', on: 'Task_A', timer: 'PT1H' });
    const cs = new ChangeSet();
    assignLane(doc, doc.require('Task_A'), doc.require('Lane_Backoffice'), cs);
    expect(ids(many(doc.require('Lane_Backoffice'), 'flowNodeRef'))).toEqual(['End', 'Task_A', 'Event_BE']);
    expect(ids(many(doc.require('Lane_Sales'), 'flowNodeRef'))).toEqual(['Start']);
    assignLane(doc, doc.require('Task_A'), undefined, cs);
    expect(doc.lanesOf(doc.require('Task_A'))).toHaveLength(0);
    expect(doc.lanesOf(doc.require('Event_BE'))).toHaveLength(0);
    expect(cs.changed.some((c) => c.id === 'Task_A' && c.detail === 'removed from lanes')).toBe(true);

    add(doc, { kind: 'subProcess', name: 'Sub', after: 'Task_A' });
    add(doc, { kind: 'task', name: 'Inner', in: 'Activity_Sub' });
    expect(codeOf(() => add(doc, { kind: 'task', name: 'Inner2', after: 'Activity_Inner', lane: 'Lane_Sales' }))).toBe('E_INVALID_LANE_MEMBERSHIP');
    expect(codeOf(() => add(doc, { kind: 'lane', name: 'Nope', in: 'Activity_Sub' }))).toBe('E_INVALID_SCOPE');
    // the sub-process itself can be a member and inner nodes silently inherit nothing
    const cs2 = add(doc, { kind: 'task', name: 'Inner3', after: 'Activity_Inner' });
    expect(cs2.changed).toHaveLength(0);
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* data & artifacts                                                     */
/* ------------------------------------------------------------------ */

describe('data objects, stores and annotations', () => {
  it('creates data objects with a backing bpmn:DataObject and data associations in both directions', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'dataObject', name: 'Order' });
    expect(cs.created[0]).toMatchObject({ id: 'DataObjectReference_Order', kind: 'dataObject', name: 'Order' });
    expect(doc.require('DataObjectReference_Order').get<El>('dataObjectRef').get('id')).toBe('DataObject_Order');
    expect(is(doc.require('DataObject_Order'), 'bpmn:DataObject')).toBe(true);

    const out = connect(doc, { source: 'Task_A', target: 'DataObjectReference_Order' });
    expect(out.created[0]).toMatchObject({ id: 'DataOutputAssociation_1', kind: 'dataAssociation', detail: 'Task_A -> DataObjectReference_Order' });
    const inp = connect(doc, { source: 'DataObjectReference_Order', target: 'Task_A' });
    expect(inp.created[0]).toMatchObject({ id: 'DataInputAssociation_1', kind: 'dataAssociation' });
    const task = doc.require('Task_A');
    expect(ids(many(task, 'dataOutputAssociations'))).toEqual(['DataOutputAssociation_1']);
    expect(ids(many(task, 'dataInputAssociations'))).toEqual(['DataInputAssociation_1']);
    const prop = many(task, 'properties')[0]!;
    expect(prop.get('name')).toBe(PLACEHOLDER_PROPERTY);
    expect(doc.require('DataInputAssociation_1').get<El>('targetRef')).toBe(prop);

    expect(codeOf(() => add(doc, { kind: 'dataObject', name: 'X', after: 'Task_A' }))).toBe('E_INVALID_PLACEMENT');
    expect(codeOf(() => connect(doc, { source: 'DataObjectReference_Order', target: 'DataObjectReference_Order' }))).toBe('E_INVALID_ENDPOINT');
    expect(connect(doc, { source: 'Task_A', target: 'DataObjectReference_Order', ifAbsent: true }).isEmpty).toBe(true);

    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:dataObject id="DataObject_Order" \/>\s*<bpmn:dataObjectReference id="DataObjectReference_Order" name="Order" dataObjectRef="DataObject_Order" \/>/);
    expect(xml).toMatch(/<bpmn:property id="Property_1" name="__targetRef_placeholder" \/>/);
    expect(xml).toMatch(/<bpmn:dataInputAssociation id="DataInputAssociation_1">\s*<bpmn:sourceRef>DataObjectReference_Order<\/bpmn:sourceRef>\s*<bpmn:targetRef>Property_1<\/bpmn:targetRef>/);
    expect(xml).toMatch(/<bpmn:dataOutputAssociation id="DataOutputAssociation_1">\s*<bpmn:targetRef>DataObjectReference_Order<\/bpmn:targetRef>/);

    // removal cleans the placeholder property
    removeDataAssociation(doc, doc.require('DataInputAssociation_1'));
    expect(many(task, 'properties')).toHaveLength(0);
    expect(many(task, 'dataInputAssociations')).toHaveLength(0);
    expect(doc.has('DataInputAssociation_1')).toBe(false);
    await roundTrip(doc);
  });

  it('creates data stores with a root bpmn:DataStore and --to wiring', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'dataStore', name: 'Order DB', to: 'Task_A' });
    expect(cs.created.map((c) => c.id)).toEqual(['DataStoreReference_OrderDB', 'DataInputAssociation_1']);
    expect(doc.rootElementsOfType('bpmn:DataStore').map((s) => s.get('id'))).toEqual(['DataStore_OrderDB']);
    expect(doc.require('DataStoreReference_OrderDB').get<El>('dataStoreRef').get('id')).toBe('DataStore_OrderDB');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'DataStoreReference_OrderDB' }))).toBe('NO_ERROR');
    expect(codeOf(() => connect(doc, { source: 'DataStoreReference_OrderDB', target: 'Start' }))).toBe('E_INVALID_ENDPOINT');
    add(doc, { kind: 'parallelGateway', name: 'G', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'Gateway_G', target: 'DataStoreReference_OrderDB' }))).toBe('E_INVALID_ENDPOINT');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:dataStore id="DataStore_OrderDB" name="Order DB" \/>/);
    expect(xml).toMatch(/<bpmn:dataStoreReference id="DataStoreReference_OrderDB" name="Order DB" dataStoreRef="DataStore_OrderDB" \/>/);
  });

  it('creates text annotations and associations via connect / --to', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'textAnnotation', text: 'Check twice' });
    expect(cs.created[0]).toMatchObject({ id: 'TextAnnotation_1', kind: 'textAnnotation', name: 'Check twice' });
    const assoc = connect(doc, { source: 'TextAnnotation_1', target: 'Task_A' });
    expect(assoc.created[0]).toMatchObject({ id: 'Association_1', kind: 'association', detail: 'TextAnnotation_1 -> Task_A' });
    expect(ids(many(doc.require('Process_1'), 'artifacts'))).toEqual(['TextAnnotation_1', 'Association_1']);
    expect(connect(doc, { source: 'Task_A', target: 'TextAnnotation_1', ifAbsent: true }).isEmpty).toBe(true);
    expect(codeOf(() => connect(doc, { source: 'Task_A', target: 'TextAnnotation_1', condition: 'x' }))).toBe('E_INVALID_VALUE');

    // the positional name gives the id (Prefix_Slug like every other kind) and, without --text, the text
    const cs2 = add(doc, { kind: 'note', name: 'Note via name', to: 'End' });
    expect(cs2.created.map((c) => c.id)).toEqual(['TextAnnotation_NoteViaName', 'Association_2']);
    expect(doc.require('TextAnnotation_NoteViaName').get('text')).toBe('Note via name');
    expect(edge(doc, 'Association_2')).toBe('End->TextAnnotation_NoteViaName');
    add(doc, { kind: 'textAnnotation', text: 'Two' });
    expect(codeOf(() => connect(doc, { source: 'TextAnnotation_NoteViaName', target: 'TextAnnotation_2' }))).toBe('E_INVALID_ENDPOINT');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:textAnnotation id="TextAnnotation_1">\s*<bpmn:text>Check twice<\/bpmn:text>\s*<\/bpmn:textAnnotation>/);
    expect(xml).toMatch(/<bpmn:association id="Association_1" sourceRef="TextAnnotation_1" targetRef="Task_A" \/>/);
  });

  it('draws compensation associations from compensate boundary events', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'boundaryEvent:compensate', name: 'Undo', on: 'Task_A' });
    add(doc, { kind: 'task', name: 'Undo A', in: 'Process_1' });
    const cs = connect(doc, { source: 'Event_Undo', target: 'Activity_UndoA' });
    expect(cs.created[0]).toMatchObject({ id: 'Association_1', kind: 'association' });
    expect(doc.require('Association_1').get('associationDirection')).toBe('One');
    expect(doc.require('Activity_UndoA').get('isForCompensation')).toBe(true);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:task id="Activity_UndoA" name="Undo A" isForCompensation="true" \/>/);
  });

  it('createDataAssociation validates node kinds', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'dataObject', name: 'D' });
    const cs = new ChangeSet();
    expect(codeOf(() => createDataAssociation(doc, doc.require('DataObjectReference_D'), doc.require('End'), {}, cs))).toBe('NO_ERROR');
    expect(codeOf(() => createDataAssociation(doc, doc.require('End'), doc.require('DataObjectReference_D'), {}, cs))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => createDataAssociation(doc, doc.require('Start'), doc.require('DataObjectReference_D'), {}, cs))).toBe('NO_ERROR');
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* connect                                                              */
/* ------------------------------------------------------------------ */

describe('connect', () => {
  it('creates sequence flows with options and warns about implicit splits/joins', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'task', name: 'B', in: 'Process_1' });
    const cs = connect(doc, { source: 'Task_A', target: 'Activity_B', name: 'again', condition: '${retry}', id: 'Flow_Retry' });
    expect(cs.created[0]).toMatchObject({ id: 'Flow_Retry', kind: 'sequenceFlow', name: 'again', detail: 'Task_A -> Activity_B' });
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_IMPLICIT_SPLIT']);
    expect(doc.require('Flow_Retry').get<El>('conditionExpression').get('body')).toBe('${retry}');
    const cs2 = connect(doc, { source: 'Activity_B', target: 'End' });
    expect(cs2.warnings.map((w) => w.code)).toEqual(['W_IMPLICIT_JOIN']);
    expect(connect(doc, { source: 'Activity_B', target: 'End', ifAbsent: true }).isEmpty).toBe(true);
    expect(codeOf(() => connect(doc, { source: 'End', target: 'Task_A' }))).toBe('E_INVALID_SOURCE');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'Start' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'Task_A', target: 'Activity_B', message: 'M' }))).toBe('E_INVALID_VALUE');
    await roundTrip(doc);
  });

  it('gateway sources do not warn about splits, joins through gateways neither', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = connect(doc, { source: 'GW', target: 'Loose', default: true });
    expect(cs.warnings).toHaveLength(0);
    expect(doc.require('GW').get<El>('default').get('id')).toBe(cs.created[0]!.id);
    await roundTrip(doc);
  });

  it('creates message flows between pools with a root message', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'sendTask', name: 'Send', after: 'Task_A' });
    expect(codeOf(() => connect(doc, { source: 'Activity_Send', target: 'Task_A', message: 'X' }))).toBe('E_INVALID_VALUE');
    add(doc, { kind: 'participant', name: 'Shop' });
    add(doc, { kind: 'participant', name: 'Customer' });
    add(doc, { kind: 'startEvent:message', name: 'Got it', message: 'Offer', in: 'Participant_Customer' });
    add(doc, { kind: 'participant', name: 'Bank', blackBox: true });

    // Flow_1 is the sequence flow created by the splice above; message flows share the Flow_ prefix
    const cs = connect(doc, { source: 'Activity_Send', target: 'Event_GotIt', message: 'Offer', name: 'offer' });
    expect(cs.created[0]).toMatchObject({ id: 'Flow_2', kind: 'messageFlow', name: 'offer', detail: 'Activity_Send -> Event_GotIt' });
    expect(doc.require('Flow_2').get<El>('messageRef').get('id')).toBe('Message_Offer');
    expect(doc.rootElementsOfType('bpmn:Message')).toHaveLength(1);

    const cs2 = connect(doc, { source: 'Participant_Bank', target: 'Task_A', message: 'Statement' });
    expect(cs2.created.map((c) => c.id)).toEqual(['Message_Statement', 'Flow_3']);
    const cs3 = connect(doc, { source: 'Activity_Send', target: 'Participant_Bank' });
    expect(cs3.created[0]!.kind).toBe('messageFlow');
    expect(connect(doc, { source: 'Activity_Send', target: 'Participant_Bank', ifAbsent: true }).isEmpty).toBe(true);
    expect(ids(doc.messageFlows())).toEqual(['Flow_2', 'Flow_3', 'Flow_4']);

    expect(codeOf(() => connect(doc, { source: 'Task_A', target: 'Participant_Shop' }))).toBe('E_SAME_POOL');
    expect(codeOf(() => connect(doc, { source: 'Activity_Send', target: 'Event_GotIt', condition: 'x' }))).toBe('E_INVALID_VALUE');
    add(doc, { kind: 'exclusiveGateway', name: 'G', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'Gateway_G', target: 'Participant_Bank' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'Event_GotIt', target: 'Participant_Bank' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'Participant_Bank', target: 'Activity_Send' }))).toBe('NO_ERROR');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:messageFlow id="Flow_2" name="offer" sourceRef="Activity_Send" targetRef="Event_GotIt" messageRef="Message_Offer" \/>/);
  });

  it('refuses message flows without a collaboration and unrelated endpoints', async () => {
    const doc = await docFromXml(
      definitionsXml('<bpmn:task id="T1" />', { extraRoots: '<bpmn:process id="Process_2"><bpmn:task id="T2" /></bpmn:process>' }),
    );
    expect(codeOf(() => connect(doc, { source: 'T1', target: 'T2' }))).toBe('E_NO_COLLABORATION');
    expect(codeOf(() => connect(doc, { source: 'Process_1', target: 'T2' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'T1', target: 'Nope' }))).toBe('E_NOT_FOUND');
  });
});

/* ------------------------------------------------------------------ */
/* split                                                                */
/* ------------------------------------------------------------------ */

describe('split', () => {
  it('splices a gateway with branches and a join into a flow', async () => {
    const doc = await linearDoc();
    const op: SplitOp = {
      op: 'split',
      after: 'Task_A',
      name: 'Invoice ok?',
      branches: [
        { flowName: 'yes', condition: '${ok}', nodes: [{ kind: 'serviceTask', name: 'Book' }, { kind: 'userTask', name: 'Archive' }] },
        { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Clarify' }] },
      ],
    };
    const cs = splitFlow(doc, op);
    const created = cs.created.filter((c) => c.kind !== 'sequenceFlow').map((c) => c.id);
    expect(created).toEqual(['Gateway_InvoiceOk', 'Activity_Book', 'Activity_Archive', 'Activity_Clarify', 'Gateway_InvoiceOk_join']);
    expect(cs.created.find((c) => c.id === 'Gateway_InvoiceOk')!.detail).toBe('between Task_A and End');
    expect(cs.created.find((c) => c.id === 'Gateway_InvoiceOk_join')!.detail).toBe('join of Gateway_InvoiceOk');
    expect(cs.warnings).toHaveLength(0);

    const gw = doc.require('Gateway_InvoiceOk');
    const join = doc.require('Gateway_InvoiceOk_join');
    expect(edge(doc, 'F2')).toBe('Task_A->Gateway_InvoiceOk');
    const out = doc.outgoing(gw);
    expect(out.map((f) => `${f.get('name')}:${f.get<El>('targetRef').get('id')}`)).toEqual(['yes:Activity_Book', 'no:Activity_Clarify']);
    expect(out[0]!.get<El>('conditionExpression').get('body')).toBe('${ok}');
    expect(gw.get<El>('default')).toBe(out[1]);
    expect(edge(doc, ids(doc.outgoing(doc.require('Activity_Book')))[0]!)).toBe('Activity_Book->Activity_Archive');
    expect(doc.incoming(join).map((f) => f.get<El>('sourceRef').get('id'))).toEqual(['Activity_Archive', 'Activity_Clarify']);
    expect(doc.outgoing(join).map((f) => f.get<El>('targetRef').get('id'))).toEqual(['End']);
    expect(doc.incoming(doc.require('End'))).toHaveLength(1);
    // declaration order: gateway right after its incoming flow, branches in order
    const order = flowIds(doc);
    expect(order.indexOf('Gateway_InvoiceOk')).toBe(order.indexOf('F2') + 1);
    expect(order.indexOf('Activity_Book')).toBeLessThan(order.indexOf('Activity_Clarify'));
    expect(cs.notes.some((n) => n.startsWith('split Gateway_InvoiceOk'))).toBe(true);
    await roundTrip(doc);
  });

  it('without a join every branch end connects to the old successor (implicit join warnings)', async () => {
    const doc = await linearDoc();
    const cs = splitFlow(doc, {
      op: 'split',
      after: 'Task_A',
      kind: 'parallel',
      join: false,
      branches: [{ nodes: [{ kind: 'task', name: 'P1' }] }, { nodes: [{ kind: 'task', name: 'P2' }] }],
    });
    expect(is(doc.require('Gateway_1'), 'bpmn:ParallelGateway')).toBe(true);
    expect(doc.has('Gateway_1_join')).toBe(false);
    expect(doc.incoming(doc.require('End')).map((f) => f.get<El>('sourceRef').get('id'))).toEqual(['Activity_P1', 'Activity_P2']);
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_IMPLICIT_JOIN']);
    await roundTrip(doc);
  });

  it('appends after gateways / unconnected nodes and supports empty branches', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = splitFlow(doc, {
      op: 'split',
      after: 'Loose',
      id: 'Gateway_Split',
      joinId: 'Gateway_Merge',
      joinName: 'merge',
      branches: [{ nodes: [{ kind: 'task', name: 'Work' }] }, { flowName: 'skip', nodes: [] }],
    });
    expect(cs.created.find((c) => c.id === 'Gateway_Split')!.detail).toBe('after Loose');
    expect(edge(doc, ids(doc.outgoing(doc.require('Loose')))[0]!)).toBe('Loose->Gateway_Split');
    const gwOut = doc.outgoing(doc.require('Gateway_Split'));
    expect(gwOut.map((f) => f.get<El>('targetRef').get('id'))).toEqual(['Activity_Work', 'Gateway_Merge']);
    expect(gwOut[1]!.get('name')).toBe('skip');
    expect(doc.outgoing(doc.require('Gateway_Merge'))).toHaveLength(0);
    expect(doc.require('Gateway_Merge').get('name')).toBe('merge');

    // after a gateway: appended as another branch, old branches untouched
    splitFlow(doc, { op: 'split', after: 'GW', name: 'Nested?', branches: [{ nodes: [{ kind: 'task', name: 'N1' }] }] });
    expect(ids(doc.outgoing(doc.require('GW')))).toHaveLength(2);
    expect(edge(doc, 'F2')).toBe('GW->Task_A');
    await roundTrip(doc);
  });

  it('validates kind, branches and anchors', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => splitFlow(doc, { op: 'split', after: 'Task_A', kind: 'userTask', branches: [{ nodes: [] }] }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => splitFlow(doc, { op: 'split', after: 'Task_A', branches: [] }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => splitFlow(doc, { op: 'split', after: 'Nope', branches: [{ nodes: [] }] }))).toBe('E_NOT_FOUND');
    add(doc, { kind: 'task', name: 'Alone', in: 'Process_1' });
    expect(codeOf(() => splitFlow(doc, { op: 'split', after: 'Activity_Alone', join: false, branches: [{ nodes: [] }] }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => splitFlow(doc, { op: 'split', after: 'Task_A', kind: 'complexGateway', branches: [{ nodes: [] }] }))).toBe('E_UNKNOWN_KIND');
  });

  it('branch nodes inherit the anchor lane and can carry triggers', async () => {
    const doc = await docFromXml(WITH_LANES);
    splitFlow(doc, {
      op: 'split',
      after: 'Task_A',
      kind: 'eventBased',
      join: false,
      branches: [
        { nodes: [{ kind: 'intermediateCatchEvent:timer', name: 'Timeout', timer: 'PT1H' }] },
        { nodes: [{ kind: 'intermediateCatchEvent:message', name: 'Reply', message: 'Reply' }] },
      ],
    });
    expect(laneOf(doc, doc.require('Gateway_1'))?.get('id')).toBe('Lane_Sales');
    expect(laneOf(doc, doc.require('Event_Timeout'))?.get('id')).toBe('Lane_Sales');
    expect(describeTrigger(doc.require('Event_Reply'))).toBe('message Reply');
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* review fixes (creation)                                              */
/* ------------------------------------------------------------------ */

function caught(fn: () => unknown): { code?: string; exitCode?: number; details?: { hint?: string; candidates?: string[] } } | undefined {
  try {
    fn();
  } catch (err) {
    return err as ReturnType<typeof caught>;
  }
  return undefined;
}

describe('add: event sub-processes with a trigger', () => {
  it('creates the triggered start event inside in the same op (trigger options or kind:trigger)', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'eventSubProcess', name: 'Handle errors', error: 'PaymentFailed', errorCode: 'PAY-1' });
    expect(cs.created.map((c) => [c.id, c.kind])).toEqual([
      ['Activity_HandleErrors', 'eventSubProcess'],
      ['Event_1', 'startEvent:error'],
      ['Error_PaymentFailed', 'error'],
    ]);
    expect(cs.created[1]!.detail).toBe('start of event sub-process Activity_HandleErrors');
    expect(cs.warnings).toHaveLength(0);
    expect(ids(doc.flowNodes(doc.require('Activity_HandleErrors')))).toEqual(['Event_1']);
    expect(describeTrigger(doc.require('Event_1'))).toBe('error PaymentFailed (PAY-1)');

    const cs2 = add(doc, { kind: 'eventSubProcess:message', name: 'On cancel', message: 'Cancel', nonInterrupting: true, in: 'Process_1' });
    expect(cs2.created.map((c) => c.kind)).toEqual(['eventSubProcess', 'startEvent:message', 'message']);
    expect(doc.require('Event_2').get('isInterrupting')).toBe(false);
    expect(doc.scopeOf(doc.require('Event_2'))?.get('id')).toBe('Activity_OnCancel');
    // --timer infers the trigger as well, aliases work
    add(doc, { kind: 'eventSub', name: 'Tick', timer: 'R/PT1H' });
    expect(triggerDetails(doc.require('Event_3'))?.timer).toEqual({ kind: 'cycle', value: 'R/PT1H' });
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:subProcess id="Activity_HandleErrors" name="Handle errors" triggeredByEvent="true">\s*<bpmn:startEvent id="Event_1">\s*<bpmn:errorEventDefinition errorRef="Error_PaymentFailed" \/>/);
  });

  it('rejects triggers a start event cannot have; without a trigger nothing is created inside', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'eventSubProcess:terminate', name: 'X' }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'eventSubProcess:nope', name: 'X' }))).toBe('E_INVALID_TRIGGER');
    expect(caught(() => add(doc, { kind: 'eventSubProcess:terminate', name: 'X' }))?.details?.candidates).toContain('error');
    expect(doc.has('Activity_X')).toBe(false);
    const cs = add(doc, { kind: 'eventSubProcess', name: 'Plain', nonInterrupting: true });
    expect(cs.created.map((c) => c.id)).toEqual(['Activity_Plain']);
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    expect(add(doc, { kind: 'eventSubProcess', name: 'Empty' }).warnings).toHaveLength(0);
    expect(doc.flowNodes(doc.require('Activity_Empty'))).toHaveLength(0);
  });

  it('the hint for a triggered start outside an event sub-process names the one-command fix', async () => {
    const doc = await linearDoc();
    const err = caught(() => add(doc, { kind: 'startEvent:error', name: 'Failed', error: 'Fail', in: 'Process_1' }));
    expect(err?.code).toBe('E_INVALID_TRIGGER');
    expect(err?.details?.hint).toContain('add eventSubProcess "Handle errors" --error <Name>');
    expect(err?.details?.hint).toContain('apply');
  });

  it('kind-token errors (including eventSubProcess:<bad>) keep their codes and the usage exit code cli.test.ts pins', async () => {
    const doc = await linearDoc();
    for (const [kind, code] of [
      ['frobTask', 'E_UNKNOWN_KIND'],
      ['complexGateway', 'E_UNSUPPORTED_KIND'],
      ['startEvent:cancel', 'E_INVALID_TRIGGER'],
      ['userTask:timer', 'E_INVALID_TRIGGER'],
      ['eventSubProcess:terminate', 'E_INVALID_TRIGGER'],
    ]) {
      const err = caught(() => add(doc, { kind: kind!, name: 'X' }));
      expect(err?.code, kind).toBe(code);
      expect(err?.exitCode, kind).toBe(1);
    }
  });
});

describe('add: option validation', () => {
  it('ifAbsent without an id is E_USAGE (as in apply) and names the id to pass', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'userTask', name: 'Check order', after: 'Task_A' });
    const err = caught(() => add(doc, { kind: 'userTask', name: 'Check order', after: 'Task_A', ifAbsent: true }));
    expect(err?.code).toBe('E_USAGE');
    expect(err?.exitCode).toBe(1);
    expect(err?.details?.hint).toContain('--id Activity_CheckOrder');
    expect(doc.has('Activity_CheckOrder_2')).toBe(false);
    expect(edge(doc, 'F2')).toBe('Task_A->Activity_CheckOrder');
    expect(add(doc, { kind: 'userTask', id: 'Activity_CheckOrder', after: 'Task_A', ifAbsent: true }).isEmpty).toBe(true);
  });

  it('rejects default + condition and empty conditions before mutating anything (add and connect)', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    expect(codeOf(() => add(doc, { kind: 'task', name: 'DC', after: 'GW', default: true, condition: '${x}' }))).toBe('E_USAGE');
    expect(codeOf(() => add(doc, { kind: 'task', name: 'EC', after: 'GW', condition: '' }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => add(doc, { kind: 'task', name: 'EC', after: 'GW', condition: '   ' }))).toBe('E_INVALID_VALUE');
    expect(doc.has('Activity_DC')).toBe(false);
    expect(doc.has('Activity_EC')).toBe(false);
    expect(ids(doc.outgoing(doc.require('GW')))).toEqual(['F2']);
    expect(codeOf(() => connect(doc, { source: 'GW', target: 'Loose', default: true, condition: '${x}' }))).toBe('E_USAGE');
    expect(codeOf(() => connect(doc, { source: 'GW', target: 'Loose', condition: '' }))).toBe('E_INVALID_VALUE');
    expect(doc.incoming(doc.require('Loose'))).toHaveLength(0);
  });

  it('warns when flow options cannot be applied: no flow created, or the flow into the node kept its id', async () => {
    const doc = await linearDoc();
    // splice into a flow: the existing flow keeps its id, the other options still apply
    const cs = add(doc, { kind: 'task', name: 'Mid', flow: 'F1', flowId: 'Flow_custom', flowName: 'go' });
    expect(doc.has('Flow_custom')).toBe(false);
    expect(doc.require('F1').get('name')).toBe('go');
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    expect(cs.warnings[0]!.message).toContain('--flow-id Flow_custom');
    expect(cs.warnings[0]!.related).toEqual(['F1']);
    expect(cs.warnings[0]!.hint).toContain('bpmn set F1 id=Flow_custom');
    // after a node with a successor splices too
    const cs2 = add(doc, { kind: 'task', name: 'Mid2', after: 'Activity_Mid', flowId: 'Flow_custom2' });
    expect(cs2.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    expect(doc.has('Flow_custom2')).toBe(false);
    // append / prepend create the flow with that id: no warning
    add(doc, { kind: 'task', name: 'Loose', in: 'Process_1' });
    const cs3 = add(doc, { kind: 'task', name: 'Tail', after: 'Activity_Loose', flowId: 'Flow_custom3' });
    expect(cs3.warnings).toHaveLength(0);
    expect(edge(doc, 'Flow_custom3')).toBe('Activity_Loose->Activity_Tail');
    const cs4 = add(doc, { kind: 'task', name: 'Head', before: 'Activity_Loose', flowId: 'Flow_custom4', flowName: 'in' });
    expect(cs4.warnings).toHaveLength(0);
    expect(edge(doc, 'Flow_custom4')).toBe('Activity_Head->Activity_Loose');
    // --in creates no flow into the node
    const cs5 = add(doc, { kind: 'task', name: 'Alone', in: 'Process_1', flowName: 'x', condition: '${y}' });
    expect(cs5.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    expect(cs5.warnings[0]!.message).toContain('--flow-name, --condition');
    expect(add(doc, { kind: 'task', name: 'Quiet', in: 'Process_1' }).warnings).toHaveLength(0);
    await roundTrip(doc);
  });

  it('rejects an unknown timer kind with E_INVALID_VALUE instead of crashing', async () => {
    const doc = await linearDoc();
    const err = caught(() => add(doc, { kind: 'startEvent:timer', name: 'Bad', timer: 'PT2D', timerKind: 'weekly' as never, in: 'Process_1' }));
    expect(err?.code).toBe('E_INVALID_VALUE');
    expect(err?.exitCode).toBe(2);
    expect(err?.details?.candidates).toEqual(['cycle', 'duration', 'date']);
    add(doc, { kind: 'startEvent:timer', name: 'Good', timer: 'PT2D', timerKind: 'cycle', in: 'Process_1' });
    expect(triggerDetails(doc.require('Event_Good'))?.timer).toEqual({ kind: 'cycle', value: 'PT2D' });
  });

  it('names text annotations by the positional name and warns only on real id collisions', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'note', name: 'Approval note', text: 'Offers above 10k need approval' });
    expect(cs.created[0]).toMatchObject({ id: 'TextAnnotation_ApprovalNote', kind: 'textAnnotation', name: 'Offers above 10k need approval' });
    expect(doc.require('TextAnnotation_ApprovalNote').get('text')).toBe('Offers above 10k need approval');
    expect(cs.warnings).toHaveLength(0);
    const cs2 = add(doc, { kind: 'note', name: 'Approval note' });
    expect(cs2.created[0]!.id).toBe('TextAnnotation_ApprovalNote_2');
    expect(cs2.warnings.map((w) => w.code)).toEqual(['W_ID_SUFFIXED']);
    const cs3 = add(doc, { kind: 'note', text: 'only text' });
    expect(cs3.created[0]!.id).toBe('TextAnnotation_1');
    expect(cs3.warnings).toHaveLength(0);
    await roundTrip(doc);
  });
});

describe('connect: self-loops', () => {
  it('allows a sequence flow from an activity to itself (with a loop-marker hint), nothing else', async () => {
    const doc = await linearDoc();
    const cs = connect(doc, { source: 'Task_A', target: 'Task_A', name: 'again' });
    expect(cs.created[0]).toMatchObject({ kind: 'sequenceFlow', name: 'again', detail: 'Task_A -> Task_A' });
    expect(cs.notes.some((n) => n.includes('bpmn set Task_A loop=standard'))).toBe(true);
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN']);
    expect(connect(doc, { source: 'Task_A', target: 'Task_A', ifAbsent: true }).isEmpty).toBe(true);
    add(doc, { kind: 'exclusiveGateway', name: 'G', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'Gateway_G', target: 'Gateway_G' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'Start' }))).toBe('E_INVALID_ENDPOINT');
    add(doc, { kind: 'textAnnotation', text: 'n' });
    expect(codeOf(() => connect(doc, { source: 'TextAnnotation_1', target: 'TextAnnotation_1' }))).toBe('E_INVALID_ENDPOINT');
    add(doc, { kind: 'participant', name: 'P' });
    expect(codeOf(() => connect(doc, { source: 'Participant_P', target: 'Participant_P' }))).toBe('E_INVALID_ENDPOINT');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="Flow_1" name="again" sourceRef="Task_A" targetRef="Task_A" \/>/);
  });
});

describe('split: terminating branches', () => {
  it('a branch ending in an end event stops there; the others join and continue', async () => {
    const doc = await linearDoc();
    const cs = splitFlow(doc, {
      op: 'split',
      after: 'Task_A',
      name: 'Ok?',
      branches: [
        { flowName: 'yes', nodes: [{ kind: 'task', name: 'Book' }] },
        { flowName: 'no', default: true, nodes: [{ kind: 'end', name: 'Rejected' }] },
      ],
    });
    const join = doc.require('Gateway_Ok_join');
    expect(doc.incoming(join).map((f) => f.get<El>('sourceRef').get('id'))).toEqual(['Activity_Book']);
    expect(doc.outgoing(doc.require('Event_Rejected'))).toHaveLength(0);
    expect(doc.require('Gateway_Ok').get<El>('default').get<El>('targetRef').get('id')).toBe('Event_Rejected');
    expect(edge(doc, ids(doc.outgoing(join))[0]!)).toBe('Gateway_Ok_join->End');
    expect(cs.notes.some((n) => n.includes('Event_Rejected terminates'))).toBe(true);
    expect(cs.warnings).toHaveLength(0);
    await roundTrip(doc);
  });

  it('with every branch terminating no join is created and the lost successor is noted; join:false stops the end branch too', async () => {
    const doc = await linearDoc();
    const cs = splitFlow(doc, { op: 'split', after: 'Task_A', branches: [{ nodes: [{ kind: 'end', name: 'A' }] }, { nodes: [{ kind: 'end', name: 'B' }] }] });
    expect(doc.has('Gateway_1_join')).toBe(false);
    expect(doc.incoming(doc.require('End'))).toHaveLength(0);
    expect(cs.notes.some((n) => n.includes('no join gateway created'))).toBe(true);
    expect(cs.notes.some((n) => n.includes('End is no longer reached'))).toBe(true);

    const doc2 = await linearDoc();
    const cs2 = splitFlow(doc2, { op: 'split', after: 'Task_A', join: false, branches: [{ nodes: [{ kind: 'task', name: 'Go' }] }, { nodes: [{ kind: 'end', name: 'Stop' }] }] });
    expect(doc2.incoming(doc2.require('End')).map((f) => f.get<El>('sourceRef').get('id'))).toEqual(['Activity_Go']);
    expect(doc2.outgoing(doc2.require('Event_Stop'))).toHaveLength(0);
    expect(cs2.warnings).toHaveLength(0);
    await roundTrip(doc2);
  });
});

describe('lanes: nested --members', () => {
  it('warns when the first child lane receives more than the listed --members', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'participant', name: 'Shop' });
    const cs = add(doc, { kind: 'lane', name: 'Inbound', in: 'Lane_Sales', members: ['Task_A'] });
    expect(ids(many(doc.require('Lane_Inbound'), 'flowNodeRef'))).toEqual(['Start', 'Task_A']);
    expect(cs.warnings.map((w) => w.code)).toEqual(['W_OPTION_IGNORED']);
    expect(cs.warnings[0]!.related).toEqual(['Start']);
    expect(cs.warnings[0]!.hint).toContain('--in Lane_Sales --members Start');
    // the sibling lane the hint suggests takes exactly its members, no warning
    const cs2 = add(doc, { kind: 'lane', name: 'Outbound', in: 'Lane_Sales', members: ['Start'] });
    expect(cs2.warnings).toHaveLength(0);
    expect(ids(many(doc.require('Lane_Inbound'), 'flowNodeRef'))).toEqual(['Task_A']);
    expect(ids(many(doc.require('Lane_Outbound'), 'flowNodeRef'))).toEqual(['Start']);
    // listing every inherited member (or none) is silent
    const cs3 = add(doc, { kind: 'lane', name: 'Back', in: 'Lane_Backoffice', members: ['End'] });
    expect(cs3.warnings).toHaveLength(0);
    await roundTrip(doc);
  });
});
