import { describe, expect, it } from 'vitest';
import { allLanes } from '../../../src/domain/document/utils/lanes.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { is, many, type El } from '../../../src/domain/document/utils/moddle.js';
import { PLACEHOLDER_PROPERTY, Associations } from '../../../src/domain/editing/connections/Associations.js';
import { Connections } from '../../../src/domain/editing/connections/Connections.js';
import { Lanes } from '../../../src/domain/editing/elements/Lanes.js';
import { laneOf } from '../../../src/domain/document/utils/lanes.js';
import { EventTrigger } from '../../../src/domain/editing/events/EventTrigger.js';
import type { AddElement, ConnectElements, SplitIntoBranches } from '../../../src/domain/commands/types.js';
import { BRANCH_FIELDS, NODE_FIELDS } from '../../../src/domain/commands/utils/op-fields.js';
import { parseOps } from '../../../src/index.js';
import type { BpmnError } from '../../../src/domain/document/BpmnError.js';
import { mutateDoc } from '../../../src/index.js';
import { ChangeSet } from '../../../src/domain/document/ChangeSet.js';
import { definitionsXml, docFromXml, flowBetween, linearDoc } from '../../helpers/helpers.js';
import { EventDefinitions } from '../../../src/domain/editing/events/EventDefinitions.js';
import { ElementCreation } from '../../../src/domain/editing/elements/ElementCreation.js';
import { BranchSplit } from '../../../src/domain/editing/connections/BranchSplit.js';
import { EditSession } from '../../../src/domain/document/EditSession.js';
import { SequenceFlows } from '../../../src/domain/editing/connections/SequenceFlows.js';

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

/** Serialises and re-parses; the result must import without any warning. */
async function roundTrip(doc: Doc): Promise<{ xml: string; doc: Doc }> {
  const xml = await doc.toXml();
  const re = await Doc.fromXml(xml);
  expect(re.importWarnings.map((warning) => warning.message)).toEqual([]);
  return { xml, doc: re };
}

function add(doc: Doc, op: Omit<AddElement, 'op'>): ChangeSet {
  return new ElementCreation(new EditSession(doc)).add({ op: 'add', ...op });
}

function connect(doc: Doc, op: Omit<ConnectElements, 'op'>): ChangeSet {
  return new Connections(new EditSession(doc)).connect({ op: 'connect', ...op });
}

function ids(els: El[]): string[] {
  return els.map((element) => element.get<string>('id'));
}

function flowIds(doc: Doc, scopeId = 'Process_1'): string[] {
  return ids(doc.flowElements(doc.require(scopeId)));
}

function edge(doc: Doc, flowId: string): string {
  const flow = doc.require(flowId);
  return `${flow.get<El>('sourceRef').get('id')}->${flow.get<El>('targetRef').get('id')}`;
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

const EVENT_GATEWAY = definitionsXml(`
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:eventBasedGateway id="Gw"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:eventBasedGateway>
    <bpmn:intermediateCatchEvent id="Event_Paid"><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Event_Loose"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="End"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="Gw" />
    <bpmn:sequenceFlow id="F3" sourceRef="Gw" targetRef="Event_Paid" />
    <bpmn:sequenceFlow id="F4" sourceRef="Event_Paid" targetRef="End" />`);

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
    expect(cs.created[0]).toMatchObject({ id: 'userTask_doB', kind: 'userTask', name: 'Do B', detail: 'after Task_A' });
    expect(edge(doc, 'F2')).toBe('Task_A->userTask_doB');
    const second = cs.created.find((change) => change.kind === 'sequenceFlow')!;
    expect(edge(doc, second.id)).toBe('userTask_doB->End');
    expect(flowIds(doc)).toEqual(['Start', 'Task_A', 'End', 'F1', 'F2', 'userTask_doB', second.id]);
    expect(cs.notes.some((note) => note.includes('inserted between Task_A and End'))).toBe(true);
    await roundTrip(doc);
  });

  it('after a gateway or an unconnected node appends a new branch', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = add(doc, { kind: 'serviceTask', name: 'Reject', after: 'GW', flowName: 'no', default: true });
    const flow = cs.created.find((change) => change.kind === 'sequenceFlow')!;
    expect(edge(doc, flow.id)).toBe('GW->serviceTask_reject');
    expect(doc.require('GW').get<El>('default').get('id')).toBe(flow.id);
    expect(ids(doc.outgoing(doc.require('GW')))).toEqual(['F2', flow.id]);
    // declaration order: new node and flow right after the gateway's last flow
    expect(flowIds(doc).indexOf('serviceTask_reject')).toBe(flowIds(doc).indexOf('F2') + 1);

    const cs2 = add(doc, { kind: 'task', name: 'After loose', after: 'Loose' });
    const f2 = cs2.created.find((change) => change.kind === 'sequenceFlow')!;
    expect(edge(doc, f2.id)).toBe('Loose->task_afterLoose');
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
    } catch (error) {
      err = error as typeof err;
    }
    expect(err?.code).toBe('E_HAS_SUCCESSOR');
    expect(err?.details?.candidates?.length).toBe(2);
  });

  it('before a node splices into its incoming flow', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'task', name: 'Prep', before: 'Task_A' });
    expect(cs.created[0]!.detail).toBe('before Task_A');
    expect(edge(doc, 'F1')).toBe('Start->task_prep');
    expect(ids(doc.outgoing(doc.require('task_prep')))).toHaveLength(1);
    expect(edge(doc, ids(doc.outgoing(doc.require('task_prep')))[0]!)).toBe('task_prep->Task_A');
    // declared right after its (spliced) incoming flow F1
    expect(flowIds(doc).indexOf('task_prep')).toBe(flowIds(doc).indexOf('F1') + 1);
    await roundTrip(doc);
  });

  it('before a join gateway or an unconnected node prepends a new incoming flow', async () => {
    const doc = await docFromXml(WITH_JOIN);
    const cs = add(doc, { kind: 'task', name: 'Third', before: 'Join' });
    const flow = cs.created.find((change) => change.kind === 'sequenceFlow')!;
    expect(edge(doc, flow.id)).toBe('task_third->Join');
    expect(ids(doc.incoming(doc.require('Join')))).toEqual(['F3', 'F4', flow.id]);
    expect(edge(doc, 'F3')).toBe('A->Join');
    const cs2 = add(doc, { kind: 'task', name: 'Pre loose', before: 'Loose' });
    expect(edge(doc, cs2.created.find((change) => change.kind === 'sequenceFlow')!.id)).toBe('task_preLoose->Loose');
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
    expect(edge(doc, 'F1')).toBe('Start->scriptTask_mid');
    expect(codeOf(() => add(doc, { kind: 'task', name: 'No', after: 'Start', before: 'End' }))).toBe('E_NO_FLOW');
    await roundTrip(doc);
  });

  it('flow splices into a given sequence flow', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'manualTask', name: 'Check', flow: 'F2', condition: '${ok}' });
    expect(edge(doc, 'F2')).toBe('Task_A->manualTask_check');
    expect(doc.require('F2').get<El>('conditionExpression').get('body')).toBe('${ok}');
    expect(cs.created[0]!.detail).toBe('in flow F2');
    await roundTrip(doc);
  });

  it('in places an unconnected node in a scope (process, sub-process, participant)', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'subProcess', name: 'Sub', after: 'Task_A' });
    const cs = add(doc, { kind: 'startEvent', name: 'Inner start', in: 'subProcess_sub' });
    expect(cs.created[0]!.detail).toBe('in subProcess_sub');
    expect(ids(doc.flowElements(doc.require('subProcess_sub')))).toEqual(['startEvent_innerStart']);
    const cs2 = add(doc, { kind: 'task', name: 'Orphan' });
    expect(cs2.created[0]!.detail).toBe('in Process_1');
    expect(doc.incoming(doc.require('task_orphan'))).toHaveLength(0);
    await roundTrip(doc);
  });

  it('to connects the new node onward and warns about implicit joins', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = add(doc, { kind: 'task', name: 'Alt', after: 'GW', to: 'End' });
    expect(cs.created.filter((change) => change.kind === 'sequenceFlow')).toHaveLength(2);
    expect(cs.warnings.map((warning) => warning.code)).toContain('W_IMPLICIT_JOIN');
    await roundTrip(doc);
  });

  it('on attaches boundary events (inheriting the lane of the host)', async () => {
    const doc = await docFromXml(WITH_LANES);
    const cs = add(doc, { kind: 'boundaryEvent:timer', name: 'Too late', on: 'Task_A', timer: 'PT2D' });
    const be = doc.require('event_tooLate');
    expect(cs.created[0]).toMatchObject({ id: 'event_tooLate', kind: 'boundaryEvent:timer', detail: 'on Task_A' });
    expect(be.get<El>('attachedToRef').get('id')).toBe('Task_A');
    expect(ids(doc.boundaryEventsOf(doc.require('Task_A')))).toEqual(['event_tooLate']);
    expect(laneOf(doc, be)?.get('id')).toBe('Lane_Sales');
    expect(flowIds(doc).indexOf('event_tooLate')).toBe(flowIds(doc).indexOf('Task_A') + 1);
    expect(cs.changed.some((change) => change.id === 'event_tooLate' && change.detail === 'lane Lane_Sales')).toBe(true);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:boundaryEvent id="event_tooLate" name="Too late" attachedToRef="Task_A">/);
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
    expect(laneOf(doc, doc.require('task_next'))?.get('id')).toBe('Lane_Sales');
    add(doc, { kind: 'task', name: 'Last', before: 'End' });
    expect(laneOf(doc, doc.require('task_last'))?.get('id')).toBe('Lane_Backoffice');
    add(doc, { kind: 'task', name: 'Explicit', after: 'task_last', lane: 'Lane_Sales' });
    expect(laneOf(doc, doc.require('task_explicit'))?.get('id')).toBe('Lane_Sales');
    await roundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* add: ids, ifAbsent, kinds                                            */
/* ------------------------------------------------------------------ */

describe('add: ids and options', () => {
  it('uses prefix_camelCase ids, a word for the kind (and the placement) for unnamed nodes and warns on suffixes', async () => {
    const doc = await linearDoc();
    expect(add(doc, { kind: 'task', name: 'Check invoice', in: 'Process_1' }).created[0]!.id).toBe('task_checkInvoice');
    const cs = add(doc, { kind: 'task', name: 'Check invoice', in: 'Process_1' });
    expect(cs.created[0]!.id).toBe('task_checkInvoice2');
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_ID_SUFFIXED']);
    expect(add(doc, { kind: 'task', in: 'Process_1' }).created[0]!.id).toBe('task_task');
    expect(add(doc, { kind: 'parallelGateway', after: 'task_checkInvoice' }).created[0]!.id).toBe('gateway_afterCheckInvoice');
    // after an unnamed anchor placed after a named one: the nearest named anchor, once (never EndAfterAfterCheckInvoice)
    expect(add(doc, { kind: 'endEvent', after: 'gateway_afterCheckInvoice' }).created[0]!.id).toBe('endEvent_afterCheckInvoiceGateway');
    expect(add(doc, { kind: 'xor', name: 'Invoice ok?', in: 'Process_1' }).created[0]!.id).toBe('gateway_invoiceOk');
    expect(add(doc, { kind: 'bpmn:StartEvent', name: 'Order received', in: 'Process_1' }).created[0]!.id).toBe('startEvent_orderReceived');
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
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_KIND_MISMATCH']);
    const cs3 = add(doc, { kind: 'task', id: 'Task_B', name: 'B', ifAbsent: true, after: 'Task_A' });
    expect(cs3.created[0]!.id).toBe('Task_B');
  });

  it('rejects unknown and unsupported kinds', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'choreographyTask' }))).toBe('E_UNSUPPORTED_KIND');
    expect(codeOf(() => add(doc, { kind: 'userTsk' }))).toBe('E_UNKNOWN_KIND');
    expect(codeOf(() => add(doc, { kind: 'userTask:timer' }))).toBe('E_INVALID_TRIGGER');
  });

  it('adds documentation and records collapse requests for sub-processes', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'subProcess', name: 'Details', after: 'Task_A', collapsed: true, doc: 'Explains it' });
    expect(doc.layoutRequests.expansion().collapse).toEqual(['subProcess_details']);
    expect(many(doc.require('subProcess_details'), 'documentation')[0]!.get('text')).toBe('Explains it');
    const cs = add(doc, { kind: 'task', name: 'T', in: 'Process_1', collapsed: true });
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:documentation>Explains it<\/bpmn:documentation>/);
  });

  it('eventSubProcess sets triggeredByEvent', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'eventSubProcess', name: 'Handle errors' });
    expect(cs.created[0]!.kind).toBe('eventSubProcess');
    expect(doc.require('subProcess_handleErrors').get('triggeredByEvent')).toBe(true);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:subProcess id="subProcess_handleErrors" name="Handle errors" triggeredByEvent="true"/);
  });
});

