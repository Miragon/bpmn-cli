/**
 * Declared id conventions in the core (issue #34; src/ids/style.ts DECLARED
 * CONVENTIONS): they fill the gaps a change opens and never rename what is
 * there; the rest of the file keeps its own style, stable over many writes;
 * W_ID_PREFIX_STALE after a retype or a trigger change; the `conventions`
 * of a result; the view of `bpmn show --conventions`. The conventions come
 * from the real plugin's naming helpers (src/ids/conventions.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, conventionsXml } from '../src/api.js';
import type { BpmnlintRuleSetting } from '../src/validate/bpmnlint-validator.js';
import { conventionsView, idConventionsFromLint, renderConventions, type IdConventions } from '../src/ids/conventions.js';
import { Doc } from '../src/model/document.js';
import { bpmnlintEngine } from '../src/node/index.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationResult } from '../src/pipeline/index.js';
import { mutationReport, mutationSummary, renderMutation, renderSummary } from '../src/index.js';
import { definitionsXml } from './helpers.js';

const naming = bpmnlintEngine().plugin.naming;
const declared = (config: unknown = {}, severity: BpmnlintRuleSetting['severity'] = 'warn'): IdConventions => idConventionsFromLint({ severity, config }, naming, { source: '.bpmnlintrc in .' }).conventions!;
const BARE = declared();
const REQUIRED = declared({ eventDefinitionQualifier: 'required' });

/** The ids a change created, in order. */
const createdIds = (r: MutationResult): string[] => r.changes.created.map((c) => c.id);

/** `ops` on `xml` with the declared conventions (null: none). */
async function run(xml: string, ops: unknown[], conventions: IdConventions | null = BARE, opts: { keepFlowIds?: boolean } = {}): Promise<MutationResult> {
  return mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops as Op[], { layout: false, ...(conventions ? { conventions } : {}), ...opts });
}

/** A PascalCase file: start -> two tasks -> end, two lanes, a data object. */
const PASCAL = definitionsXml(`
    <bpmn:laneSet id="LaneSet_Main"><bpmn:lane id="Lane_Sales" name="Sales"/><bpmn:lane id="Lane_BackOffice" name="Back office"/></bpmn:laneSet>
    <bpmn:startEvent id="Event_OrderReceived" name="Order received"><bpmn:outgoing>Flow_OrderReceivedToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_CheckOrder" name="Check order"><bpmn:incoming>Flow_OrderReceivedToCheckOrder</bpmn:incoming><bpmn:outgoing>Flow_CheckOrderToShipOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_ShipOrder" name="Ship order"><bpmn:incoming>Flow_CheckOrderToShipOrder</bpmn:incoming><bpmn:outgoing>Flow_ShipOrderToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_ShipOrderToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:dataObjectReference id="DataObjectReference_Order" name="Order" dataObjectRef="DataObject_Order"/><bpmn:dataObject id="DataObject_Order"/>
    <bpmn:dataObjectReference id="DataObjectReference_Invoice" name="Invoice" dataObjectRef="DataObject_Invoice"/><bpmn:dataObject id="DataObject_Invoice"/>
    <bpmn:sequenceFlow id="Flow_OrderReceivedToCheckOrder" sourceRef="Event_OrderReceived" targetRef="Activity_CheckOrder"/>
    <bpmn:sequenceFlow id="Flow_CheckOrderToShipOrder" sourceRef="Activity_CheckOrder" targetRef="Activity_ShipOrder"/>
    <bpmn:sequenceFlow id="Flow_ShipOrderToDone" sourceRef="Activity_ShipOrder" targetRef="Event_Done"/>`);

/** A file that already follows element-id-naming's defaults. */
const CONFORMING = definitionsXml(`
    <bpmn:startEvent id="startEvent_orderReceived" name="Order received"><bpmn:outgoing>flow_orderReceivedToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="serviceTask_checkOrder" name="Check order"><bpmn:incoming>flow_orderReceivedToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:userTask id="userTask_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming><bpmn:outgoing>flow_shipOrderToDone</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_shipOrderToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_orderReceivedToCheckOrder" sourceRef="startEvent_orderReceived" targetRef="serviceTask_checkOrder"/>
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="serviceTask_checkOrder" targetRef="userTask_shipOrder"/>
    <bpmn:sequenceFlow id="flow_shipOrderToDone" sourceRef="userTask_shipOrder" targetRef="endEvent_done"/>`);