/* ------------------------------------------------------------------ */
/* triggers                                                             */
/* ------------------------------------------------------------------ */

describe('triggers', () => {
  it('creates root messages by name and reuses them', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'startEvent:message', name: 'Order received', message: 'Order received', in: 'Process_1' });
    expect(cs.created.map((change) => change.id)).toEqual(['startEvent_orderReceived', 'message_orderReceived']);
    expect(cs.created[1]).toMatchObject({ kind: 'message', name: 'Order received' });
    add(doc, { kind: 'intermediateCatchEvent:message', name: 'Wait', message: 'Order received', after: 'Task_A' });
    add(doc, { kind: 'endEvent:message', name: 'Notify', message: 'message_orderReceived', in: 'Process_1' });
    expect(doc.rootElementsOfType('bpmn:Message')).toHaveLength(1);
    expect(new EventTrigger(doc.require('event_wait')).describe()).toBe('message Order received');
    expect(new EventTrigger(doc.require('endEvent_notify')).details()).toEqual({ trigger: 'message', message: { id: 'message_orderReceived', name: 'Order received' } });
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:message id="message_orderReceived" name="Order received" \/>/);
    expect(xml).toMatch(/<bpmn:messageEventDefinition messageRef="message_orderReceived" \/>/);
  });

  it('creates errors with codes, signals and escalations (reused by name)', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'endEvent:error', name: 'Failed', error: 'PaymentFailed', errorCode: 'PAY-001', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent:error', name: 'Catch', on: 'Task_A', error: 'PaymentFailed' });
    expect(doc.rootElementsOfType('bpmn:Error')).toHaveLength(1);
    expect(new EventTrigger(doc.require('event_catch')).describe()).toBe('error PaymentFailed (PAY-001)');
    expect(new EventTrigger(doc.require('event_catch')).details()).toEqual({ trigger: 'error', error: { id: 'error_paymentFailed', name: 'PaymentFailed', code: 'PAY-001' } });

    add(doc, { kind: 'endEvent:signal', name: 'Sig', signal: 'Done', in: 'Process_1' });
    add(doc, { kind: 'startEvent:signal', name: 'Sig start', signal: 'Done', in: 'Process_1' });
    expect(doc.rootElementsOfType('bpmn:Signal').map((signal) => signal.get('id'))).toEqual(['signal_done']);
    expect(new EventTrigger(doc.require('startEvent_sigStart')).describe()).toBe('signal Done');

    add(doc, { kind: 'endEvent:escalation', name: 'Esc', escalation: 'Too slow', escalationCode: 'SLOW', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent:escalation', name: 'Esc catch', on: 'Task_A', escalation: 'Too slow', nonInterrupting: true });
    expect(doc.rootElementsOfType('bpmn:Escalation')).toHaveLength(1);
    expect(new EventTrigger(doc.require('event_escCatch')).describe()).toBe('escalation Too slow (SLOW)');
    expect(new EventTrigger(doc.require('event_escCatch')).details()?.nonInterrupting).toBe(true);

    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:error id="error_paymentFailed" name="PaymentFailed" errorCode="PAY-001" \/>/);
    expect(xml).toMatch(/<bpmn:escalation id="escalation_tooSlow" name="Too slow" escalationCode="SLOW" \/>/);
    expect(xml).toMatch(/<bpmn:boundaryEvent id="event_escCatch" name="Esc catch" cancelActivity="false" attachedToRef="Task_A">/);
  });

  it('classifies timers and accepts an override', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'startEvent:timer', name: 'Cycle', timer: 'R/PT1H', in: 'Process_1' });
    add(doc, { kind: 'intermediateCatchEvent:timer', name: 'Duration', timer: 'PT5M', after: 'Task_A' });
    add(doc, { kind: 'startEvent:timer', name: 'Date', timer: '2030-01-01T00:00:00Z', in: 'Process_1' });
    add(doc, { kind: 'startEvent:timer', name: 'Cron', timer: '0 0 * * *', timerKind: 'cycle', in: 'Process_1' });
    add(doc, { kind: 'boundaryEvent', name: 'Inferred', on: 'Task_A', timer: 'PT1H' });
    expect(new EventTrigger(doc.require('startEvent_cycle')).details()?.timer).toEqual({ kind: 'cycle', value: 'R/PT1H' });
    expect(new EventTrigger(doc.require('event_duration')).details()?.timer).toEqual({ kind: 'duration', value: 'PT5M' });
    expect(new EventTrigger(doc.require('startEvent_date')).details()?.timer).toEqual({ kind: 'date', value: '2030-01-01T00:00:00Z' });
    expect(new EventTrigger(doc.require('startEvent_cron')).details()?.timer).toEqual({ kind: 'cycle', value: '0 0 * * *' });
    expect(new EventTrigger(doc.require('event_inferred')).describe()).toBe('PT1H');
    expect(new EventTrigger(doc.require('event_duration')).describe()).toBe('PT5M');
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
    expect(new EventTrigger(doc.require('event_cond')).describe()).toBe('condition ${x > 1}');
    expect(new EventTrigger(doc.require('event_jump')).describe()).toBe('link L1');
    expect(new EventTrigger(doc.require('event_l1')).describe()).toBe('link L1');
    expect(new EventTrigger(doc.require('endEvent_stop')).describe()).toBe('terminate');
    expect(new EventTrigger(doc.require('endEvent_comp')).describe()).toBe('compensate');
    expect(new EventTrigger(doc.require('endEvent_cancel')).describe()).toBe('cancel');
    expect(new EventTrigger(doc.require('event_undo')).describe()).toBe('compensate');
    expect(new EventTrigger(doc.require('Start')).describe()).toBe('');
    expect(new EventTrigger(doc.require('Task_A')).details()).toBeUndefined();
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:linkEventDefinition name="L1" \/>/);
    expect(xml).toMatch(/<bpmn:terminateEventDefinition \/>/);
  });

  it('enforces non-interrupting rules', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'boundaryEvent:timer', name: 'NI', on: 'Task_A', timer: 'PT1H', nonInterrupting: true });
    expect(cs.created[0]!.kind).toBe('boundaryEvent:timer');
    expect(doc.require('event_ni').get('cancelActivity')).toBe(false);
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent:error', on: 'Task_A', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent:cancel', on: 'Task_A', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'startEvent:message', message: 'M', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'endEvent', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
    // retriggering a non-interrupting boundary event to error makes it interrupting again
    new EventDefinitions(new EditSession(doc)).setTrigger(doc.require('event_ni'), 'error', { error: 'E' });
    expect(doc.require('event_ni').get('cancelActivity')).toBe(true);
    new EventDefinitions(new EditSession(doc)).setTrigger(doc.require('event_ni'), 'timer', { timer: 'PT1H', nonInterrupting: true });
    new EventDefinitions(new EditSession(doc)).setTrigger(doc.require('event_ni'), 'timer', { timer: 'PT1H', nonInterrupting: false });
    expect(doc.require('event_ni').get('cancelActivity')).toBe(true);
    await roundTrip(doc);
  });

  it('restricts start event triggers to event sub-processes and requires them there', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'startEvent:error', error: 'E', in: 'Process_1' }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'startEvent:escalation', escalation: 'E', in: 'Process_1' }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'startEvent:compensate', in: 'Process_1' }))).toBe('E_INVALID_TRIGGER');
    add(doc, { kind: 'eventSubProcess', name: 'On error' });
    expect(codeOf(() => add(doc, { kind: 'startEvent', in: 'subProcess_onError' }))).toBe('E_TRIGGER_REQUIRED');
    expect(codeOf(() => add(doc, { kind: 'boundaryEvent', on: 'Task_A' }))).toBe('E_TRIGGER_REQUIRED');
    const cs = add(doc, { kind: 'startEvent:error', name: 'Err', error: 'Boom', errorCode: 'B1', in: 'subProcess_onError' });
    expect(cs.created.map((change) => change.id)).toEqual(['startEvent_err', 'error_boom']);
    add(doc, { kind: 'startEvent:message', name: 'Msg', message: 'Ping', nonInterrupting: true, in: 'subProcess_onError' });
    expect(doc.require('startEvent_msg').get('isInterrupting')).toBe(false);
    expect(new EventTrigger(doc.require('startEvent_msg')).details()?.nonInterrupting).toBe(true);
    expect(codeOf(() => add(doc, { kind: 'startEvent:error', error: 'Boom', nonInterrupting: true, in: 'subProcess_onError' }))).toBe('E_INVALID_TRIGGER');
    add(doc, { kind: 'startEvent:timer', name: 'Tick', timer: 'R/PT1H', in: 'subProcess_onError' });
    add(doc, { kind: 'startEvent:signal', name: 'Sig', signal: 'S', in: 'subProcess_onError' });
    add(doc, { kind: 'startEvent:conditional', name: 'Cnd', when: '${a}', in: 'subProcess_onError' });
    add(doc, { kind: 'startEvent:escalation', name: 'Esc', escalation: 'Up', in: 'subProcess_onError' });
    add(doc, { kind: 'startEvent:compensate', name: 'Cmp', in: 'subProcess_onError' });
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:startEvent id="startEvent_msg" name="Msg" isInterrupting="false">/);
    expect(xml).toMatch(/<bpmn:errorEventDefinition errorRef="error_boom" \/>/);
  });

  it('warns about trigger options on non-events and switches triggers to none', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'userTask', name: 'T', in: 'Process_1', timer: 'PT1H' });
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
    add(doc, { kind: 'startEvent:message', name: 'M', message: 'X', in: 'Process_1' });
    new EventDefinitions(new EditSession(doc)).setTrigger(doc.require('startEvent_m'), 'none');
    expect(many(doc.require('startEvent_m'), 'eventDefinitions')).toHaveLength(0);
    expect(new EventTrigger(doc.require('startEvent_m')).describe()).toBe('');
    expect(codeOf(() => new EventDefinitions(new EditSession(doc)).setTrigger(doc.require('Task_A'), 'timer'))).toBe('E_WRONG_KIND');
    expect(codeOf(() => new EventDefinitions(new EditSession(doc)).setTrigger(doc.require('Start'), 'terminate'))).toBe('E_INVALID_TRIGGER');
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
    const collab = cs.created[0]!.id;
    // named after the process it wraps (Process_1 says nothing, and the process has no name: its kind)
    expect(collab).toBe('collaboration_process');
    expect(cs.created.map((change) => [change.id, change.kind])).toEqual([
      [collab, 'collaboration'],
      ['participant_shop', 'participant'],
    ]);
    expect(cs.created[1]!.detail).toBe('wraps process Process_1');
    expect(ids(many(doc.definitions, 'rootElements'))).toEqual([collab, 'Process_1']);
    expect(doc.require('participant_shop').get<El>('processRef').get('id')).toBe('Process_1');

    const cs2 = add(doc, { kind: 'pool', name: 'Customer' });
    expect(cs2.created.map((change) => change.id)).toEqual(['customer', 'participant_customer']);
    const proc = doc.require('customer');
    expect(proc.get('isExecutable')).toBe(false);
    expect(doc.participantOf(proc)?.get('id')).toBe('participant_customer');
    expect(ids(many(doc.definitions, 'rootElements'))).toEqual([collab, 'Process_1', 'customer']);

    const cs3 = add(doc, { kind: 'participant', name: 'Bank', blackBox: true });
    expect(cs3.created.map((change) => change.id)).toEqual(['participant_bank']);
    expect(doc.require('participant_bank').get('processRef')).toBeUndefined();
    expect(ids(doc.participants())).toEqual(['participant_shop', 'participant_customer', 'participant_bank']);

    expect(codeOf(() => add(doc, { kind: 'participant', name: 'X', process: 'Process_1' }))).toBe('E_PROCESS_BOUND');
    expect(codeOf(() => add(doc, { kind: 'participant', name: 'X', after: 'Task_A' }))).toBe('E_INVALID_PLACEMENT');
    expect(codeOf(() => add(doc, { kind: 'participant', name: 'X', blackBox: true, process: 'Process_1' }))).toBe('E_INVALID_VALUE');

    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(new RegExp(`<bpmn:collaboration id="${collab}">\\s*<bpmn:participant id="participant_shop" name="Shop" processRef="Process_1" />`));
    expect(xml).toMatch(/<bpmn:participant id="participant_bank" name="Bank" \/>/);
  });

  it('binds an explicitly named unbound process', async () => {
    const doc = await docFromXml(
      definitionsXml('<bpmn:startEvent id="S1" />', { extraRoots: '<bpmn:process id="Process_2" isExecutable="false"><bpmn:startEvent id="S2" /></bpmn:process>' }),
    );
    expect(codeOf(() => add(doc, { kind: 'participant', name: 'A' }))).toBe('E_AMBIGUOUS_SCOPE');
    add(doc, { kind: 'participant', name: 'A', process: 'Process_1' });
    add(doc, { kind: 'participant', name: 'B', process: 'Process_2' });
    expect(doc.participantOf(doc.require('Process_2'))?.get('id')).toBe('participant_b');
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
    expect(cs.created[0]).toMatchObject({ id: 'lane_sales', kind: 'lane', name: 'Sales', detail: 'in Process_1' });
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_LANES_WITHOUT_POOL', 'W_OPTION_IGNORED']);
    expect(cs.warnings[1]!.related).toEqual(['End']);
    const laneSet = ids(many(doc.require('Process_1'), 'laneSets'));
    expect(laneSet).toHaveLength(1);
    expect(laneSet[0]).toBe('laneSet_process');
    expect(ids(many(doc.require('lane_sales'), 'flowNodeRef'))).toEqual(['Start', 'Task_A', 'End']);

    add(doc, { kind: 'participant', name: 'Shop' });
    const cs2 = add(doc, { kind: 'lane', name: 'Backoffice', in: 'participant_shop', members: ['End', 'Task_A'] });
    expect(cs2.warnings).toHaveLength(0);
    expect(ids(many(doc.require('lane_sales'), 'flowNodeRef'))).toEqual(['Start']);
    expect(ids(many(doc.require('lane_backoffice'), 'flowNodeRef'))).toEqual(['End', 'Task_A']);
    expect(laneOf(doc, doc.require('Task_A'))?.get('id')).toBe('lane_backoffice');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:laneSet id="laneSet_process">\s*<bpmn:lane id="lane_sales" name="Sales">\s*<bpmn:flowNodeRef>Start<\/bpmn:flowNodeRef>/);
  });

  it('gives the first lane of a process all its flow nodes, later lanes none', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'participant', name: 'Shop' });
    const cs = add(doc, { kind: 'lane', name: 'Sales', in: 'participant_shop' });
    expect(cs.warnings).toHaveLength(0);
    expect(cs.notes.some((note) => note.includes('moved 3 member(s) of Process_1 into its first lane lane_sales'))).toBe(true);
    expect(ids(many(doc.require('lane_sales'), 'flowNodeRef'))).toEqual(['Start', 'Task_A', 'End']);
    add(doc, { kind: 'lane', name: 'Billing', in: 'participant_shop' });
    expect(ids(many(doc.require('lane_billing'), 'flowNodeRef'))).toEqual([]);
    expect(ids(many(doc.require('lane_sales'), 'flowNodeRef'))).toEqual(['Start', 'Task_A', 'End']);
  });

  it('nests lanes inside a lane, moving the parent members into the first child', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'participant', name: 'Shop' });
    const cs = add(doc, { kind: 'lane', name: 'Inbound', in: 'Lane_Sales' });
    expect(cs.created[0]!.detail).toBe('in lane Lane_Sales');
    expect(cs.notes.some((note) => note.includes('moved 2 member(s)'))).toBe(true);
    expect(ids(many(doc.require('Lane_Sales'), 'flowNodeRef'))).toEqual([]);
    expect(ids(many(doc.require('lane_inbound'), 'flowNodeRef'))).toEqual(['Start', 'Task_A']);
    add(doc, { kind: 'lane', name: 'Outbound', in: 'Lane_Sales', members: ['Task_A'] });
    expect(ids(many(doc.require('lane_inbound'), 'flowNodeRef'))).toEqual(['Start']);
    expect(laneOf(doc, doc.require('Task_A'))?.get('id')).toBe('lane_outbound');
    expect(ids(allLanes(doc.require('Process_1')))).toEqual(['Lane_Sales', 'lane_inbound', 'lane_outbound', 'Lane_Backoffice']);
    // parent lanes with children cannot take members directly
    expect(codeOf(() => new Lanes(new EditSession(doc)).assign(doc.require('End'), doc.require('Lane_Sales'), new ChangeSet()))).toBe('E_INVALID_LANE_MEMBERSHIP');
    // nodes added after a member inherit the nested lane
    add(doc, { kind: 'task', name: 'Ship', after: 'Task_A' });
    expect(laneOf(doc, doc.require('task_ship'))?.get('id')).toBe('lane_outbound');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:lane id="Lane_Sales" name="Sales">\s*<bpmn:childLaneSet id="laneSet_sales">\s*<bpmn:lane id="lane_inbound" name="Inbound">/);
  });

  it('Lanes.assign moves nodes with their boundary events and rejects sub-process children', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'boundaryEvent:timer', name: 'BE', on: 'Task_A', timer: 'PT1H' });
    const cs = new ChangeSet();
    new Lanes(new EditSession(doc)).assign(doc.require('Task_A'), doc.require('Lane_Backoffice'), cs);
    expect(ids(many(doc.require('Lane_Backoffice'), 'flowNodeRef'))).toEqual(['End', 'Task_A', 'event_be']);
    expect(ids(many(doc.require('Lane_Sales'), 'flowNodeRef'))).toEqual(['Start']);
    new Lanes(new EditSession(doc)).assign(doc.require('Task_A'), undefined, cs);
    expect(doc.lanesOf(doc.require('Task_A'))).toHaveLength(0);
    expect(doc.lanesOf(doc.require('event_be'))).toHaveLength(0);
    expect(cs.changed.some((change) => change.id === 'Task_A' && change.detail === 'removed from lanes')).toBe(true);

    add(doc, { kind: 'subProcess', name: 'Sub', after: 'Task_A' });
    add(doc, { kind: 'task', name: 'Inner', in: 'subProcess_sub' });
    expect(codeOf(() => add(doc, { kind: 'task', name: 'Inner2', after: 'task_inner', lane: 'Lane_Sales' }))).toBe('E_INVALID_LANE_MEMBERSHIP');
    expect(codeOf(() => add(doc, { kind: 'lane', name: 'Nope', in: 'subProcess_sub' }))).toBe('E_INVALID_SCOPE');
    // the sub-process itself can be a member and inner nodes silently inherit nothing
    const cs2 = add(doc, { kind: 'task', name: 'Inner3', after: 'task_inner' });
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
    expect(cs.created[0]).toMatchObject({ id: 'dataObject_order', kind: 'dataObject', name: 'Order' });
    expect(doc.require('dataObject_order').get<El>('dataObjectRef').get('id')).toBe('dataObjectItem_order');
    expect(is(doc.require('dataObjectItem_order'), 'bpmn:DataObject')).toBe(true);

    const out = connect(doc, { source: 'Task_A', target: 'dataObject_order' });
    const outId = out.created[0]!.id;
    expect(outId).toBe('association_doAToOrder');
    expect(out.created[0]).toMatchObject({ kind: 'dataAssociation', detail: 'Task_A -> dataObject_order' });
    const inp = connect(doc, { source: 'dataObject_order', target: 'Task_A' });
    const inId = inp.created[0]!.id;
    expect(inId).toBe('association_orderToDoA');
    expect(inp.created[0]).toMatchObject({ kind: 'dataAssociation' });
    const task = doc.require('Task_A');
    expect(ids(many(task, 'dataOutputAssociations'))).toEqual([outId]);
    expect(ids(many(task, 'dataInputAssociations'))).toEqual([inId]);
    const prop = many(task, 'properties')[0]!;
    expect(prop.get('name')).toBe(PLACEHOLDER_PROPERTY);
    expect(prop.get('id')).toBe('property_doA');
    expect(doc.require(inId).get<El>('targetRef')).toBe(prop);

    expect(codeOf(() => add(doc, { kind: 'dataObject', name: 'X', after: 'Task_A' }))).toBe('E_INVALID_PLACEMENT');
    expect(codeOf(() => connect(doc, { source: 'dataObject_order', target: 'dataObject_order' }))).toBe('E_INVALID_ENDPOINT');
    expect(connect(doc, { source: 'Task_A', target: 'dataObject_order', ifAbsent: true }).isEmpty).toBe(true);

    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:dataObject id="dataObjectItem_order" \/>\s*<bpmn:dataObjectReference id="dataObject_order" name="Order" dataObjectRef="dataObjectItem_order" \/>/);
    const propId = String(prop.get('id'));
    expect(xml).toContain(`<bpmn:property id="${propId}" name="__targetRef_placeholder" />`);
    expect(xml).toMatch(new RegExp(`<bpmn:dataInputAssociation id="${inId}">\\s*<bpmn:sourceRef>dataObject_order</bpmn:sourceRef>\\s*<bpmn:targetRef>${propId}</bpmn:targetRef>`));
    expect(xml).toMatch(new RegExp(`<bpmn:dataOutputAssociation id="${outId}">\\s*<bpmn:targetRef>dataObject_order</bpmn:targetRef>`));

    // removal cleans the placeholder property
    new Associations(new EditSession(doc)).removeDataAssociation(doc.require(inId));
    expect(many(task, 'properties')).toHaveLength(0);
    expect(many(task, 'dataInputAssociations')).toHaveLength(0);
    expect(doc.has(inId)).toBe(false);
    await roundTrip(doc);
  });

  it('creates data stores with a root bpmn:DataStore and --to wiring', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'dataStore', name: 'Order DB', to: 'Task_A' });
    expect(cs.created.map((change) => change.id)).toEqual(['dataStore_orderDB', 'association_orderDBToDoA']);
    expect(doc.rootElementsOfType('bpmn:DataStore').map((store) => store.get('id'))).toEqual(['dataStoreItem_orderDB']);
    expect(doc.require('dataStore_orderDB').get<El>('dataStoreRef').get('id')).toBe('dataStoreItem_orderDB');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'dataStore_orderDB' }))).toBe('NO_ERROR');
    expect(codeOf(() => connect(doc, { source: 'dataStore_orderDB', target: 'Start' }))).toBe('E_INVALID_ENDPOINT');
    add(doc, { kind: 'parallelGateway', name: 'G', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'gateway_g', target: 'dataStore_orderDB' }))).toBe('E_INVALID_ENDPOINT');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:dataStore id="dataStoreItem_orderDB" name="Order DB" \/>/);
    expect(xml).toMatch(/<bpmn:dataStoreReference id="dataStore_orderDB" name="Order DB" dataStoreRef="dataStoreItem_orderDB" \/>/);
  });

  it('creates text annotations and associations via connect / --to', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'textAnnotation', text: 'Check twice' });
    const note = cs.created[0]!.id;
    expect(note).toBe('textAnnotation_checkTwice');
    expect(cs.created[0]).toMatchObject({ kind: 'textAnnotation', name: 'Check twice' });
    const assoc = connect(doc, { source: note, target: 'Task_A' });
    const assocId = assoc.created[0]!.id;
    expect(assocId).toBe('association_checkTwiceToDoA');
    expect(assoc.created[0]).toMatchObject({ kind: 'association', detail: `${note} -> Task_A` });
    expect(ids(many(doc.require('Process_1'), 'artifacts'))).toEqual([note, assocId]);
    expect(connect(doc, { source: 'Task_A', target: note, ifAbsent: true }).isEmpty).toBe(true);
    expect(codeOf(() => connect(doc, { source: 'Task_A', target: note, condition: 'x' }))).toBe('E_INVALID_VALUE');

    // the positional name gives the id (prefix_camelCase like every other kind) and, without --text, the text
    const cs2 = add(doc, { kind: 'note', name: 'Note via name', to: 'End' });
    const assoc2 = cs2.created[1]!.id;
    expect(cs2.created.map((change) => change.id)).toEqual(['textAnnotation_noteViaName', assoc2]);
    expect(assoc2).toBe('association_endToNoteViaName');
    expect(doc.require('textAnnotation_noteViaName').get('text')).toBe('Note via name');
    expect(edge(doc, assoc2)).toBe('End->textAnnotation_noteViaName');
    const two = add(doc, { kind: 'textAnnotation', text: 'Two' }).created[0]!.id;
    expect(two).not.toBe(note);
    expect(codeOf(() => connect(doc, { source: 'textAnnotation_noteViaName', target: two }))).toBe('E_INVALID_ENDPOINT');
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(new RegExp(`<bpmn:textAnnotation id="${note}">\\s*<bpmn:text>Check twice</bpmn:text>\\s*</bpmn:textAnnotation>`));
    expect(xml).toContain(`<bpmn:association id="${assocId}" sourceRef="${note}" targetRef="Task_A" />`);
  });

  it('draws compensation associations from compensate boundary events', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'boundaryEvent:compensate', name: 'Undo', on: 'Task_A' });
    add(doc, { kind: 'task', name: 'Undo A', in: 'Process_1' });
    const cs = connect(doc, { source: 'event_undo', target: 'task_undoA' });
    expect(cs.created[0]).toMatchObject({ id: 'association_undoToUndoA', kind: 'association' });
    expect(doc.require(cs.created[0]!.id).get('associationDirection')).toBe('One');
    expect(doc.require('task_undoA').get('isForCompensation')).toBe(true);
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(/<bpmn:task id="task_undoA" name="Undo A" isForCompensation="true" \/>/);
  });

  it('createDataAssociation validates node kinds', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'dataObject', name: 'D' });
    const cs = new ChangeSet();
    expect(codeOf(() => new Associations(new EditSession(doc)).createDataAssociation(doc.require('dataObject_d'), doc.require('End'), {}, cs))).toBe('NO_ERROR');
    expect(codeOf(() => new Associations(new EditSession(doc)).createDataAssociation(doc.require('End'), doc.require('dataObject_d'), {}, cs))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => new Associations(new EditSession(doc)).createDataAssociation(doc.require('Start'), doc.require('dataObject_d'), {}, cs))).toBe('NO_ERROR');
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
    const cs = connect(doc, { source: 'Task_A', target: 'task_b', name: 'again', condition: '${retry}', id: 'Flow_Retry' });
    expect(cs.created[0]).toMatchObject({ id: 'Flow_Retry', kind: 'sequenceFlow', name: 'again', detail: 'Task_A -> task_b' });
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_IMPLICIT_SPLIT']);
    expect(doc.require('Flow_Retry').get<El>('conditionExpression').get('body')).toBe('${retry}');
    const cs2 = connect(doc, { source: 'task_b', target: 'End' });
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_IMPLICIT_JOIN']);
    expect(connect(doc, { source: 'task_b', target: 'End', ifAbsent: true }).isEmpty).toBe(true);
    expect(codeOf(() => connect(doc, { source: 'End', target: 'Task_A' }))).toBe('E_INVALID_SOURCE');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'Start' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'Task_A', target: 'task_b', message: 'M' }))).toBe('E_INVALID_VALUE');
    await roundTrip(doc);
  });

  it('refuses a second incoming flow into a target of an event-based gateway, both ways', async () => {
    const doc = await docFromXml(EVENT_GATEWAY);
    const before = await doc.toXml();
    expect(codeOf(() => connect(doc, { source: 'Task_A', target: 'Event_Paid' }))).toBe('E_INVALID_TARGET');
    expect(codeOf(() => connect(doc, { source: 'Gw', target: 'Task_A' }))).toBe('E_INVALID_TARGET');
    expect(await doc.toXml()).toBe(before);
    const sequenceFlows = new SequenceFlows(new EditSession(doc));
    expect(codeOf(() => sequenceFlows.redirect(doc.require('F2'), { target: doc.require('Event_Paid') }))).toBe('E_INVALID_TARGET');
    expect(await doc.toXml()).toBe(before);
    sequenceFlows.redirect(doc.require('F3'), { target: doc.require('Event_Loose') });
    expect(doc.require('Event_Loose').get<El[]>('incoming').map((flow) => flow.id)).toEqual(['F3']);
  });

  it('refuses a flow out of a link throw event and into a link catch event', async () => {
    const doc = await linearDoc();
    add(doc, { kind: 'intermediateThrowEvent:link', name: 'To shipping', link: 'Shipping', in: 'Process_1' });
    add(doc, { kind: 'intermediateCatchEvent:link', name: 'From order', link: 'Shipping', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'event_toShipping', target: 'End' }))).toBe('E_INVALID_SOURCE');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'event_fromOrder' }))).toBe('E_INVALID_TARGET');
    expect(codeOf(() => add(doc, { kind: 'endEvent', name: 'Done', after: 'event_toShipping' }))).toBe('E_INVALID_SOURCE');
    expect(connect(doc, { source: 'Task_A', target: 'event_toShipping' }).created).toHaveLength(1);
    expect(connect(doc, { source: 'event_fromOrder', target: 'End' }).created).toHaveLength(1);
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
    expect(codeOf(() => connect(doc, { source: 'sendTask_send', target: 'Task_A', message: 'X' }))).toBe('E_INVALID_VALUE');
    add(doc, { kind: 'participant', name: 'Shop' });
    add(doc, { kind: 'participant', name: 'Customer' });
    add(doc, { kind: 'startEvent:message', name: 'Got it', message: 'Offer', in: 'participant_customer' });
    add(doc, { kind: 'participant', name: 'Bank', blackBox: true });

    // message flows name their ends
    const cs = connect(doc, { source: 'sendTask_send', target: 'startEvent_gotIt', message: 'Offer', name: 'offer' });
    const offer = cs.created[0]!.id;
    expect(offer).toBe('messageFlow_sendToGotIt');
    expect(cs.created[0]).toMatchObject({ kind: 'messageFlow', name: 'offer', detail: 'sendTask_send -> startEvent_gotIt' });
    expect(doc.require(offer).get<El>('messageRef').get('id')).toBe('message_offer');
    expect(doc.rootElementsOfType('bpmn:Message')).toHaveLength(1);

    const cs2 = connect(doc, { source: 'participant_bank', target: 'Task_A', message: 'Statement' });
    const statement = cs2.created[1]!.id;
    expect(cs2.created.map((change) => change.id)).toEqual(['message_statement', statement]);
    const cs3 = connect(doc, { source: 'sendTask_send', target: 'participant_bank' });
    expect(cs3.created[0]!.kind).toBe('messageFlow');
    expect(connect(doc, { source: 'sendTask_send', target: 'participant_bank', ifAbsent: true }).isEmpty).toBe(true);
    expect(ids(doc.messageFlows())).toEqual([offer, statement, cs3.created[0]!.id]);
    expect(new Set(ids(doc.messageFlows())).size).toBe(3);

    expect(codeOf(() => connect(doc, { source: 'Task_A', target: 'participant_shop' }))).toBe('E_SAME_POOL');
    expect(codeOf(() => connect(doc, { source: 'sendTask_send', target: 'startEvent_gotIt', condition: 'x' }))).toBe('E_INVALID_VALUE');
    add(doc, { kind: 'exclusiveGateway', name: 'G', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'gateway_g', target: 'participant_bank' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'startEvent_gotIt', target: 'participant_bank' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'participant_bank', target: 'sendTask_send' }))).toBe('NO_ERROR');
    const { xml } = await roundTrip(doc);
    expect(xml).toContain(`<bpmn:messageFlow id="${offer}" name="offer" sourceRef="sendTask_send" targetRef="startEvent_gotIt" messageRef="message_offer" />`);
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
    const op: SplitIntoBranches = {
      op: 'split',
      after: 'Task_A',
      name: 'Invoice ok?',
      branches: [
        { flowName: 'yes', condition: '${ok}', nodes: [{ kind: 'serviceTask', name: 'Book' }, { kind: 'userTask', name: 'Archive' }] },
        { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Clarify' }] },
      ],
    };
    const cs = new BranchSplit(new EditSession(doc)).split(op);
    const created = cs.created.filter((change) => change.kind !== 'sequenceFlow').map((change) => change.id);
    expect(created).toEqual(['gateway_invoiceOk', 'serviceTask_book', 'userTask_archive', 'userTask_clarify', 'gateway_invoiceOkJoin']);
    expect(cs.created.find((change) => change.id === 'gateway_invoiceOk')!.detail).toBe('between Task_A and End');
    expect(cs.created.find((change) => change.id === 'gateway_invoiceOkJoin')!.detail).toBe('join of gateway_invoiceOk');
    expect(cs.warnings).toHaveLength(0);

    const gw = doc.require('gateway_invoiceOk');
    const join = doc.require('gateway_invoiceOkJoin');
    expect(edge(doc, 'F2')).toBe('Task_A->gateway_invoiceOk');
    const out = doc.outgoing(gw);
    expect(out.map((flow) => `${flow.get('name')}:${flow.get<El>('targetRef').get('id')}`)).toEqual(['yes:serviceTask_book', 'no:userTask_clarify']);
    expect(out[0]!.get<El>('conditionExpression').get('body')).toBe('${ok}');
    expect(gw.get<El>('default')).toBe(out[1]);
    expect(edge(doc, ids(doc.outgoing(doc.require('serviceTask_book')))[0]!)).toBe('serviceTask_book->userTask_archive');
    expect(doc.incoming(join).map((flow) => flow.get<El>('sourceRef').get('id'))).toEqual(['userTask_archive', 'userTask_clarify']);
    expect(doc.outgoing(join).map((flow) => flow.get<El>('targetRef').get('id'))).toEqual(['End']);
    expect(doc.incoming(doc.require('End'))).toHaveLength(1);
    // declaration order: gateway right after its incoming flow, branches in order
    const order = flowIds(doc);
    expect(order.indexOf('gateway_invoiceOk')).toBe(order.indexOf('F2') + 1);
    expect(order.indexOf('serviceTask_book')).toBeLessThan(order.indexOf('userTask_clarify'));
    expect(cs.notes.some((note) => note.startsWith('split gateway_invoiceOk'))).toBe(true);
    await roundTrip(doc);
  });

  it('without a join every branch end connects to the old successor (implicit join warnings)', async () => {
    const doc = await linearDoc();
    const cs = new BranchSplit(new EditSession(doc)).split({
      op: 'split',
      after: 'Task_A',
      kind: 'parallel',
      join: false,
      branches: [{ nodes: [{ kind: 'task', name: 'P1' }] }, { nodes: [{ kind: 'task', name: 'P2' }] }],
    });
    const gateway = cs.created.find((change) => change.kind === 'parallelGateway')!.id;
    expect(gateway).toBe('gateway_afterDoA');
    expect(is(doc.require(gateway), 'bpmn:ParallelGateway')).toBe(true);
    expect(doc.has(`${gateway}Join`)).toBe(false);
    expect(doc.incoming(doc.require('End')).map((flow) => flow.get<El>('sourceRef').get('id'))).toEqual(['task_p1', 'task_p2']);
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_IMPLICIT_JOIN']);
    await roundTrip(doc);
  });

  it('appends after gateways / unconnected nodes and supports empty branches', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    const cs = new BranchSplit(new EditSession(doc)).split({
      op: 'split',
      after: 'Loose',
      id: 'Gateway_Split',
      joinId: 'Gateway_Merge',
      joinName: 'merge',
      branches: [{ nodes: [{ kind: 'task', name: 'Work' }] }, { flowName: 'skip', nodes: [] }],
    });
    expect(cs.created.find((change) => change.id === 'Gateway_Split')!.detail).toBe('after Loose');
    expect(edge(doc, ids(doc.outgoing(doc.require('Loose')))[0]!)).toBe('Loose->Gateway_Split');
    const gwOut = doc.outgoing(doc.require('Gateway_Split'));
    expect(gwOut.map((flow) => flow.get<El>('targetRef').get('id'))).toEqual(['task_work', 'Gateway_Merge']);
    expect(gwOut[1]!.get('name')).toBe('skip');
    expect(doc.outgoing(doc.require('Gateway_Merge'))).toHaveLength(0);
    expect(doc.require('Gateway_Merge').get('name')).toBe('merge');

    // after a gateway: appended as another branch, old branches untouched
    new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'GW', name: 'Nested?', branches: [{ nodes: [{ kind: 'task', name: 'N1' }] }] });
    expect(ids(doc.outgoing(doc.require('GW')))).toHaveLength(2);
    expect(edge(doc, 'F2')).toBe('GW->Task_A');
    await roundTrip(doc);
  });

  it('validates kind, branches and anchors', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'Task_A', kind: 'userTask', branches: [{ nodes: [] }] }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'Task_A', branches: [] }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'Nope', branches: [{ nodes: [] }] }))).toBe('E_NOT_FOUND');
    add(doc, { kind: 'task', name: 'Alone', in: 'Process_1' });
    expect(codeOf(() => new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'task_alone', join: false, branches: [{ nodes: [] }] }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'Task_A', kind: 'choreographyTask', branches: [{ nodes: [] }] }))).toBe('E_UNKNOWN_KIND');
  });

  it('typed ops (mutateDoc, no parseOps): a branch without a nodes array is E_USAGE in parseOps\' words, and the document stays as it was', async () => {
    const doc = await linearDoc();
    const before = await doc.toXml();
    // what the CLI's parseOps says about the same op (message with `ops[0] (split)` -> `split`, and hint)
    const cli = (branches: unknown): [string, unknown] => {
      try {
        parseOps([{ op: 'split', after: 'Task_A', branches }]);
      } catch (err) {
        const bpmnError = err as BpmnError;
        return [bpmnError.message.replace(/^ops\[0\] \(split\)/, 'split'), bpmnError.details?.hint];
      }
      return ['NO_ERROR', undefined];
    };
    const refused = async (branches: unknown): Promise<[string | undefined, string, unknown]> => {
      try {
        await mutateDoc(doc, [{ op: 'split', after: 'Task_A', branches } as unknown as SplitIntoBranches]);
      } catch (err) {
        const bpmnError = err as BpmnError;
        expect([bpmnError.message, bpmnError.details?.hint]).toEqual(cli(branches));
        return [bpmnError.code, bpmnError.message, bpmnError.details?.op];
      }
      return ['NO_ERROR', '', undefined];
    };
    // the CLI (parseOps) refuses a branch without nodes: it is no direct flow here either
    const nodesKey = `missing required key "nodes" (${BRANCH_FIELDS.nodes.description})`;
    expect(await refused([{ flowName: 'yes' }, { flowName: 'no' }])).toEqual(['E_USAGE', `split branches[0]: ${nodesKey}`, 0]);
    expect(await refused([{ nodes: [{ kind: 'task', name: 'A' }] }, { flowName: 'no', nodes: null }])).toEqual(['E_USAGE', `split branches[1]: ${nodesKey}`, 0]);
    // no TypeError: the batch aliases read only arrays of objects (domain/commands/CommandAliases.ts), the split checks the shape
    expect(await refused([{ nodes: 'abc' }, { nodes: [] }])).toEqual(['E_USAGE', 'split branches[0]: "nodes" must be an array of node objects, got string "abc"', 0]);
    expect(await refused('oops')).toEqual(['E_USAGE', 'split: "branches" must be an array of branch objects, got string "oops"', 0]);
    expect(await refused({ nodes: [] })).toEqual(['E_USAGE', 'split: "branches" must be an array of branch objects, got an object', 0]);
    expect(await refused([null, { nodes: [] }])).toEqual(['E_USAGE', 'split branches[0]: expected an object, got null', 0]);
    // a node that is no object fails before the split gateway is added
    expect(await refused([{ nodes: ['x'] }, { nodes: [] }])).toEqual(['E_USAGE', 'split branches[0].nodes[0]: expected an object, got string "x"', 0]);
    // a node without a string kind too (it used to throw a TypeError with the split gateway already added)
    const kindKey = `missing required key "kind" (${NODE_FIELDS.kind.description})`;
    expect(await refused([{ nodes: [{ name: 'B' }] }, { nodes: [] }])).toEqual(['E_USAGE', `split branches[0].nodes[0]: ${kindKey}`, 0]);
    expect(await refused([{ nodes: [{ kind: 'task', name: 'B' }, {}] }, { nodes: [] }])).toEqual(['E_USAGE', `split branches[0].nodes[1]: ${kindKey}`, 0]);
    expect(await refused([{ nodes: [{ kind: 5 }] }, { nodes: [] }])).toEqual(['E_USAGE', 'split branches[0].nodes[0]: "kind" must be a string, got number 5', 0]);
    expect(await doc.toXml()).toBe(before);
    // an empty nodes array is still a direct gateway -> join flow
    const result = await mutateDoc(doc, [{ op: 'split', after: 'Task_A', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { flowName: 'no', nodes: [] }] }], { layout: false });
    expect(result.changes.created.map((change) => change.id)).toContain('gateway_afterDoAJoin');
    expect(flowBetween(doc, 'gateway_afterDoA', 'gateway_afterDoAJoin')).toBeTruthy();
  });

  it('branch nodes inherit the anchor lane and can carry triggers', async () => {
    const doc = await docFromXml(WITH_LANES);
    const cs = new BranchSplit(new EditSession(doc)).split({
      op: 'split',
      after: 'Task_A',
      kind: 'eventBased',
      join: false,
      branches: [
        { nodes: [{ kind: 'intermediateCatchEvent:timer', name: 'Timeout', timer: 'PT1H' }] },
        { nodes: [{ kind: 'intermediateCatchEvent:message', name: 'Reply', message: 'Reply' }] },
      ],
    });
    expect(laneOf(doc, doc.require(cs.created.find((change) => change.kind === 'eventBasedGateway')!.id))?.get('id')).toBe('Lane_Sales');
    expect(laneOf(doc, doc.require('event_timeout'))?.get('id')).toBe('Lane_Sales');
    expect(new EventTrigger(doc.require('event_reply')).describe()).toBe('message Reply');
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
    const start = cs.created[1]!.id;
    expect(start).toBe('startEvent_errorInHandleErrors');
    expect(cs.created.map((change) => [change.id, change.kind])).toEqual([
      ['subProcess_handleErrors', 'eventSubProcess'],
      [start, 'startEvent:error'],
      ['error_paymentFailed', 'error'],
    ]);
    expect(cs.created[1]!.detail).toBe('start of event sub-process subProcess_handleErrors');
    expect(cs.warnings).toHaveLength(0);
    expect(ids(doc.flowNodes(doc.require('subProcess_handleErrors')))).toEqual([start]);
    expect(new EventTrigger(doc.require(start)).describe()).toBe('error PaymentFailed (PAY-1)');

    const cs2 = add(doc, { kind: 'eventSubProcess:message', name: 'On cancel', message: 'Cancel', nonInterrupting: true, in: 'Process_1' });
    expect(cs2.created.map((change) => change.kind)).toEqual(['eventSubProcess', 'startEvent:message', 'message']);
    const start2 = cs2.created[1]!.id;
    expect(start2).not.toBe(start);
    expect(doc.require(start2).get('isInterrupting')).toBe(false);
    expect(doc.scopeOf(doc.require(start2))?.get('id')).toBe('subProcess_onCancel');
    // --timer infers the trigger as well, aliases work
    const cs3 = add(doc, { kind: 'eventSub', name: 'Tick', timer: 'R/PT1H' });
    expect(new EventTrigger(doc.require(cs3.created[1]!.id)).details()?.timer).toEqual({ kind: 'cycle', value: 'R/PT1H' });
    const { xml } = await roundTrip(doc);
    expect(xml).toMatch(new RegExp(`<bpmn:subProcess id="subProcess_handleErrors" name="Handle errors" triggeredByEvent="true">\\s*<bpmn:startEvent id="${start}">\\s*<bpmn:errorEventDefinition errorRef="error_paymentFailed" />`));
  });

  it('rejects triggers a start event cannot have; without a trigger nothing is created inside', async () => {
    const doc = await linearDoc();
    expect(codeOf(() => add(doc, { kind: 'eventSubProcess:terminate', name: 'X' }))).toBe('E_INVALID_TRIGGER');
    expect(codeOf(() => add(doc, { kind: 'eventSubProcess:nope', name: 'X' }))).toBe('E_INVALID_TRIGGER');
    expect(caught(() => add(doc, { kind: 'eventSubProcess:terminate', name: 'X' }))?.details?.candidates).toContain('error');
    expect(doc.has('subProcess_x')).toBe(false);
    const cs = add(doc, { kind: 'eventSubProcess', name: 'Plain', nonInterrupting: true });
    expect(cs.created.map((change) => change.id)).toEqual(['subProcess_plain']);
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
    expect(add(doc, { kind: 'eventSubProcess', name: 'Empty' }).warnings).toHaveLength(0);
    expect(doc.flowNodes(doc.require('subProcess_empty'))).toHaveLength(0);
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
      ['choreographyTask', 'E_UNSUPPORTED_KIND'],
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
    expect(err?.details?.hint).toContain('--id userTask_checkOrder');
    expect(doc.has('userTask_checkOrder2')).toBe(false);
    expect(edge(doc, 'F2')).toBe('Task_A->userTask_checkOrder');
    expect(add(doc, { kind: 'userTask', id: 'userTask_checkOrder', after: 'Task_A', ifAbsent: true }).isEmpty).toBe(true);
  });

  it('rejects default + condition and empty conditions before mutating anything (add and connect)', async () => {
    const doc = await docFromXml(WITH_GATEWAY);
    expect(codeOf(() => add(doc, { kind: 'task', name: 'DC', after: 'GW', default: true, condition: '${x}' }))).toBe('E_USAGE');
    expect(codeOf(() => add(doc, { kind: 'task', name: 'EC', after: 'GW', condition: '' }))).toBe('E_INVALID_VALUE');
    expect(codeOf(() => add(doc, { kind: 'task', name: 'EC', after: 'GW', condition: '   ' }))).toBe('E_INVALID_VALUE');
    expect(doc.has('task_dc')).toBe(false);
    expect(doc.has('task_ec')).toBe(false);
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
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
    expect(cs.warnings[0]!.message).toContain('--flow-id Flow_custom');
    expect(cs.warnings[0]!.related).toEqual(['F1']);
    expect(cs.warnings[0]!.hint).toContain('bpmn set <file> F1 id=Flow_custom');
    // after a node with a successor splices too
    const cs2 = add(doc, { kind: 'task', name: 'Mid2', after: 'task_mid', flowId: 'Flow_custom2' });
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
    expect(doc.has('Flow_custom2')).toBe(false);
    // append / prepend create the flow with that id: no warning
    add(doc, { kind: 'task', name: 'Loose', in: 'Process_1' });
    const cs3 = add(doc, { kind: 'task', name: 'Tail', after: 'task_loose', flowId: 'Flow_custom3' });
    expect(cs3.warnings).toHaveLength(0);
    expect(edge(doc, 'Flow_custom3')).toBe('task_loose->task_tail');
    const cs4 = add(doc, { kind: 'task', name: 'Head', before: 'task_loose', flowId: 'Flow_custom4', flowName: 'in' });
    expect(cs4.warnings).toHaveLength(0);
    expect(edge(doc, 'Flow_custom4')).toBe('task_head->task_loose');
    // --in creates no flow into the node
    const cs5 = add(doc, { kind: 'task', name: 'Alone', in: 'Process_1', flowName: 'x', condition: '${y}' });
    expect(cs5.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
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
    expect(new EventTrigger(doc.require('startEvent_good')).details()?.timer).toEqual({ kind: 'cycle', value: 'PT2D' });
  });

  it('names text annotations by the positional name and warns only on real id collisions', async () => {
    const doc = await linearDoc();
    const cs = add(doc, { kind: 'note', name: 'Approval note', text: 'Offers above 10k need approval' });
    expect(cs.created[0]).toMatchObject({ id: 'textAnnotation_approvalNote', kind: 'textAnnotation', name: 'Offers above 10k need approval' });
    expect(doc.require('textAnnotation_approvalNote').get('text')).toBe('Offers above 10k need approval');
    expect(cs.warnings).toHaveLength(0);
    const cs2 = add(doc, { kind: 'note', name: 'Approval note' });
    expect(cs2.created[0]!.id).toBe('textAnnotation_approvalNote2');
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_ID_SUFFIXED']);
    const cs3 = add(doc, { kind: 'note', text: 'only text' });
    expect(cs3.created[0]!.id).toBe('textAnnotation_onlyText');
    expect(cs3.warnings).toHaveLength(0);
    await roundTrip(doc);
  });
});

describe('connect: self-loops', () => {
  it('allows a sequence flow from an activity to itself (with a loop-marker hint), nothing else', async () => {
    const doc = await linearDoc();
    const cs = connect(doc, { source: 'Task_A', target: 'Task_A', name: 'again' });
    expect(cs.created[0]).toMatchObject({ kind: 'sequenceFlow', name: 'again', detail: 'Task_A -> Task_A' });
    expect(cs.notes.some((note) => note.includes('bpmn set <file> Task_A loop=standard'))).toBe(true);
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN']);
    expect(connect(doc, { source: 'Task_A', target: 'Task_A', ifAbsent: true }).isEmpty).toBe(true);
    add(doc, { kind: 'exclusiveGateway', name: 'G', in: 'Process_1' });
    expect(codeOf(() => connect(doc, { source: 'gateway_g', target: 'gateway_g' }))).toBe('E_INVALID_ENDPOINT');
    expect(codeOf(() => connect(doc, { source: 'Start', target: 'Start' }))).toBe('E_INVALID_ENDPOINT');
    const note = add(doc, { kind: 'textAnnotation', text: 'n' }).created[0]!.id;
    expect(codeOf(() => connect(doc, { source: note, target: note }))).toBe('E_INVALID_ENDPOINT');
    add(doc, { kind: 'participant', name: 'P' });
    expect(codeOf(() => connect(doc, { source: 'participant_p', target: 'participant_p' }))).toBe('E_INVALID_ENDPOINT');
    const { xml } = await roundTrip(doc);
    expect(xml).toContain(`<bpmn:sequenceFlow id="${cs.created[0]!.id}" name="again" sourceRef="Task_A" targetRef="Task_A" />`);
    // a body naming the ends
    expect(cs.created[0]!.id).toBe('flow_doAToDoA');
  });
});