describe('new ids take the declared prefix and case', () => {
  it('a kind the rule names takes its prefix; the rest of the file keeps its own style', async () => {
    const r = await run(PASCAL, [
      { op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' },
      { op: 'add', kind: 'lane', name: 'Warehouse', in: 'Process_1' },
      { op: 'add', kind: 'dataObject', name: 'Delivery note', in: 'Process_1' },
    ]);
    expect(createdIds(r)).toEqual(['serviceTask_bookOrder', 'flow_bookOrderToShipOrder', 'Lane_Warehouse', 'DataObjectReference_DeliveryNote']);
    expect(r.xml).toContain('<bpmn:dataObject id="DataObject_DeliveryNote"/>');
    // the spliced flow named its ends: renamed after its new ones, in the declared form
    expect(r.changes.renames).toEqual([expect.objectContaining({ from: 'Flow_CheckOrderToShipOrder', to: 'flow_checkOrderToBookOrder' })]);
    // the ids the conventions made other than the file's style would
    expect(r.conventions).toEqual({ ids: ['serviceTask_bookOrder', 'flow_checkOrderToBookOrder', 'flow_bookOrderToShipOrder'], source: '.bpmnlintrc in .' });
  });

  it('the ids bpmn-cli writes from the table never vote on the rest: lanes and data objects stay PascalCase over many writes', async () => {
    let xml = PASCAL;
    const lanes: string[] = [];
    for (const team of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const r = await run(xml, [
        { op: 'add', kind: 'task', name: `Check ${team}`, after: 'Activity_CheckOrder' },
        { op: 'add', kind: 'userTask', name: `Approve ${team}`, in: 'Process_1' },
        { op: 'add', kind: 'lane', name: `Team ${team}`, in: 'Process_1' },
        { op: 'add', kind: 'dataObject', name: `Doc ${team}`, in: 'Process_1' },
      ]);
      lanes.push(...createdIds(r).filter((id) => /^(Lane|DataObjectReference)_/.test(id) || id.startsWith('lane')));
      xml = r.xml;
    }
    expect(lanes).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].flatMap((t) => [`Lane_Team${t}`, `DataObjectReference_Doc${t}`]));
  });

  it('a new file: what the rule does not name takes its case and prefix shape, stable over many writes', async () => {
    let xml = definitionsXml('');
    const ids: string[] = [];
    for (const team of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const r = await run(xml, [
        { op: 'add', kind: 'lane', name: `Team ${team}`, in: 'Process_1' },
        { op: 'add', kind: 'task', name: `Work ${team}`, in: 'Process_1' },
      ]);
      ids.push(...createdIds(r));
      xml = r.xml;
    }
    expect(ids.filter((id) => id.startsWith('lane'))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map((t) => `lane_team${t}`));
    expect(ids.filter((id) => id.startsWith('task_'))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map((t) => `task_work${t}`));
  });

  it('what the rule does not name keeps the file\'s style: its own ids vote unless they already follow the rule (one Lane_, hashes, only covered ids)', async () => {
    // one lane: the Activity_ / Event_ ids the rule does not accept vote too
    const oneLane = definitionsXml(`
    <bpmn:laneSet id="LaneSet_Order"><bpmn:lane id="Lane_Sales" name="Sales"/></bpmn:laneSet>
    <bpmn:startEvent id="Event_OrderReceived" name="Order received"/>
    <bpmn:task id="Activity_CheckOrder" name="Check order"/>
    <bpmn:task id="Activity_ShipOrder" name="Ship order"/>
    <bpmn:endEvent id="Event_Done" name="Done"/>`);
    const lane = await run(oneLane, [{ op: 'add', kind: 'lane', name: 'Back office', in: 'Process_1' }]);
    expect(createdIds(lane)).toEqual(['Lane_BackOffice']);
    // hashes show no case: prefixes of the other first letter than the rule's keep bpmn-cli's PascalCase
    const hashes = definitionsXml(`
    <bpmn:startEvent id="Event_1x2y3z4" name="Start"/>
    <bpmn:task id="Activity_0k3x9qa" name="Check order"/>
    <bpmn:endEvent id="Event_0a9b8c7" name="End"/>`);
    const pools = await run(hashes, [
      { op: 'add', kind: 'participant', name: 'Customer' },
      { op: 'add', kind: 'dataStore', name: 'Archive', in: 'Process_1' },
      { op: 'add', kind: 'textAnnotation', text: 'Be quick', in: 'Process_1' },
      { op: 'add', kind: 'lane', name: 'Back office', in: 'Process_1' },
    ]);
    expect(createdIds(pools)).toEqual(['Collaboration_Process', 'Participant_Customer', 'DataStoreReference_Archive', 'TextAnnotation_BeQuick', 'Lane_BackOffice']);
    // a file of PascalCase ids of types the rule names
    const covered = definitionsXml(`
    <bpmn:startEvent id="StartEvent_Start" name="Start"/>
    <bpmn:userTask id="UserTask_CheckInvoice" name="Check invoice"/>
    <bpmn:serviceTask id="ServiceTask_BookInvoice" name="Book invoice"/>
    <bpmn:endEvent id="EndEvent_Done" name="Done"/>`);
    const rest = await run(covered, [
      { op: 'add', kind: 'participant', name: 'Customer' },
      { op: 'add', kind: 'lane', name: 'Sales', in: 'Process_1' },
      { op: 'add', kind: 'dataObject', name: 'Invoice copy', in: 'Process_1' },
    ]);
    expect(createdIds(rest)).toEqual(['Collaboration_Process', 'Participant_Customer', 'Lane_Sales', 'DataObjectReference_InvoiceCopy']);
    // none of them follows the rule: no conventions line
    for (const r of [lane, pools, rest]) expect(r.conventions).toBeUndefined();
  });

  it('single lower-case words show no case: a new file\'s lanes stay in the declared case; a file that writes snake_case keeps it', async () => {
    for (const [conventions, expected] of [
      [BARE, ['lane_sales', 'lane_invoice', 'lane_backOffice', 'lane_orderArchive']],
      [declared({ case: 'snake_case' }), ['lane_sales', 'lane_invoice', 'lane_back_office', 'lane_order_archive']],
    ] as const) {
      let xml = definitionsXml('');
      const lanes: string[] = [];
      for (const name of ['Sales', 'Invoice', 'Back office', 'Order archive']) {
        const r = await run(xml, [{ op: 'add', kind: 'lane', name, in: 'Process_1' }], conventions);
        lanes.push(...createdIds(r).filter((id) => id.startsWith('lane_')));
        xml = r.xml;
      }
      expect(lanes).toEqual(expected);
    }
    const snake = definitionsXml(`
    <bpmn:laneSet id="laneSet_main"><bpmn:lane id="lane_back_office" name="Back office"/><bpmn:lane id="lane_order_archive" name="Order archive"/><bpmn:lane id="lane_sales" name="Sales"/></bpmn:laneSet>`);
    expect(createdIds(await run(snake, [{ op: 'add', kind: 'lane', name: 'Shared services', in: 'Process_1' }]))).toEqual(['lane_shared_services']);
    // they are no PascalCase, though: under a declared PascalCase they read as camel, like bare ids
    const lower = definitionsXml(`
    <bpmn:laneSet id="laneSet_main"><bpmn:lane id="lane_sales" name="Sales"/><bpmn:lane id="lane_billing" name="Billing"/></bpmn:laneSet>
    <bpmn:task id="task_placeOrder" name="Place order"/>`);
    expect(createdIds(await run(lower, [{ op: 'add', kind: 'lane', name: 'Back office', in: 'Process_1' }, { op: 'add', kind: 'task', name: 'Ship goods', in: 'Process_1' }], declared({ case: 'PascalCase' })))).toEqual(['lane_backOffice', 'task_ShipGoods']);
  });

  it('the event-definition qualifier: plain under optional (also in a file that qualifies), qualified under required', async () => {
    const qualifying = definitionsXml(`
    <bpmn:startEvent id="timerStartEvent_daily" name="Daily"><bpmn:timerEventDefinition id="T1"/></bpmn:startEvent>
    <bpmn:startEvent id="messageStartEvent_order" name="Order"><bpmn:messageEventDefinition id="M1"/></bpmn:startEvent>`);
    const ops = [{ op: 'add', kind: 'startEvent:timer', name: 'Weekly', in: 'Process_1', timer: 'R/P7D' }];
    expect(createdIds(await run(qualifying, ops, BARE))).toEqual(['startEvent_weekly']);
    expect(createdIds(await run(qualifying, ops, REQUIRED))).toEqual(['timerStartEvent_weekly']);
    // no trigger: the plain prefix in either mode
    expect(createdIds(await run(qualifying, [{ op: 'add', kind: 'startEvent', name: 'Manual', in: 'Process_1' }], REQUIRED))).toEqual(['startEvent_manual']);
  });

  it('the kind word leaves out what the prefix says; under camelCase / PascalCase a number never comes first; snake_case keeps it', async () => {
    const ops = [
      { op: 'add', kind: 'startEvent:timer', name: '1st of month', in: 'Process_1', timer: 'R/P1M', as: '$s' },
      { op: 'add', kind: 'task', name: 'Paid', after: '$s', as: '$t' },
      { op: 'add', kind: 'endEvent:terminate', after: '$t' },
      { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', on: '$t', timer: 'P2D' },
      { op: 'add', kind: 'scriptTask', name: '4 Augen Prinzip', in: 'Process_1' },
      { op: 'add', kind: 'eventSubProcess:message', name: '5 minute warning', in: 'Process_1', message: 'W5' },
    ];
    const ids = createdIds(await run(definitionsXml(''), ops));
    expect(ids).toEqual(expect.arrayContaining(['startEvent_timer1stOfMonth', 'endEvent_terminateAfterPaid', 'event_timer2Days', 'scriptTask_scriptTask4AugenPrinzip', 'subProcess_event5MinuteWarning']));
    // unnamed: the word without what the prefix says, the whole word where nothing else is left
    const unnamed = createdIds(await run(definitionsXml('<bpmn:task id="task_paid" name="Paid"/>'), [{ op: 'add', kind: 'scriptTask', in: 'Process_1' }, { op: 'add', kind: 'scriptTask', after: 'task_paid' }]));
    expect(unnamed).toEqual(['scriptTask_scriptTask', 'scriptTask_afterPaid', 'flow_paidToAfterPaid']);
    const pascal = createdIds(await run(definitionsXml(''), ops, declared({ case: 'PascalCase' })));
    expect(pascal).toEqual(expect.arrayContaining(['startEvent_Timer1stOfMonth', 'event_Timer2Days', 'scriptTask_ScriptTask4AugenPrinzip']));
    const snake = createdIds(await run(definitionsXml(''), ops, declared({ case: 'snake_case' })));
    expect(snake).toEqual(expect.arrayContaining(['startEvent_1st_of_month', 'event_2_days', 'scriptTask_4_augen_prinzip', 'subProcess_5_minute_warning']));
  });

  it('a collision suffix and a join are glued under camelCase / PascalCase, `_` under snake_case', async () => {
    // a taken join id: the join of the split after Check order exists already
    const ops = (join: string) => [
      { op: 'add', kind: 'serviceTask', name: 'Check order', in: 'Process_1', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Check order', in: 'Process_1' },
      { op: 'add', kind: 'xor', id: join, in: 'Process_1' },
      { op: 'split', after: '$a', branches: [{ nodes: [{ kind: 'task', name: 'Yes' }] }, { nodes: [{ kind: 'task', name: 'No' }] }] },
    ];
    const camel = await run(definitionsXml(''), ops('gateway_afterCheckOrderJoin'));
    expect(createdIds(camel)).toEqual(expect.arrayContaining(['serviceTask_checkOrder', 'serviceTask_checkOrder2', 'gateway_afterCheckOrder', 'gateway_afterCheckOrderJoin2']));
    expect(camel.changes.warnings.filter((w) => w.code === 'W_ID_SUFFIXED').map((w) => w.element)).toEqual(['serviceTask_checkOrder2', 'gateway_afterCheckOrderJoin2']);
    const snake = await run(definitionsXml(''), ops('gateway_after_check_order_join'), declared({ case: 'snake_case' }));
    expect(createdIds(snake)).toEqual(expect.arrayContaining(['serviceTask_check_order', 'serviceTask_check_order_2', 'gateway_after_check_order', 'gateway_after_check_order_join_2']));
  });

  it('a glued suffix after a body that ends in a digit takes the word No: step1No2, never step12 (the id Step 12 gets)', async () => {
    // before: serviceTask_step12 for the second Step 1, serviceTask_step122 for Step 12, serviceTask_step13 for the third
    const camel = await run(definitionsXml(''), [
      { op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1' },
      { op: 'add', kind: 'serviceTask', name: 'Step 12', in: 'Process_1' },
      { op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1' },
      { op: 'add', kind: 'serviceTask', name: 'Check order', in: 'Process_1', as: '$c' },
      { op: 'connect', source: '$c', target: '$a' },
      { op: 'connect', source: '$c', target: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Check order', in: 'Process_1' },
    ]);
    expect(createdIds(camel)).toEqual(['serviceTask_step1', 'serviceTask_step1No2', 'serviceTask_step12', 'serviceTask_step1No3', 'serviceTask_checkOrder', 'flow_checkOrderToStep1', 'flow_checkOrderToStep1No2', 'serviceTask_checkOrder2']);
    expect(camel.changes.warnings.filter((w) => w.code === 'W_ID_SUFFIXED').map((w) => w.message)).toEqual([
      'Id serviceTask_step1 is already taken; using serviceTask_step1No2',
      'Id serviceTask_step1 is already taken; using serviceTask_step1No3',
      'Id flow_checkOrderToStep1 is already taken; using flow_checkOrderToStep1No2',
      'Id serviceTask_checkOrder is already taken; using serviceTask_checkOrder2',
    ]);
    const pascal = await run(definitionsXml(''), [
      { op: 'add', kind: 'serviceTask', name: 'Phase 2', in: 'Process_1' },
      { op: 'add', kind: 'serviceTask', name: 'Phase 2', in: 'Process_1' },
      { op: 'add', kind: 'serviceTask', name: 'Phase 22', in: 'Process_1' },
    ], declared({ prefixes: { 'bpmn:ServiceTask': 'ServiceTask_' }, case: 'PascalCase' }));
    expect(createdIds(pascal)).toEqual(['ServiceTask_Phase2', 'ServiceTask_Phase2No2', 'ServiceTask_Phase22']);
    // snake_case keeps `_2`; the id a retype in the batch gives (Doc.regeneratedId) and the W_ID_PREFIX_STALE hint take No too
    const snake = await run(definitionsXml(''), [{ op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1' }, { op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1' }], declared({ case: 'snake_case' }));
    expect(createdIds(snake)).toEqual(['serviceTask_step_1', 'serviceTask_step_1_2']);
    const retyped = await run(definitionsXml('<bpmn:serviceTask id="serviceTask_step1" name="Step 1"/>'), [{ op: 'add', kind: 'task', name: 'Step 1', in: 'Process_1', as: '$t' }, { op: 'retype', id: '$t', kind: 'serviceTask' }]);
    expect(createdIds(retyped)).toEqual(['serviceTask_step1No2']);
    const hinted = await run(definitionsXml('<bpmn:serviceTask id="serviceTask_step1" name="Step 1"/><bpmn:userTask id="userTask_step1" name="Step 1"/>'), [{ op: 'retype', id: 'serviceTask_step1', kind: 'userTask' }]);
    expect(hinted.changes.warnings.find((w) => w.code === 'W_ID_PREFIX_STALE')?.hint).toContain('`bpmn set <file> serviceTask_step1 id=userTask_step1No2`');
  });

  it('the join follows the declared case also in a file of bare ids, and the declared prefix after a split id without it', async () => {
    const bare = definitionsXml(`
    <bpmn:startEvent id="start" name="Start"><bpmn:outgoing>startToCheckInvoice</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="checkInvoice" name="Check invoice"><bpmn:incoming>startToCheckInvoice</bpmn:incoming><bpmn:outgoing>checkInvoiceToBook</bpmn:outgoing></bpmn:task>
    <bpmn:task id="book" name="Book"><bpmn:incoming>checkInvoiceToBook</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="startToCheckInvoice" sourceRef="start" targetRef="checkInvoice"/>
    <bpmn:sequenceFlow id="checkInvoiceToBook" sourceRef="checkInvoice" targetRef="book"/>`);
    const split = (extra: Record<string, unknown> = {}) => [{ op: 'split', after: 'checkInvoice', kind: 'xor', branches: [{ nodes: [{ kind: 'task', name: 'Yes' }] }, { nodes: [{ kind: 'task', name: 'No' }] }], ...extra }];
    const joins = async (xml: string, ops: unknown[], conventions: IdConventions) => createdIds(await run(xml, ops, conventions)).filter((id) => /join/i.test(id) && !/To|_to_/.test(id));
    expect(await joins(bare, split({ name: 'Approved' }), declared({ case: 'snake_case', prefixes: { 'bpmn:Gateway': 'gw' } }))).toEqual(['gwapproved_join']);
    expect(await joins(bare, split({ name: 'Approved' }), declared({ prefixes: { 'bpmn:Gateway': 'gw' } }))).toEqual(['gwapprovedJoin']);
    // an explicit split id the declared prefix does not start: the join takes the prefix and the gateway's label
    const r = await run(bare, split({ id: 'Gateway_Check' }), declared({ case: 'snake_case' }));
    expect(createdIds(r)).toEqual(expect.arrayContaining(['Gateway_Check', 'gateway_check_join']));
    expect(r.conventions?.ids).toContain('gateway_check_join');
    expect(await joins(bare, split({ id: 'Gateway_Check' }), BARE)).toEqual(['gateway_checkJoin']);
    expect(await joins(bare, split({ id: 'Gateway_0abc123', name: 'Invoice ok?' }), BARE)).toEqual(['gateway_invoiceOkJoin']);
    // one the prefix starts keeps <id>Join; without declared conventions the file's join
    expect(await joins(bare, split({ id: 'gateway_check' }), BARE)).toEqual(['gateway_checkJoin']);
    // one the prefix starts with a body in another case than the declared one: the prefix and the words of that body
    expect(await joins(bare, split({ id: 'gateway_Approved' }), BARE)).toEqual(['gateway_approvedJoin']);
    expect(await joins(bare, split({ id: 'gateway_approved_check' }), BARE)).toEqual(['gateway_approvedCheckJoin']);
    expect(await joins(bare, split({ id: 'gateway_ok-1' }), BARE)).toEqual(['gateway_ok1Join']);
    expect(await joins(bare, split({ id: 'gateway_approved' }), declared({ case: 'PascalCase' }))).toEqual(['gateway_ApprovedJoin']);
    expect(await joins(bare, split({ id: 'gateway_Approved' }), declared({ case: 'snake_case' }))).toEqual(['gateway_approved_join']);
    expect(await joins(bare, split({ id: 'gwApproved' }), declared({ prefixes: { 'bpmn:Gateway': 'gw' } }))).toEqual(['gwapprovedJoin']);
    // `any` checks no case: the file's join after the id as it is
    expect(await joins(bare, split({ id: 'gateway_Approved' }), declared({ case: 'any' }))).toEqual(['gateway_Approved_join']);
    expect(createdIds(await run(bare, split({ id: 'Gateway_Check' }), null))).toContain('Gateway_Check_join');
  });

  it('flows: the named form with the declared prefix, the ends without the file\'s scope, message flows like sequence flows', async () => {
    const scoped = definitionsXml(`
    <bpmn:startEvent id="Event_KotO_Start" name="Start"><bpmn:outgoing>Flow_KotO_StartToCheckInvoice</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_KotO_CheckInvoice" name="Check invoice"><bpmn:incoming>Flow_KotO_StartToCheckInvoice</bpmn:incoming><bpmn:outgoing>Flow_KotO_CheckInvoiceToBook</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_KotO_Book" name="Book"><bpmn:incoming>Flow_KotO_CheckInvoiceToBook</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_KotO_StartToCheckInvoice" sourceRef="Event_KotO_Start" targetRef="Activity_KotO_CheckInvoice"/>
    <bpmn:sequenceFlow id="Flow_KotO_CheckInvoiceToBook" sourceRef="Activity_KotO_CheckInvoice" targetRef="Activity_KotO_Book"/>`);
    const r = await run(scoped, [{ op: 'add', kind: 'task', name: 'Archive', after: 'Activity_KotO_Book' }]);
    expect(createdIds(r)).toEqual(['task_archive', 'flow_bookToArchive']);
    const pools = await run(definitionsXml('<bpmn:task id="Activity_A" name="Send offer"/>'), [
      { op: 'add', kind: 'participant', name: 'Supplier' },
      { op: 'add', kind: 'participant', name: 'Customer', as: '$c' },
      { op: 'connect', source: 'Activity_A', target: '$c' },
    ]);
    expect(createdIds(pools).at(-1)).toBe('flow_sendOfferToCustomer');
    expect(createdIds(await run(definitionsXml('<bpmn:task id="Activity_A" name="Send offer"/>'), [{ op: 'add', kind: 'participant', name: 'Supplier' }, { op: 'add', kind: 'participant', name: 'Customer', as: '$c' }, { op: 'connect', source: 'Activity_A', target: '$c' }], declared({ prefixes: { 'bpmn:MessageFlow': 'messageFlow_' } }))).at(-1)).toBe('messageFlow_sendOfferToCustomer');
  });

  it('message flows keep the borrowed prefix and case over many writes (one message flow of the file is no style of its own)', async () => {
    const pools = [
      { op: 'add', kind: 'participant', name: 'Main' },
      { op: 'add', kind: 'participant', name: 'Customer' },
    ];
    for (const [conventions, expected] of [
      [BARE, ['flow_sendOneToCustomer', 'flow_sendTwoToCustomer', 'flow_sendThreeToCustomer']],
      [declared({ case: 'snake_case' }), ['flow_send_one_to_customer', 'flow_send_two_to_customer', 'flow_send_three_to_customer']],
    ] as const) {
      let xml = PASCAL;
      const flows: string[] = [];
      for (const [i, word] of ['One', 'Two', 'Three'].entries()) {
        const r = await run(xml, [
          ...(i ? [] : pools),
          { op: 'add', kind: 'intermediateThrowEvent:message', name: `Send ${word}`, in: 'Process_1', message: word, as: '$e' },
          { op: 'connect', source: '$e', target: 'Participant_Customer' },
        ], conventions);
        flows.push(createdIds(r).at(-1)!);
        xml = r.xml;
      }
      expect(flows).toEqual(expected);
      // the view still names the borrowed prefix
      expect(conventionsView(await Doc.fromXml(xml), conventions).rows.find((row) => row.kinds.includes('messageFlow'))).toMatchObject({ pattern: 'flow_{source}To{target}', source: 'lint shape' });
    }
    // a file's own message flows that agree (two) are a style of their own: new ones follow it
    const own = definitionsXml('<bpmn:task id="Activity_A" name="Send offer"/><bpmn:task id="Activity_B" name="Send bill"/><bpmn:task id="Activity_C" name="Send reminder"/>');
    const two = await run(own, [
      { op: 'add', kind: 'participant', name: 'Main' },
      { op: 'add', kind: 'participant', name: 'Customer', id: 'Participant_Customer' },
      { op: 'connect', source: 'Activity_A', target: 'Participant_Customer', id: 'MessageFlow_Offer' },
      { op: 'connect', source: 'Activity_B', target: 'Participant_Customer', id: 'MessageFlow_Bill' },
    ]);
    const third = await run(two.xml, [{ op: 'connect', source: 'Activity_C', target: 'Participant_Customer' }]);
    expect(createdIds(third)).toEqual(['MessageFlow_SendReminderToCustomer']);
  });

  it('the process of a new pool is bpmn-cli\'s Process_<Name>, over many writes in a file of lint-shaped pools', async () => {
    let doc = Doc.create({ processName: 'Order', conventions: BARE });
    const processes: string[] = [];
    for (const name of ['Main', 'Customer', 'Supplier', 'Back office', 'Tax office']) {
      const r = await mutateDoc(doc, [{ op: 'add', kind: 'participant', name }] as Op[], { layout: false, conventions: BARE });
      processes.push(...r.changes.created.filter((c) => c.kind === 'process').map((c) => c.id));
      doc = await Doc.fromXml(r.xml);
    }
    expect(processes).toEqual(['Process_Customer', 'Process_Supplier', 'Process_BackOffice', 'Process_TaxOffice']);
    expect(doc.processes().map((p) => p.get('id'))).toEqual(['Process_Order', ...processes]);
  });

  it('a new pool\'s process follows the file\'s own process ids where two share a prefix, with and without the rule; never the participants\'', async () => {
    const pools = (procs: [string, string], part: string, task: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="collaboration_main">
    <bpmn:participant id="${part}customer" name="Customer" processRef="${procs[0]}"/>
    <bpmn:participant id="${part}shop" name="Shop" processRef="${procs[1]}"/>
  </bpmn:collaboration>
  <bpmn:process id="${procs[0]}" isExecutable="false"><bpmn:startEvent id="startEvent_order" name="Order"/></bpmn:process>
  <bpmn:process id="${procs[1]}" isExecutable="true"><bpmn:userTask id="${task}" name="Check order"/><bpmn:userTask id="userTask_shipOrder" name="Ship order"/></bpmn:process>
</bpmn:definitions>`;
    const newProcess = async (xml: string, conventions: IdConventions | null): Promise<string> => {
      const r = await run(xml, [{ op: 'add', kind: 'participant', name: 'Bank account' }], conventions);
      return r.changes.created.find((c) => c.kind === 'process')!.id;
    };
    // the prefix the processes share, the file's case (single lower-case words show none), whatever the pools' prefixes
    for (const part of ['participant_', 'Participant_', 'Pool_']) {
      const xml = pools(['process_customer', 'process_shop'], part, 'userTask_checkOrder');
      expect([await newProcess(xml, BARE), await newProcess(xml, null)], part).toEqual(['process_bankAccount', 'process_bankAccount']);
    }
    // in a snake_case file: snake without the rule and under a snake_case one; under camelCase the case of the pool
    // made with it (participant_bankAccount: the snake ids under the rule's prefixes do not vote)
    const snakeFile = pools(['process_customer', 'process_shop'], 'participant_', 'userTask_check_order').replace('userTask_shipOrder', 'userTask_ship_order');
    expect([await newProcess(snakeFile, null), await newProcess(snakeFile, declared({ case: 'snake_case' })), await newProcess(snakeFile, BARE)]).toEqual(['process_bank_account', 'process_bank_account', 'process_bankAccount']);
    const snakePool = await run(snakeFile, [{ op: 'add', kind: 'participant', name: 'Bank account' }]);
    expect(snakePool.changes.created.find((c) => c.kind === 'participant')?.id).toBe('participant_bankAccount');
    // bodies that show a case: theirs; a tie between prefixes: the alphabetically first
    expect(await newProcess(pools(['Process_Customer', 'Process_Shop'], 'participant_', 'userTask_checkOrder'), BARE)).toBe('Process_BankAccount');
    const four = pools(['proc_customer', 'proc_shop'], 'participant_', 'userTask_checkOrder').replace('</bpmn:definitions>', '<bpmn:process id="flow_a"/><bpmn:process id="flow_b"/></bpmn:definitions>');
    expect(await newProcess(four, BARE)).toBe('flow_bankAccount');
    // processes that share no prefix: bpmn-cli's Process_<Name> under the rule (never the participants' participant_);
    // without it the file's prefix shape, as before
    const apart = pools(['proc_customer', 'Process_shop'], 'participant_', 'userTask_checkOrder');
    expect([await newProcess(apart, BARE), await newProcess(apart, null)]).toEqual(['Process_BankAccount', 'process_bankAccount']);
    // the view: the process row comes from the file (one row with the pools: <kind>_ is process_ for a process)
    const view = conventionsView(await Doc.fromXml(pools(['process_customer', 'process_shop'], 'participant_', 'userTask_checkOrder')), BARE);
    expect(view.rows.find((row) => row.kinds.includes('process'))).toMatchObject({ pattern: '<kind>_{name:camel}', source: 'file', note: 'not checked', kinds: expect.arrayContaining(['participant', 'process']) });
    expect(conventionsView(await Doc.fromXml(apart), BARE).rows.find((row) => row.kinds.includes('process'))).toMatchObject({ pattern: 'Process_{name:pascal}', source: 'default' });
    // an exact entry for bpmn:Process still decides
    expect(await newProcess(pools(['proc_customer', 'proc_shop'], 'participant_', 'userTask_checkOrder'), declared({ prefixes: { 'bpmn:Process': 'process_' } }))).toBe('process_bankAccount');
    // bodies that tie between two cases: the file's case (camelCase here), with and without the rule
    const tie = pools(['process_Customer', 'process_shopFloor'], 'participant_', 'userTask_checkOrder');
    expect([await newProcess(tie, BARE), await newProcess(tie, null)]).toEqual(['process_bankAccount', 'process_bankAccount']);
    // bodies that show no case (Camunda Modeler's Process_1 and a hash): the case of a kind the rule does not name, so
    // the process matches the pool made with it (under the rule bpmn-cli's PascalCase next to hashed participants)
    const modeler = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_0x1y2z3">
    <bpmn:participant id="Participant_0abc123" name="Customer" processRef="Process_1"/>
    <bpmn:participant id="Participant_1def456" name="Shop" processRef="Process_0k3x9qa"/>
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false"><bpmn:startEvent id="startEvent_order" name="Order"/></bpmn:process>
  <bpmn:process id="Process_0k3x9qa" isExecutable="true"><bpmn:userTask id="userTask_checkOrder" name="Check order"/><bpmn:userTask id="userTask_shipOrder" name="Ship order"/></bpmn:process>
</bpmn:definitions>`;
    const pool = async (conventions: IdConventions | null): Promise<string[]> => {
      const r = await run(modeler, [{ op: 'add', kind: 'participant', name: 'Bank account' }], conventions);
      return r.changes.created.filter((c) => c.kind === 'process' || c.kind === 'participant').map((c) => c.id);
    };
    expect(await pool(BARE)).toEqual(['Process_BankAccount', 'Participant_BankAccount']);
    expect(await pool(null)).toEqual(['Process_bankAccount', 'Participant_bankAccount']);
  });

  it('explicit ids are taken as given; the process and the definitions keep theirs', async () => {
    const r = await run(definitionsXml(''), [
      { op: 'add', kind: 'serviceTask', name: 'Book', id: 'Activity_Book', in: 'Process_1' },
      { op: 'add', kind: 'participant', name: 'Billing' },
    ]);
    expect(createdIds(r)).toEqual(['Activity_Book', 'collaboration_process', 'participant_billing']);
    expect(r.xml).toContain('<bpmn:process id="Process_1"');
  });

  it('a flow the file named in its own style still names its ends: renamed into the declared form, or kept with keepFlowIds and named stale', async () => {
    const ops = [{ op: 'add', kind: 'task', name: 'Pack order', flow: 'Flow_CheckOrderToShipOrder' }];
    const renamed = await run(PASCAL, ops);
    expect(renamed.changes.renames.map((x) => `${x.from} -> ${x.to}`)).toEqual(['Flow_CheckOrderToShipOrder -> flow_checkOrderToPackOrder']);
    const kept = await run(PASCAL, ops, BARE, { keepFlowIds: true });
    expect(kept.changes.renames).toEqual([]);
    expect(kept.changes.warnings.find((w) => w.code === 'W_FLOW_ID_STALE')?.hint).toContain('`bpmn set <file> Flow_CheckOrderToShipOrder id=flow_checkOrderToPackOrder`');
  });

  it('a flow earlier versions named in a file of another flow form (#31) follows its ends too: into the declared form, or the file\'s where no flow prefix is declared', async () => {
    // an idSnake file with a flow 0.6 named (Flow_pay_to_done)
    const tasks = ['check', 'ship', 'bill', 'pay', 'done'];
    const flows = ['Flow_Task_check_to_Task_ship', 'Flow_Task_ship_to_Task_bill', 'Flow_Task_bill_to_Task_pay', 'Flow_pay_to_done'];
    const xml = definitionsXml(
      tasks.map((t, i) => `<bpmn:task id="Task_${t}" name="${t}">${i ? `<bpmn:incoming>${flows[i - 1]}</bpmn:incoming>` : ''}${i < flows.length ? `<bpmn:outgoing>${flows[i]}</bpmn:outgoing>` : ''}</bpmn:task>`).join('\n') +
        flows.map((f, i) => `<bpmn:sequenceFlow id="${f}" sourceRef="Task_${tasks[i]}" targetRef="Task_${tasks[i + 1]}"/>`).join('\n'),
    );
    const ops = [{ op: 'add', kind: 'task', name: 'Log', flow: 'Flow_pay_to_done' }];
    const renames = (r: MutationResult): string[] => r.changes.renames.map((x) => `${x.from} -> ${x.to}`);
    expect(renames(await run(xml, ops, null))).toEqual(['Flow_pay_to_done -> Flow_Task_pay_to_Task_log']);
    const lint = await run(xml, ops);
    expect(createdIds(lint)).toEqual(['task_log', 'flow_logToDone']);
    expect(renames(lint)).toEqual(['Flow_pay_to_done -> flow_payToLog']);
    expect(renames(await run(xml, ops, { prefixes: { 'bpmn:Task': 'task_' }, case: 'camelCase' }))).toEqual(['Flow_pay_to_done -> Flow_Task_pay_to_task_log']);
  });

  it('a host passes its own table (no plugin); unusable prefixes are left out; none declared: the file\'s style', async () => {
    const host: IdConventions = { prefixes: { 'bpmn:ServiceTask': 'svc_', 'bpmn:SequenceFlow': 'sf_', 'bpmn:UserTask': 'user task_' }, case: 'camelCase' };
    const r = await applyToXml(PASCAL, [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' }, { op: 'add', kind: 'userTask', name: 'Approve', after: 'Activity_ShipOrder' }], { layout: false, conventions: host });
    expect(r.result.created.map((c) => c.id)).toEqual(['svc_bookOrder', 'sf_bookOrderToShipOrder', 'Activity_Approve', 'sf_approveToDone']);
    const none = await applyToXml(PASCAL, [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' }], { layout: false, conventions: { prefixes: { 'bpmn:ServiceTask': '1_' } } });
    const plain = await applyToXml(PASCAL, [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' }], { layout: false });
    expect(none.xml).toBe(plain.xml);
    expect(none.result.conventions).toBeUndefined();
  });
});

describe('the conventions of a result', () => {
  it('name the new ids that differ from the file\'s own style, in text, --summary and JSON; none in a file whose checked ids all follow the rule', async () => {
    const r = await run(PASCAL, [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' }]);
    const report = mutationReport(r);
    expect(report.conventions).toEqual({ ids: ['serviceTask_bookOrder', 'flow_checkOrderToBookOrder', 'flow_bookOrderToShipOrder'], source: '.bpmnlintrc in .' });
    const line = "conventions: serviceTask_bookOrder, flow_checkOrderToBookOrder, flow_bookOrderToShipOrder follow element-id-naming (.bpmnlintrc in .), not the file's own id style  (`bpmn show <file> --conventions`)";
    expect(renderMutation(report).split('\n')).toContain(line);
    expect(mutationSummary(report).conventions).toEqual(report.conventions);
    expect(renderSummary(mutationSummary(report)).split('\n')).toContain(line);
    const same = await run(CONFORMING, [
      { op: 'add', kind: 'serviceTask', name: 'Book order', after: 'serviceTask_checkOrder' },
      { op: 'add', kind: 'endEvent', name: 'Cancelled', in: 'Process_1' },
    ]);
    expect(createdIds(same)).toEqual(['serviceTask_bookOrder', 'flow_bookOrderToShipOrder', 'endEvent_cancelled']);
    expect(same.conventions).toBeUndefined();
    expect(renderMutation(mutationReport(same))).not.toContain('conventions:');
    // a kind the conforming file has no id of yet: its own style shows none (exclusiveGateway_ by the type-named
    // prefixes), but none of its ids differs from the rule, so nothing of its own differs either
    const gateway = await run(CONFORMING, [{ op: 'add', kind: 'xor', name: 'Approved?', after: 'serviceTask_checkOrder' }]);
    expect(createdIds(gateway)).toEqual(['gateway_approved', 'flow_approvedToShipOrder']);
    expect(gateway.conventions).toBeUndefined();
    // one id of its own that the rule rejects (a body not in its case counts too) makes it a file of two styles again
    for (const legacy of ['<bpmn:task id="Activity_Legacy" name="Legacy"/>', '<bpmn:serviceTask id="serviceTask_Legacy" name="Legacy"/>']) {
      const mixed = await run(CONFORMING.replace('</bpmn:process>', `${legacy}</bpmn:process>`), [{ op: 'add', kind: 'xor', name: 'Approved?', after: 'serviceTask_checkOrder' }]);
      expect(mixed.conventions?.ids, legacy).toContain('gateway_approved');
    }
    // so does one of a type the rule checks with a prefix new ids cannot have (W_CONFIG_IGNORED: no id passes it)
    const ignoredPrefix = declared({ prefixes: { 'bpmn:ReceiveTask': '1bad' } });
    const receive = await run(CONFORMING.replace('</bpmn:process>', '<bpmn:receiveTask id="Activity_Legacy" name="Legacy"/></bpmn:process>'), [{ op: 'add', kind: 'xor', name: 'Approved?', after: 'serviceTask_checkOrder' }], ignoredPrefix);
    expect(receive.conventions?.ids).toContain('gateway_approved');
    // and an event whose qualified prefix the rule requires and new ids cannot have (longer than 56 characters)
    const long = `endEvent${'X'.repeat(40)}_`;
    const required = declared({ eventDefinitionQualifier: 'required', prefixes: { 'bpmn:EndEvent': long } });
    const longEnd = CONFORMING.replaceAll('"endEvent_done"', `"${long}done"`);
    const approve = [{ op: 'add', kind: 'xor', name: 'Approved?', after: 'serviceTask_checkOrder' }];
    expect((await run(longEnd, approve, required)).conventions).toBeUndefined();
    const escalated = longEnd.replace('</bpmn:process>', '<bpmn:endEvent id="endEvent_escalated" name="Escalated"><bpmn:escalationEventDefinition/></bpmn:endEvent></bpmn:process>');
    expect((await run(escalated, approve, required)).conventions?.ids).toContain('gateway_approved');
  });

  it('a new file has no style of its own: no line for its first ids, nor for a process id the rule names exactly', async () => {
    const processOnly = declared({ prefixes: { 'bpmn:Process': 'process_' } });
    const unnamed = await mutateDoc(Doc.create({ conventions: processOnly }), [], { layout: false, conventions: processOnly });
    expect(unnamed.xml).toContain('id="Definitions_Main"');
    expect(unnamed.xml).toContain('<bpmn:process id="process_main"');
    expect(unnamed.conventions).toBeUndefined();
    const both = declared({ prefixes: { 'bpmn:Process': 'process_', 'bpmn:Definitions': 'definitions_' } });
    expect((await mutateDoc(Doc.create({ conventions: both }), [], { layout: false, conventions: both })).conventions).toBeUndefined();
    // `bpmn new`, then one change after another: every id follows the rule, so no write has the line
    let doc = Doc.create({ conventions: BARE });
    const lines: unknown[] = [];
    for (const ops of [
      [{ op: 'add', kind: 'startEvent', name: 'Order received', in: 'Process_1' }],
      [{ op: 'add', kind: 'serviceTask', name: 'Check order', after: 'startEvent_orderReceived' }],
      [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'serviceTask_checkOrder' }],
      [{ op: 'add', kind: 'xor', name: 'Approved?', after: 'serviceTask_bookOrder' }],
      [{ op: 'split', after: 'gateway_approved', kind: 'and', branches: [{ nodes: [{ kind: 'userTask', name: 'Pack' }] }, { nodes: [{ kind: 'userTask', name: 'Bill' }] }] }],
    ]) {
      const r = await mutateDoc(doc, ops as Op[], { layout: false, conventions: BARE });
      lines.push(r.conventions);
      expect(renderSummary(mutationSummary(mutationReport(r)))).not.toContain('conventions:');
      doc = await Doc.fromXml(r.xml);
    }
    expect(lines).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(doc.flowElements(doc.processes()[0]!).map((e) => e.get('id'))).toEqual(expect.arrayContaining(['gateway_approved', 'gateway_afterApproved', 'gateway_afterApprovedJoin', 'userTask_pack', 'userTask_bill']));
  });

  it('only ids under a prefix the rule declares: not what it does not name (a new file\'s lane, a pool, a message flow), nor a type whose prefix it cannot use', async () => {
    const fresh = await run(definitionsXml('<bpmn:sendTask id="sendTask_send" name="Send"/>'), [
      { op: 'add', kind: 'lane', name: 'Sales', in: 'Process_1' },
      { op: 'add', kind: 'participant', name: 'Customer' },
      { op: 'add', kind: 'participant', name: 'Bank', as: '$b' },
      { op: 'connect', source: 'sendTask_send', target: '$b' },
    ]);
    expect(createdIds(fresh)).toEqual(['lane_sales', 'collaboration_process', 'participant_customer', 'Process_Bank', 'participant_bank', 'flow_sendToBank']);
    expect(fresh.conventions).toBeUndefined();
    const ignored = declared({ prefixes: { 'bpmn:UserTask': '1user_' } });
    expect(ignored.ignored).toEqual(['bpmn:UserTask']);
    const user = await run(definitionsXml(''), [{ op: 'add', kind: 'userTask', name: 'Check it', in: 'Process_1' }], ignored);
    expect(createdIds(user)).toEqual(['userTask_checkIt']);
    expect(user.conventions).toBeUndefined();
  });
});

describe('W_ID_PREFIX_STALE', () => {
  const EVENTS = definitionsXml(`
    <bpmn:serviceTask id="serviceTask_checkInvoice" name="Check invoice"/>
    <bpmn:userTask id="userTask_checkInvoice" name="Check invoice"/>
    <bpmn:task id="Activity_Legacy" name="Legacy"/>
    <bpmn:intermediateCatchEvent id="timerEvent_wait" name="Wait"><bpmn:timerEventDefinition id="T1"/></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="event_pause" name="Pause"><bpmn:timerEventDefinition id="T2"/></bpmn:intermediateCatchEvent>`);
  const stale = (r: MutationResult) => r.changes.warnings.filter((w) => w.code === 'W_ID_PREFIX_STALE');

  it('a retype keeps the id and names the `bpmn set` that follows the convention (free in the file)', async () => {
    const r = await run(EVENTS, [{ op: 'retype', id: 'serviceTask_checkInvoice', kind: 'userTask' }]);
    expect(stale(r)).toEqual([
      {
        code: 'W_ID_PREFIX_STALE',
        element: 'serviceTask_checkInvoice',
        message: 'serviceTask_checkInvoice keeps its id, whose prefix serviceTask_ is that of a serviceTask; element-id-naming (.bpmnlintrc in .) expects userTask_ for a userTask',
        hint: 'Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> serviceTask_checkInvoice id=userTask_checkInvoice2`.',
      },
    ]);
    expect(r.xml).toContain('id="serviceTask_checkInvoice"');
  });

  it('a trigger change: the qualified prefix of the old trigger is stale (optional: the plain prefix, required: the new qualified one)', async () => {
    const optional = await run(EVENTS, [{ op: 'set', id: 'timerEvent_wait', values: { trigger: 'message', message: 'Paid' } }]);
    expect(stale(optional)[0]?.hint).toContain('`bpmn set <file> timerEvent_wait id=event_wait`');
    const required = await run(EVENTS, [{ op: 'set', id: 'timerEvent_wait', values: { trigger: 'message', message: 'Paid' } }], REQUIRED);
    expect(stale(required)[0]?.message).toBe('timerEvent_wait keeps its id, whose prefix timerEvent_ is that of an intermediateCatchEvent:timer; element-id-naming (.bpmnlintrc in .) expects messageEvent_ for an intermediateCatchEvent:message');
    expect(stale(required)[0]?.hint).toContain('`bpmn set <file> timerEvent_wait id=messageEvent_wait`');
    // retype with a trigger too
    const retyped = await run(EVENTS, [{ op: 'retype', id: 'timerEvent_wait', kind: 'intermediateCatchEvent:signal', signal: 'Go' }], REQUIRED);
    expect(stale(retyped)[0]?.hint).toContain('id=signalEvent_wait`');
  });

  it('none for a prefix that still fits, an id of another convention, without declared conventions, or after a later op renamed it', async () => {
    expect(stale(await run(EVENTS, [{ op: 'set', id: 'event_pause', values: { trigger: 'message', message: 'Paid' } }]))).toEqual([]);
    expect(stale(await run(EVENTS, [{ op: 'retype', id: 'Activity_Legacy', kind: 'userTask' }]))).toEqual([]);
    expect(stale(await run(EVENTS, [{ op: 'retype', id: 'serviceTask_checkInvoice', kind: 'userTask' }], null))).toEqual([]);
    expect(stale(await run(EVENTS, [{ op: 'retype', id: 'serviceTask_checkInvoice', kind: 'userTask' }, { op: 'set', id: 'serviceTask_checkInvoice', values: { id: 'userTask_reviewInvoice' } }]))).toEqual([]);
    expect(stale(await run(EVENTS, [{ op: 'retype', id: 'serviceTask_checkInvoice', kind: 'userTask' }, { op: 'retype', id: 'serviceTask_checkInvoice', kind: 'serviceTask' }]))).toEqual([]);
  });

  it('an id that did not pass the rule for what it was gets the id of what it is now, not its old rest after the new prefix', async () => {
    // a body not in the declared case: serviceTask_shipGoods under PascalCase (scriptTask_shipGoods fails it too)
    const pascal = declared({ case: 'PascalCase' });
    const shipping = definitionsXml('<bpmn:startEvent id="startEvent_Start" name="Start"/><bpmn:serviceTask id="serviceTask_shipGoods" name="Ship goods"/><bpmn:serviceTask id="serviceTask_afterStart"/>');
    const r = await run(shipping, [{ op: 'retype', id: 'serviceTask_shipGoods', kind: 'scriptTask' }], pascal);
    expect(stale(r)).toEqual([
      {
        code: 'W_ID_PREFIX_STALE',
        element: 'serviceTask_shipGoods',
        message: 'serviceTask_shipGoods keeps its id, whose prefix serviceTask_ is that of a serviceTask; element-id-naming (.bpmnlintrc in .) expects scriptTask_ for a scriptTask',
        hint: 'Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> serviceTask_shipGoods id=scriptTask_ShipGoods`.',
      },
    ]);
    // an unnamed one: the words of its id as the context
    expect(stale(await run(shipping, [{ op: 'retype', id: 'serviceTask_afterStart', kind: 'scriptTask' }], pascal))[0]?.hint).toContain('`bpmn set <file> serviceTask_afterStart id=scriptTask_AfterStart`');
    // a prefix without separator that the id starts with by accident (`user` on userTask_checkOrder)
    const user = declared({ prefixes: { 'bpmn:UserTask': 'user' } });
    const checking = await run(definitionsXml('<bpmn:userTask id="userTask_checkOrder" name="Check order"/>'), [{ op: 'retype', id: 'userTask_checkOrder', kind: 'manualTask' }], user);
    expect(stale(checking)[0]?.message).toBe('userTask_checkOrder keeps its id, whose prefix user is that of a userTask; element-id-naming (.bpmnlintrc in .) expects manualTask_ for a manualTask');
    expect(stale(checking)[0]?.hint).toContain('`bpmn set <file> userTask_checkOrder id=manualTask_checkOrder`');
    // an id that passed the rule keeps its rest (the head swapped), as before
    expect(stale(await run(definitionsXml('<bpmn:serviceTask id="serviceTask_ShipGoods" name="Deliver"/>'), [{ op: 'retype', id: 'serviceTask_ShipGoods', kind: 'scriptTask' }], pascal))[0]?.hint).toContain('`bpmn set <file> serviceTask_ShipGoods id=scriptTask_ShipGoods`');
    expect(stale(await run(definitionsXml('<bpmn:userTask id="usercheckOrder" name="Review"/>'), [{ op: 'retype', id: 'usercheckOrder', kind: 'manualTask' }], user))[0]?.hint).toContain('`bpmn set <file> usercheckOrder id=manualTask_checkOrder`');
    // under camelCase userCheckOrder did not pass it: the name's id
    expect(stale(await run(definitionsXml('<bpmn:userTask id="userCheckOrder" name="Review"/>'), [{ op: 'retype', id: 'userCheckOrder', kind: 'manualTask' }], user))[0]?.hint).toContain('`bpmn set <file> userCheckOrder id=manualTask_review`');
    // an unnamed id whose rest after the old prefix is a number: the kind word before it (the declared case wants a
    // letter first), never the old kind's words (userTask_serviceTask1)
    const numbered = definitionsXml('<bpmn:serviceTask id="serviceTask_1"/>');
    const toUser = [{ op: 'retype', id: 'serviceTask_1', kind: 'userTask' }];
    expect(stale(await run(numbered, toUser))[0]?.hint).toContain('`bpmn set <file> serviceTask_1 id=userTask_userTask1`');
    expect(stale(await run(numbered, toUser, pascal))[0]?.hint).toContain('`bpmn set <file> serviceTask_1 id=userTask_UserTask1`');
    // under the case any (every body passes) the prefix matched by accident too: the rest has a prefix of its own
    const any = declared({ case: 'any', prefixes: { 'bpmn:UserTask': 'user' } });
    const anyCase = await run(definitionsXml('<bpmn:userTask id="userTask_checkOrder" name="Check order"/><bpmn:userTask id="userTask_shipOrder" name="Ship order"/><bpmn:userTask id="userTask_reviewIt"/>'), [
      { op: 'retype', id: 'userTask_checkOrder', kind: 'manualTask' },
      { op: 'retype', id: 'userTask_reviewIt', kind: 'manualTask' },
    ], any);
    expect(stale(anyCase).map((w) => w.hint.match(/id=(\S+)`/)?.[1])).toEqual(['manualTask_checkOrder', 'manualTask_reviewIt']);
    // a rest whose own prefix does not complete `was` into the old type's name is a body that passed: the head swapped
    const glued = declared({ case: 'snake_case', prefixes: { 'bpmn:UserTask': 'ut', 'bpmn:ManualTask': 'mt' } });
    expect(stale(await run(definitionsXml('<bpmn:userTask id="utcheck_order"/>'), [{ op: 'retype', id: 'utcheck_order', kind: 'manualTask' }], glued))[0]?.hint).toContain('`bpmn set <file> utcheck_order id=mtcheck_order`');
  });

  it('a batch: one warning per element, from its state before the batch to its state after it, the hint free after the batch', async () => {
    const twice = await run(
      EVENTS,
      [
        { op: 'retype', id: 'serviceTask_checkInvoice', kind: 'userTask' },
        { op: 'retype', id: 'serviceTask_checkInvoice', kind: 'scriptTask' },
        { op: 'set', id: 'timerEvent_wait', values: { trigger: 'message', message: 'Paid' } },
        { op: 'set', id: 'timerEvent_wait', values: { trigger: 'signal', signal: 'Go' } },
      ],
      REQUIRED,
    );
    expect(stale(twice).map((w) => [w.message, w.hint])).toEqual([
      [
        'serviceTask_checkInvoice keeps its id, whose prefix serviceTask_ is that of a serviceTask; element-id-naming (.bpmnlintrc in .) expects scriptTask_ for a scriptTask',
        'Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> serviceTask_checkInvoice id=scriptTask_checkInvoice`.',
      ],
      [
        'timerEvent_wait keeps its id, whose prefix timerEvent_ is that of an intermediateCatchEvent:timer; element-id-naming (.bpmnlintrc in .) expects signalEvent_ for an intermediateCatchEvent:signal',
        'Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> timerEvent_wait id=signalEvent_wait`.',
      ],
    ]);
    // a later op takes the suggested id: the hint names a free one
    const taken = await run(EVENTS, [
      { op: 'retype', id: 'Activity_Legacy', kind: 'scriptTask' },
      { op: 'retype', id: 'serviceTask_checkInvoice', kind: 'scriptTask' },
      { op: 'add', kind: 'scriptTask', id: 'scriptTask_checkInvoice', in: 'Process_1' },
    ]);
    expect(stale(taken).map((w) => w.hint)).toEqual(['Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> serviceTask_checkInvoice id=scriptTask_checkInvoice2`.']);
  });

  it('an element the batch created is nobody\'s API yet: a retype or a trigger change gives it the new prefix, no warning', async () => {
    const start = definitionsXml('<bpmn:startEvent id="startEvent_start" name="Start"/>');
    const retyped = await run(start, [
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'startEvent_start', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ]);
    expect(stale(retyped)).toEqual([]);
    expect(retyped.changes.created.map((c) => [c.id, c.detail])).toEqual([
      ['userTask_checkInvoice', 'after startEvent_start'],
      // the flow's detail names the end by its final id too
      ['flow_startToCheckInvoice', 'startEvent_start -> userTask_checkInvoice'],
    ]);
    expect(retyped.changes.changed.map((c) => c.id)).toEqual(['userTask_checkInvoice']);
    expect(retyped.changes.renames).toEqual([{ from: 'serviceTask_checkInvoice', to: 'userTask_checkInvoice', regenerated: true }]);
    expect(mutationReport(retyped).renamed).toBeUndefined();
    // the file follows the rule: no `conventions:` line; in a file of its own style next to it (Activity_Legacy) the
    // line names the new id where it named the old one
    expect(retyped.conventions).toBeUndefined();
    const mixed = await run(start.replace('</bpmn:process>', '<bpmn:task id="Activity_Legacy" name="Legacy"/></bpmn:process>'), [
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'startEvent_start', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ]);
    expect(mixed.conventions?.ids).toEqual(['flow_startToCheckInvoice', 'userTask_checkInvoice']);
    expect(retyped.xml).toContain('<bpmn:userTask id="userTask_checkInvoice"');
    // a later op of the batch that names the old id learns why it is gone
    await expect(run(start, [
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'startEvent_start', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
      { op: 'set', id: 'serviceTask_checkInvoice', values: { name: 'Review invoice' } },
    ])).rejects.toThrow('No element with id "serviceTask_checkInvoice": an op before this one renamed it to userTask_checkInvoice (a retype or a trigger change gave it the prefix of its new kind)');
    // retyped twice, back and forth: the id follows; a taken one gets a suffix (W_ID_SUFFIXED)
    const twice = await run(EVENTS, [
      { op: 'add', kind: 'task', name: 'Check invoice', in: 'Process_1', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
      { op: 'retype', id: 'userTask_checkInvoice2', kind: 'scriptTask' },
    ]);
    // from the id it wanted: userTask_checkInvoice was taken, scriptTask_checkInvoice is not (its W_ID_SUFFIXED goes)
    expect(createdIds(twice)).toEqual(['scriptTask_checkInvoice']);
    expect(twice.changes.warnings.filter((w) => w.code === 'W_ID_SUFFIXED')).toEqual([]);
    const suffixed = await run(EVENTS, [{ op: 'add', kind: 'task', name: 'Check invoice', in: 'Process_1', as: '$t' }, { op: 'retype', id: '$t', kind: 'serviceTask' }]);
    expect(createdIds(suffixed)).toEqual(['serviceTask_checkInvoice2']);
    expect(suffixed.changes.warnings.filter((w) => w.code === 'W_ID_SUFFIXED').map((w) => w.message)).toEqual(['Id serviceTask_checkInvoice is already taken; using serviceTask_checkInvoice2']);
    // a trigger change under required: the qualified prefix of the new trigger
    const trigger = await run(EVENTS, [
      { op: 'add', kind: 'intermediateCatchEvent:timer', name: 'Wait long', in: 'Process_1', timer: 'P1D', as: '$e' },
      { op: 'set', id: '$e', values: { trigger: 'message', message: 'Paid' } },
      { op: 'add', kind: 'startEvent', name: 'Monthly', in: 'Process_1', as: '$s' },
      { op: 'set', id: '$s', values: { trigger: 'timer', timer: 'R/P1M' } },
    ], REQUIRED);
    expect(stale(trigger)).toEqual([]);
    expect(createdIds(trigger)).toEqual(expect.arrayContaining(['messageEvent_waitLong', 'timerStartEvent_monthly']));
    // an explicit id is the caller's: kept, with the warning
    const explicit = await run(start, [{ op: 'add', kind: 'serviceTask', name: 'Check invoice', id: 'serviceTask_mine', in: 'Process_1' }, { op: 'retype', id: 'serviceTask_mine', kind: 'userTask' }]);
    expect(createdIds(explicit)).toEqual(['serviceTask_mine']);
    expect(stale(explicit).map((w) => w.element)).toEqual(['serviceTask_mine']);
  });

  it('an op of the batch that changed the element before its retype (a new element of the new type): every entry names the final id', async () => {
    const start = definitionsXml('<bpmn:startEvent id="startEvent_start" name="Start"/>');
    const changes: Op[] = [
      { op: 'set', id: '$t', values: { doc: 'Reviews the invoice' } },
      { op: 'set', id: '$t', values: { name: 'Check bill' } },
      { op: 'move', ids: ['$t'], in: 'Process_1' },
    ];
    for (const change of changes) {
      const r = await run(start, [{ op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'startEvent_start', as: '$t' }, change, { op: 'retype', id: '$t', kind: 'userTask' }]);
      const ids = new Set([...r.xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
      expect([...r.changes.created, ...r.changes.changed].map((c) => c.id).filter((id) => !ids.has(id)), change.op).toEqual([]);
      expect(r.changes.changed.map((c) => c.id), change.op).toContain('userTask_checkInvoice');
      const summary = mutationSummary(mutationReport(r));
      expect(summary.changed.filter((id) => !ids.has(id)), change.op).toEqual([]);
    }
  });

  it('the flows the batch named after such an element follow its new id: a prefix without separator, flows named by the ends\' ids, a suffix that no longer applies, a message flow', async () => {
    const glued = declared({ case: 'PascalCase', prefixes: { 'bpmn:ServiceTask': 'ST', 'bpmn:UserTask': 'UT', 'bpmn:SendTask': 'SN', 'bpmn:ReceiveTask': 'RT', 'bpmn:SequenceFlow': 'SF' } });
    const start = definitionsXml('<bpmn:startEvent id="startEvent_Go" name="Go"/>');
    // a task of the file's own style next to the rule: the result's `conventions:` line names the new ids
    const r = await run(start.replace('</bpmn:process>', '<bpmn:task id="Activity_Legacy" name="Legacy"/></bpmn:process>'), [
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'startEvent_Go', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ], glued);
    expect(r.changes.created.map((c) => [c.id, c.detail])).toEqual([['UTCheck', 'after startEvent_Go'], ['SFGoToUTCheck', 'startEvent_Go -> UTCheck']]);
    expect(r.changes.renames).toEqual([
      { from: 'STCheck', to: 'UTCheck', regenerated: true },
      { from: 'SFGoToSTCheck', to: 'SFGoToUTCheck', was: 'startEvent_Go -> STCheck', regenerated: true },
    ]);
    expect(r.conventions?.ids).toEqual(['UTCheck', 'SFGoToUTCheck']);
    // it names its ends, so a later write renames it after its new ones
    const later = await run(r.xml, [{ op: 'add', kind: 'task', name: 'Prepare', flow: 'SFGoToUTCheck' }], glued);
    expect(later.changes.renames).toEqual([expect.objectContaining({ from: 'SFGoToUTCheck', to: 'SFGoToPrepare' })]);
    // a later op of the batch that names the flow's old id learns why it is gone
    await expect(run(start, [
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'startEvent_Go', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
      { op: 'set', id: 'SFGoToSTCheck', values: { name: 'x' } },
    ], glued)).rejects.toThrow('No element with id "SFGoToSTCheck": an op before this one renamed it to SFGoToUTCheck (its id named its old ends)');
    // a message flow, its prefix borrowed from the sequence flows
    const pools = `<bpmn:collaboration id="collaboration_main"><bpmn:participant id="participant_a" name="A" processRef="Process_1"/><bpmn:participant id="participant_b" name="B" processRef="Process_2"/></bpmn:collaboration>
  <bpmn:process id="Process_2"><bpmn:receiveTask id="RTGet" name="Get"/></bpmn:process>`;
    const message = await run(definitionsXml('<bpmn:startEvent id="startEvent_Go" name="Go"/>', { extraRoots: pools }), [
      { op: 'add', kind: 'serviceTask', name: 'Ask', after: 'startEvent_Go', as: '$t' },
      { op: 'connect', source: '$t', target: 'RTGet' },
      { op: 'retype', id: '$t', kind: 'sendTask' },
    ], glued);
    expect(createdIds(message)).toEqual(['SNAsk', 'SFGoToSNAsk', 'SFSNAskToRTGet']);
    // flows named by their ends' ids (idPair), the spliced one too
    const idPair = definitionsXml(`
    <bpmn:task id="task_b" name="B"><bpmn:outgoing>flow_task_b_endEvent_done</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_task_b_endEvent_done</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_task_b_endEvent_done" sourceRef="task_b" targetRef="endEvent_done"/>
    <bpmn:task id="task_x" name="X"><bpmn:outgoing>flow_task_x_task_y</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_y" name="Y"><bpmn:incoming>flow_task_x_task_y</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="flow_task_x_task_y" sourceRef="task_x" targetRef="task_y"/>`);
    const pair = await run(idPair, [
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'task_b' },
      { op: 'retype', id: 'serviceTask_check', kind: 'userTask' },
    ], declared({ case: 'any' }));
    expect(createdIds(pair)).toEqual(['userTask_check', 'flow_userTask_check_endEvent_done']);
    expect(pair.changes.changed.map((c) => [c.id, c.detail])).toEqual([
      ['flow_task_b_userTask_check', 'task_b -> userTask_check (was -> endEvent_done) (renamed from flow_task_b_endEvent_done: its id named its old ends)'],
      ['userTask_check', 'retyped from serviceTask to userTask'],
    ]);
    expect(mutationReport(pair).renamed).toEqual({ flow_task_b_endEvent_done: 'flow_task_b_userTask_check' });
    // the suffix of the old id (serviceTask_check2) is not the new one's: the flow loses it too
    const twice = await run(definitionsXml(''), [
      { op: 'add', kind: 'serviceTask', name: 'Check', in: 'Process_1', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Check', after: '$a' },
      { op: 'retype', id: 'serviceTask_check2', kind: 'userTask' },
    ]);
    expect(twice.changes.created.map((c) => [c.id, c.detail])).toEqual([
      ['serviceTask_check', 'in Process_1'],
      ['userTask_check', 'after serviceTask_check'],
      ['flow_checkToCheck', 'serviceTask_check -> userTask_check'],
    ]);
    expect(twice.changes.warnings).toEqual([]);
  });

  it('a split\'s join is generated too: a retype in the batch gives it the new prefix, the notes name the final ids', async () => {
    const gateways = declared({ prefixes: { 'bpmn:ExclusiveGateway': 'xor_', 'bpmn:ParallelGateway': 'and_' } });
    const r = await run(definitionsXml('<bpmn:startEvent id="startEvent_go" name="Go"/>'), [
      { op: 'split', after: 'startEvent_go', kind: 'xor', name: 'Ok?', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }] },
      { op: 'retype', id: 'xor_ok', kind: 'and' },
      { op: 'retype', id: 'xor_okJoin', kind: 'and' },
    ], gateways);
    expect(createdIds(r)).toEqual(expect.arrayContaining(['and_ok', 'and_okJoin']));
    expect(stale(r)).toEqual([]);
    expect(r.changes.notes).toContain('split and_ok: 2 branch(es) ending at task_a, task_b, joined at and_okJoin');
    // an explicit joinId is the caller's
    const explicit = await run(definitionsXml('<bpmn:startEvent id="startEvent_go" name="Go"/>'), [
      { op: 'split', after: 'startEvent_go', kind: 'xor', name: 'Ok?', joinId: 'xor_mine', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }] },
      { op: 'retype', id: 'xor_mine', kind: 'and' },
    ], gateways);
    expect(stale(explicit).map((w) => w.element)).toEqual(['xor_mine']);
    // a note that names an element the batch then gave a new id
    const timer = await run(definitionsXml(''), [
      { op: 'add', kind: 'intermediateCatchEvent:timer', name: 'Two days', in: 'Process_1', timer: 'P2D', as: '$e' },
      { op: 'add', kind: 'task', name: 'Next', after: '$e' },
      { op: 'set', id: '$e', values: { trigger: 'message', message: 'Reply' } },
    ], declared({ case: 'snake_case', eventDefinitionQualifier: 'required' }));
    expect(timer.changes.notes).toEqual(['appended after messageEvent_two_days']);
  });

  it('an id of a kind the rule did not check (a type switched off, a qualified prefix too long): a generated one takes the new kind\'s, one of the file is named stale', async () => {
    const off = declared({ prefixes: { 'bpmn:ScriptTask': false } });
    const generated = await run(definitionsXml('<bpmn:task id="task_check" name="Check"/>'), [
      { op: 'add', kind: 'scriptTask', name: 'Run', in: 'Process_1' },
      { op: 'retype', id: 'scriptTask_run', kind: 'serviceTask' },
      { op: 'add', kind: 'scriptTask', after: 'task_check' },
      { op: 'retype', id: 'scriptTask_afterCheck', kind: 'serviceTask' },
    ], off);
    expect(createdIds(generated)).toEqual(['serviceTask_run', 'serviceTask_afterCheck', 'flow_checkToAfterCheck']);
    expect(stale(generated)).toEqual([]);
    const file = await run(definitionsXml('<bpmn:scriptTask id="scriptTask_run" name="Run"/>'), [{ op: 'retype', id: 'scriptTask_run', kind: 'serviceTask' }], off);
    expect(stale(file)).toEqual([
      {
        code: 'W_ID_PREFIX_STALE',
        element: 'scriptTask_run',
        message: 'scriptTask_run keeps its id, which element-id-naming (.bpmnlintrc in .) did not check on a scriptTask; it expects serviceTask_ for a serviceTask',
        hint: 'Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> scriptTask_run id=serviceTask_run`.',
      },
    ]);
    // under required, an end event whose qualified prefix is too long follows the file; a trigger whose prefix fits takes it
    const long = declared({ case: 'snake_case', eventDefinitionQualifier: 'required', prefixes: { 'bpmn:EndEvent': 'endEventWithAVeryLongPrefixThatIsFiftyCharactersX_' } });
    const event = await run(definitionsXml(''), [
      { op: 'add', kind: 'endEvent:message', name: 'Replied', in: 'Process_1', message: 'Reply', as: '$e' },
      { op: 'set', id: '$e', values: { trigger: 'error', error: 'Boom' } },
    ], long);
    expect(createdIds(event)).toContain('errorEndEventWithAVeryLongPrefixThatIsFiftyCharactersX_replied');
  });

  it('a generated id an op frees and the batch claims explicitly is the caller\'s: kept, with the warning', async () => {
    const existing = definitionsXml('<bpmn:serviceTask id="serviceTask_existing" name="Existing"/>');
    for (const claim of [
      { op: 'add', kind: 'serviceTask', name: 'Check', id: 'serviceTask_check', in: 'Process_1' },
      { op: 'set', id: 'serviceTask_existing', values: { id: 'serviceTask_check' } },
    ]) {
      const r = await run(existing, [
        { op: 'add', kind: 'serviceTask', name: 'Check', in: 'Process_1' },
        { op: 'remove', ids: ['serviceTask_check'] },
        claim,
        { op: 'retype', id: 'serviceTask_check', kind: 'userTask' },
      ]);
      expect(r.xml, claim.op).toContain('<bpmn:userTask id="serviceTask_check"');
      expect(stale(r).map((w) => w.element), claim.op).toEqual(['serviceTask_check']);
    }
  });
});

describe('bpmn show --conventions (the view)', () => {
  it('groups the patterns by source; a pattern of one kind reads as it is; the qualified prefixes in one line', async () => {
    const view = conventionsView(await Doc.fromXml(PASCAL), BARE, { file: 'x.bpmn', severity: 'warn' });
    expect(view).toMatchObject({ file: 'x.bpmn', exists: true, source: '.bpmnlintrc in .', rule: { severity: 'warn', case: 'camelCase', qualifier: 'optional' }, qualified: { mode: 'optional', examples: ['timerStartEvent_', 'messageEvent_', 'errorEndEvent_'] } });
    const row = (kind: string) => view.rows.find((r) => r.kinds.includes(kind));
    expect(row('serviceTask')).toEqual({ pattern: '<kind>_{name:camel}', source: 'lint', kinds: ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask', 'subProcess', 'callActivity', 'startEvent', 'endEvent'] });
    // what the rule does not name follows the file: its type-named PascalCase prefixes; the process bpmn-cli's own
    expect(row('lane')).toEqual({ pattern: '<Kind>_{name:pascal}', source: 'file', kinds: ['participant', 'lane', 'textAnnotation', 'group', 'collaboration', 'message'], note: 'not checked' });
    expect(row('process')).toEqual({ pattern: 'Process_{name:pascal}', source: 'default', kinds: ['process'], note: 'not checked' });
    expect(row('dataObject')).toMatchObject({ pattern: 'DataObjectReference_{name:pascal}', source: 'file' });
    expect(row('sequenceFlow')).toEqual({ pattern: 'flow_{source}To{target}', source: 'lint', kinds: ['sequenceFlow'] });
    expect(row('messageFlow')).toEqual({ pattern: 'flow_{source}To{target}', source: 'lint shape', kinds: ['messageFlow'], note: 'not checked' });

    const text = renderConventions(view);
    expect(text.split('\n').slice(0, 2)).toEqual(['conventions of x.bpmn', 'element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional']);
    expect(text).toContain('  events with a trigger: <trigger><Prefix> (timerStartEvent_, messageEvent_, errorEndEvent_) also accepted, new ids take the plain prefix');
    // required: the qualified prefix is the one new ids take
    expect(renderConventions(conventionsView(undefined, REQUIRED))).toContain('required, new ids take it');
  });

  it('a new file, and no conventions declared', async () => {
    const fresh = await conventionsXml(undefined, { conventions: BARE, file: 'new.bpmn' });
    expect(fresh.exists).toBe(false);
    expect(fresh.rows.find((r) => r.kinds.includes('lane'))).toMatchObject({ pattern: '<kind>_{name:camel}', source: 'lint shape' });
    expect(fresh.rows.find((r) => r.kinds.includes('process'))).toMatchObject({ pattern: 'Process_{name:pascal}', source: 'default' });
    expect(renderConventions(fresh).split('\n')[0]).toBe('conventions of new.bpmn (no file yet: a new model)');
    const none = await conventionsXml(PASCAL);
    expect(none.rule).toBeUndefined();
    expect(none.rows.find((r) => r.kinds.includes('serviceTask'))).toEqual({ pattern: 'Activity_{name:pascal}', source: 'file', kinds: ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask', 'subProcess', 'eventSubProcess', 'adHocSubProcess', 'transaction', 'callActivity'] });
    expect(renderConventions(none).split('\n')[1]).toBe("no id conventions declared: new ids follow the file's id style");
  });

  it('says why none are declared; W_LINT_UNAVAILABLE among the notes', async () => {
    const doc = await Doc.fromXml(PASCAL);
    const line = (opts: Parameters<typeof conventionsView>[2], conventions?: IdConventions) => renderConventions(conventionsView(doc, conventions, opts)).split('\n')[1];
    expect(line({ undeclared: 'skipped' })).toBe("no id conventions: --no-lint-config leaves the .bpmnlintrc out; new ids follow the file's id style");
    expect(line({ undeclared: 'no config' })).toBe("no id conventions: no .bpmnlintrc applies here; new ids follow the file's id style");
    expect(line({ undeclared: 'off', where: '.bpmnlintrc in models' })).toBe("no id conventions: element-id-naming is off or not configured in the .bpmnlintrc in models; new ids follow the file's id style");
    // a host table without a usable prefix
    expect(line({}, { prefixes: { 'bpmn:ServiceTask': '1_' }, source: 'our rules' })).toBe("no id conventions: element-id-naming (our rules) declares no prefix new ids can follow; new ids follow the file's id style");
    const notes = [{ severity: 'warning' as const, code: 'W_LINT_UNAVAILABLE', message: '.bpmnlintrc is not JSON', hint: 'Write it as strict JSON.' }];
    const broken = conventionsView(doc, undefined, { undeclared: 'not loaded', where: '.bpmnlintrc in .', notes });
    expect(broken).toMatchObject({ source: '.bpmnlintrc in .', undeclared: 'not loaded', notes });
    expect(renderConventions(broken).split('\n')).toEqual(expect.arrayContaining([
      "no id conventions: the .bpmnlintrc in . could not be loaded (W_LINT_UNAVAILABLE below); new ids follow the file's id style",
      'warning W_LINT_UNAVAILABLE: .bpmnlintrc is not JSON  (Write it as strict JSON.)',
    ]));
    // declared: no reason
    expect(conventionsView(doc, BARE, { undeclared: 'off' }).undeclared).toBeUndefined();
  });

  it('a type the rule checks with a prefix new ids cannot follow is marked so, not `not checked`', async () => {
    const view = conventionsView(await Doc.fromXml(PASCAL), declared({ prefixes: { 'bpmn:UserTask': 'user task_', 'bpmn:Gateway': 'a gate_' } }));
    const row = (kind: string) => view.rows.find((r) => r.kinds.includes(kind));
    expect(row('userTask')).toMatchObject({ source: 'file', note: 'checked; prefix ignored (W_CONFIG_IGNORED)' });
    expect(row('exclusiveGateway')).toMatchObject({ source: 'file', kinds: ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'complexGateway', 'eventBasedGateway'], note: 'checked; prefix ignored (W_CONFIG_IGNORED)' });
    expect(row('lane')?.note).toBe('not checked');
    // under required, the triggers whose qualified prefix is too long for new ids: they follow the file's style
    const long = conventionsView(undefined, declared({ case: 'snake_case', eventDefinitionQualifier: 'required', prefixes: { 'bpmn:EndEvent': 'endEventWithAVeryLongPrefixThatIsFiftyCharactersX_' } }));
    expect(long.rows.find((r) => r.kinds.includes('endEvent'))).toEqual({
      pattern: 'endEventWithAVeryLongPrefixThatIsFiftyCharactersX_{name:snake}',
      source: 'lint',
      kinds: ['endEvent'],
      note: "message, escalation, terminate, compensate: qualified prefix ignored, the file's style (W_CONFIG_IGNORED)",
    });
    expect(renderConventions(long)).toContain(') required, new ids take it (not the triggers marked above)');
  });

  it('the flow pattern is the head new flows get: F_ after numbered F1..F12, flow glued after flow1..flow12, a long prefix where the ends fit, Flow_ after one that leaves no room', async () => {
    const numbered = (ids: string[]) => definitionsXml(`
    <bpmn:startEvent id="StartEvent_Start" name="Start"/>
    <bpmn:task id="Activity_PackGoods" name="Pack goods"/>
    <bpmn:task id="Activity_ShipGoods" name="Ship goods"/>
    <bpmn:endEvent id="EndEvent_End" name="End"/>
    <bpmn:sequenceFlow id="${ids[0]}" sourceRef="StartEvent_Start" targetRef="Activity_PackGoods"/>
    <bpmn:sequenceFlow id="${ids[1]}" sourceRef="Activity_PackGoods" targetRef="Activity_ShipGoods"/>
    <bpmn:sequenceFlow id="${ids[2]}" sourceRef="Activity_ShipGoods" targetRef="EndEvent_End"/>`);
    for (const [ids, pattern, id] of [
      [['F1', 'F2', 'F3'], 'F_{source}To{target}', 'F_PackGoodsToEnd'],
      [['flow1', 'flow2', 'flow3'], 'flow{source}To{target}', 'flowPackGoodsToEnd'],
      // a prefix that leaves the ends fewer than 16 characters stays where they fit (before: Flow_PackGoodsToEnd)
      [['Q'.repeat(47) + '_1', 'Q'.repeat(47) + '_2', 'Q'.repeat(47) + '_3'], `${'Q'.repeat(47)}_{source}To{target}`, `${'Q'.repeat(47)}_PackGoodsToEnd`],
      [['Q'.repeat(60) + '_1', 'Q'.repeat(60) + '_2', 'Q'.repeat(60) + '_3'], 'Flow_{source}To{target}', 'Flow_PackGoodsToEnd'],
    ] as const) {
      const xml = numbered([...ids]);
      const row = conventionsView(await Doc.fromXml(xml), undefined).rows.find((r) => r.kinds.includes('sequenceFlow'));
      expect(row?.pattern, ids[0]).toBe(pattern);
      expect(row?.note, ids[0]).toBe(ids[0].length === 49 ? 'Flow_ where the ends do not fit' : undefined);
      expect(createdIds(await run(xml, [{ op: 'connect', source: 'Activity_PackGoods', target: 'EndEvent_End' }], null))).toEqual([id]);
    }
    // beside the long prefix the ends give up whole words; where their first words do not fit: Flow_
    const q47 = numbered(['Q'.repeat(47) + '_1', 'Q'.repeat(47) + '_2', 'Q'.repeat(47) + '_3']);
    expect(createdIds(await run(q47, [{ op: 'connect', source: 'Activity_ShipGoods', target: 'Activity_PackGoods' }], null))).toEqual([`${'Q'.repeat(47)}_ShipToPackGoods`]);
    expect(createdIds(await run(q47, [{ op: 'add', kind: 'task', name: 'Warenwirtschaftssystemabgleich', after: 'Activity_ShipGoods' }], null))).toEqual(['Activity_Warenwirtschaftssystemabgleich', 'Flow_WarenwirtschaftssystemabgleichToEnd']);
  });
});