describe('split: terminating branches', () => {
  it('a branch ending in an end event stops there; the one that continues runs on without a pass-through join', async () => {
    const doc = await linearDoc();
    const cs = new BranchSplit(new EditSession(doc)).split({
      op: 'split',
      after: 'Task_A',
      name: 'Ok?',
      branches: [
        { flowName: 'yes', nodes: [{ kind: 'task', name: 'Book' }] },
        { flowName: 'no', default: true, nodes: [{ kind: 'end', name: 'Rejected' }] },
      ],
    });
    // a join only task_book would reach is no join: none is created
    expect(doc.has('gateway_okJoin')).toBe(false);
    expect(doc.outgoing(doc.require('task_book')).map((flow) => edge(doc, flow.get<string>('id')))).toEqual(['task_book->End']);
    expect(doc.outgoing(doc.require('endEvent_rejected'))).toHaveLength(0);
    expect(doc.require('gateway_ok').get<El>('default').get<El>('targetRef').get('id')).toBe('endEvent_rejected');
    expect(cs.notes.some((note) => note.includes('endEvent_rejected terminates'))).toBe(true);
    expect(cs.notes.some((note) => note.includes('no join gateway created'))).toBe(true);
    expect(cs.warnings).toHaveLength(0);
    await roundTrip(doc);
  });

  it('with every branch terminating no join is created and the lost successor is noted; join:false stops the end branch too', async () => {
    const doc = await linearDoc();
    const cs = new BranchSplit(new EditSession(doc)).split({ op: 'split', after: 'Task_A', branches: [{ nodes: [{ kind: 'end', name: 'A' }] }, { nodes: [{ kind: 'end', name: 'B' }] }] });
    expect(doc.has('gateway_afterDoAJoin')).toBe(false);
    expect(doc.incoming(doc.require('End'))).toHaveLength(0);
    expect(cs.notes.some((note) => note.includes('no join gateway created'))).toBe(true);
    expect(cs.notes.some((note) => note.includes('End is no longer reached'))).toBe(true);

    const doc2 = await linearDoc();
    const cs2 = new BranchSplit(new EditSession(doc2)).split({ op: 'split', after: 'Task_A', join: false, branches: [{ nodes: [{ kind: 'task', name: 'Go' }] }, { nodes: [{ kind: 'end', name: 'Stop' }] }] });
    expect(doc2.incoming(doc2.require('End')).map((flow) => flow.get<El>('sourceRef').get('id'))).toEqual(['task_go']);
    expect(doc2.outgoing(doc2.require('endEvent_stop'))).toHaveLength(0);
    expect(cs2.warnings).toHaveLength(0);
    await roundTrip(doc2);
  });
});

describe('lanes: nested --members', () => {
  it('warns when the first child lane receives more than the listed --members', async () => {
    const doc = await docFromXml(WITH_LANES);
    add(doc, { kind: 'participant', name: 'Shop' });
    const cs = add(doc, { kind: 'lane', name: 'Inbound', in: 'Lane_Sales', members: ['Task_A'] });
    expect(ids(many(doc.require('lane_inbound'), 'flowNodeRef'))).toEqual(['Start', 'Task_A']);
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
    expect(cs.warnings[0]!.related).toEqual(['Start']);
    expect(cs.warnings[0]!.hint).toContain('--in Lane_Sales --members Start');
    // the sibling lane the hint suggests takes exactly its members, no warning
    const cs2 = add(doc, { kind: 'lane', name: 'Outbound', in: 'Lane_Sales', members: ['Start'] });
    expect(cs2.warnings).toHaveLength(0);
    expect(ids(many(doc.require('lane_inbound'), 'flowNodeRef'))).toEqual(['Task_A']);
    expect(ids(many(doc.require('lane_outbound'), 'flowNodeRef'))).toEqual(['Start']);
    // listing every inherited member (or none) is silent
    const cs3 = add(doc, { kind: 'lane', name: 'Back', in: 'Lane_Backoffice', members: ['End'] });
    expect(cs3.warnings).toHaveLength(0);
    await roundTrip(doc);
  });
});
