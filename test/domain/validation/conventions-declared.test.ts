/**
 * Declared id conventions in the core (issue #34; src/domain/document/ids/IdStyle.ts DECLARED
 * CONVENTIONS): they fill the gaps a change opens and never rename what is
 * there; the rest takes element-id-naming's defaults or bpmn-cli's own prefix,
 * whatever ids the file already has; W_ID_PREFIX_STALE after a retype or a trigger
 * change; the view of `bpmn show --conventions`. The conventions come
 * from the real plugin's naming helpers (src/adapters/out/bpmnlint/IdConventionsReader.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, conventionsXml } from '../../../src/api.js';
import type { BpmnlintRuleSetting } from '../../../src/domain/document/ids/bpmnlint-rule-setting.js';
import { conventionsView, idConventionsFromLint, renderConventions, type IdConventions, mutateDoc, mutationReport, mutationSummary } from '../../../src/index.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { bpmnlintEngine } from '../../../src/node.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import type { MutationResult } from '../../../src/domain/batch/types.js';
import { definitionsXml } from '../../helpers/helpers.js';

const naming = bpmnlintEngine().plugin.naming;
const declared = (config: unknown = {}, severity: BpmnlintRuleSetting['severity'] = 'warn'): IdConventions => idConventionsFromLint({ severity, config }, naming, { source: '.bpmnlintrc in .' }).conventions!;
const BARE = declared();
const REQUIRED = declared({ eventDefinitionQualifier: 'required' });

/** The ids a change created, in order. */
const createdIds = (mutation: MutationResult): string[] => mutation.changes.created.map((created) => created.id);

/** `ops` on `xml` with the declared conventions (null: none). */
async function run(xml: string, ops: unknown[], conventions: IdConventions | null = BARE, opts: { keepFlowIds?: boolean } = {}): Promise<MutationResult> {
  return mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops as EditCommand[], { layout: false, ...(conventions ? { conventions } : {}), ...opts });
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
  it('a kind the rule names takes its prefix, also in a file of another style', async () => {
    const result = await run(PASCAL, [
      { op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' },
      { op: 'add', kind: 'lane', name: 'Warehouse', in: 'Process_1' },
      { op: 'add', kind: 'dataObject', name: 'Delivery note', in: 'Process_1' },
    ]);
    expect(createdIds(result)).toEqual(['serviceTask_bookOrder', 'flow_bookOrderToShipOrder', 'lane_warehouse', 'dataObject_deliveryNote']);
    expect(result.xml).toContain('<bpmn:dataObject id="dataObjectItem_deliveryNote"/>');
    // the spliced flow is not of the declared form: it keeps its id
    expect(result.changes.renames).toEqual([]);
  });

  it('a new file: what the rule does not name takes its case and prefix shape, stable over many writes', async () => {
    let xml = definitionsXml('');
    const ids: string[] = [];
    for (const team of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const result = await run(xml, [
        { op: 'add', kind: 'lane', name: `Team ${team}`, in: 'Process_1' },
        { op: 'add', kind: 'task', name: `Work ${team}`, in: 'Process_1' },
      ]);
      ids.push(...createdIds(result));
      xml = result.xml;
    }
    expect(ids.filter((id) => id.startsWith('lane'))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => `lane_team${letter}`));
    expect(ids.filter((id) => id.startsWith('task_'))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => `task_work${letter}`));
  });

  it('pools, lanes, data and annotations take the rule\'s default prefixes in a file of hashes too; backing data the type name', async () => {
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
    expect(createdIds(pools)).toEqual(['collaboration_process', 'participant_customer', 'dataStore_archive', 'textAnnotation_beQuick', 'lane_backOffice']);
    expect(pools.xml).toContain('<bpmn:dataStore id="dataStoreItem_archive"');
  });

  it('a new file\'s lanes take the declared case over many writes, also in a file of other lanes', async () => {
    for (const [conventions, expected] of [
      [BARE, ['lane_sales', 'lane_invoice', 'lane_backOffice', 'lane_orderArchive']],
      [declared({ case: 'snake_case' }), ['lane_sales', 'lane_invoice', 'lane_back_office', 'lane_order_archive']],
    ] as const) {
      let xml = definitionsXml('');
      const lanes: string[] = [];
      for (const name of ['Sales', 'Invoice', 'Back office', 'Order archive']) {
        const result = await run(xml, [{ op: 'add', kind: 'lane', name, in: 'Process_1' }], conventions);
        lanes.push(...createdIds(result).filter((id) => id.startsWith('lane_')));
        xml = result.xml;
      }
      expect(lanes).toEqual(expected);
    }
    const snake = definitionsXml(`
    <bpmn:laneSet id="laneSet_main"><bpmn:lane id="lane_back_office" name="Back office"/><bpmn:lane id="lane_order_archive" name="Order archive"/><bpmn:lane id="lane_sales" name="Sales"/></bpmn:laneSet>`);
    expect(createdIds(await run(snake, [{ op: 'add', kind: 'lane', name: 'Shared services', in: 'Process_1' }]))).toEqual(['lane_sharedServices']);
    const lower = definitionsXml(`
    <bpmn:laneSet id="laneSet_main"><bpmn:lane id="lane_sales" name="Sales"/><bpmn:lane id="lane_billing" name="Billing"/></bpmn:laneSet>
    <bpmn:task id="task_placeOrder" name="Place order"/>`);
    expect(createdIds(await run(lower, [{ op: 'add', kind: 'lane', name: 'Back office', in: 'Process_1' }, { op: 'add', kind: 'task', name: 'Ship goods', in: 'Process_1' }], declared({ case: 'PascalCase' })))).toEqual(['lane_BackOffice', 'task_ShipGoods']);
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
    expect(camel.changes.warnings.filter((warning) => warning.code === 'W_ID_SUFFIXED').map((warning) => warning.element)).toEqual(['serviceTask_checkOrder2', 'gateway_afterCheckOrderJoin2']);
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
    expect(camel.changes.warnings.filter((warning) => warning.code === 'W_ID_SUFFIXED').map((warning) => warning.message)).toEqual([
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
    // snake_case keeps `_2`; the id a retype in the batch gives (IdAllocator.regenerated) and the W_ID_PREFIX_STALE hint take No too
    const snake = await run(definitionsXml(''), [{ op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1' }, { op: 'add', kind: 'serviceTask', name: 'Step 1', in: 'Process_1' }], declared({ case: 'snake_case' }));
    expect(createdIds(snake)).toEqual(['serviceTask_step_1', 'serviceTask_step_1_2']);
    const retyped = await run(definitionsXml('<bpmn:serviceTask id="serviceTask_step1" name="Step 1"/>'), [{ op: 'add', kind: 'task', name: 'Step 1', in: 'Process_1', as: '$t' }, { op: 'retype', id: '$t', kind: 'serviceTask' }]);
    expect(createdIds(retyped)).toEqual(['serviceTask_step1No2']);
    const hinted = await run(definitionsXml('<bpmn:serviceTask id="serviceTask_step1" name="Step 1"/><bpmn:userTask id="userTask_step1" name="Step 1"/>'), [{ op: 'retype', id: 'serviceTask_step1', kind: 'userTask' }]);
    expect(hinted.changes.warnings.find((warning) => warning.code === 'W_ID_PREFIX_STALE')?.hint).toContain('`bpmn set <file> serviceTask_step1 id=userTask_step1No2`');
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
    const result = await run(bare, split({ id: 'Gateway_Check' }), declared({ case: 'snake_case' }));
    expect(createdIds(result)).toEqual(expect.arrayContaining(['Gateway_Check', 'gateway_check_join']));
    expect(await joins(bare, split({ id: 'Gateway_Check' }), BARE)).toEqual(['gateway_checkJoin']);
    expect(await joins(bare, split({ id: 'Gateway_0abc123', name: 'Invoice ok?' }), BARE)).toEqual(['gateway_invoiceOkJoin']);
    // one the prefix starts keeps <id>Join
    expect(await joins(bare, split({ id: 'gateway_check' }), BARE)).toEqual(['gateway_checkJoin']);
    // one the prefix starts with a body in another case than the declared one: the prefix and the words of that body
    expect(await joins(bare, split({ id: 'gateway_Approved' }), BARE)).toEqual(['gateway_approvedJoin']);
    expect(await joins(bare, split({ id: 'gateway_approved_check' }), BARE)).toEqual(['gateway_approvedCheckJoin']);
    expect(await joins(bare, split({ id: 'gateway_ok-1' }), BARE)).toEqual(['gateway_ok1Join']);
    expect(await joins(bare, split({ id: 'gateway_approved' }), declared({ case: 'PascalCase' }))).toEqual(['gateway_ApprovedJoin']);
    expect(await joins(bare, split({ id: 'gateway_Approved' }), declared({ case: 'snake_case' }))).toEqual(['gateway_approved_join']);
    expect(await joins(bare, split({ id: 'gwApproved' }), declared({ prefixes: { 'bpmn:Gateway': 'gw' } }))).toEqual(['gwapprovedJoin']);
    // `any` checks no case: Join after the id as it is; without declared conventions the defaults' join
    expect(await joins(bare, split({ id: 'gateway_Approved' }), declared({ case: 'any' }))).toEqual(['gateway_ApprovedJoin']);
    expect(createdIds(await run(bare, split({ id: 'Gateway_Check' }), null))).toContain('gateway_checkJoin');
  });

  it('flows: the named form with the declared prefix, the ends after the first `_` of their ids, message flows with their own prefix', async () => {
    const scoped = definitionsXml(`
    <bpmn:startEvent id="Event_KotO_Start" name="Start"><bpmn:outgoing>Flow_KotO_StartToCheckInvoice</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_KotO_CheckInvoice" name="Check invoice"><bpmn:incoming>Flow_KotO_StartToCheckInvoice</bpmn:incoming><bpmn:outgoing>Flow_KotO_CheckInvoiceToBook</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_KotO_Book" name="Book"><bpmn:incoming>Flow_KotO_CheckInvoiceToBook</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_KotO_StartToCheckInvoice" sourceRef="Event_KotO_Start" targetRef="Activity_KotO_CheckInvoice"/>
    <bpmn:sequenceFlow id="Flow_KotO_CheckInvoiceToBook" sourceRef="Activity_KotO_CheckInvoice" targetRef="Activity_KotO_Book"/>`);
    const result = await run(scoped, [{ op: 'add', kind: 'task', name: 'Archive', after: 'Activity_KotO_Book' }]);
    expect(createdIds(result)).toEqual(['task_archive', 'flow_kotOBookToArchive']);
    const pools = await run(definitionsXml('<bpmn:task id="Activity_A" name="Send offer"/>'), [
      { op: 'add', kind: 'participant', name: 'Supplier' },
      { op: 'add', kind: 'participant', name: 'Customer', as: '$c' },
      { op: 'connect', source: 'Activity_A', target: '$c' },
    ]);
    expect(createdIds(pools).at(-1)).toBe('messageFlow_sendOfferToCustomer');
    expect(createdIds(await run(definitionsXml('<bpmn:task id="Activity_A" name="Send offer"/>'), [{ op: 'add', kind: 'participant', name: 'Supplier' }, { op: 'add', kind: 'participant', name: 'Customer', as: '$c' }, { op: 'connect', source: 'Activity_A', target: '$c' }], declared({ prefixes: { 'bpmn:MessageFlow': 'mf_' } }))).at(-1)).toBe('mf_sendOfferToCustomer');
  });

  it('message flows keep their prefix and the declared case over many writes', async () => {
    const pools = [
      { op: 'add', kind: 'participant', name: 'Main' },
      { op: 'add', kind: 'participant', name: 'Customer' },
    ];
    for (const [conventions, expected, pattern] of [
      [BARE, ['messageFlow_sendOneToCustomer', 'messageFlow_sendTwoToCustomer', 'messageFlow_sendThreeToCustomer'], 'messageFlow_{source}To{target}'],
      [declared({ case: 'snake_case' }), ['messageFlow_send_one_to_customer', 'messageFlow_send_two_to_customer', 'messageFlow_send_three_to_customer'], 'messageFlow_{source}_to_{target}'],
    ] as const) {
      let xml = PASCAL;
      const flows: string[] = [];
      for (const [wordIndex, word] of ['One', 'Two', 'Three'].entries()) {
        const result = await run(xml, [
          ...(wordIndex ? [] : pools),
          { op: 'add', kind: 'intermediateThrowEvent:message', name: `Send ${word}`, in: 'Process_1', message: word, as: '$e' },
          { op: 'connect', source: '$e', target: 'participant_customer' },
        ], conventions);
        flows.push(createdIds(result).at(-1)!);
        xml = result.xml;
      }
      expect(flows).toEqual(expected);
      expect(conventionsView(await Doc.fromXml(xml), conventions).rows.find((row) => row.kinds.includes('messageFlow'))).toEqual({ pattern, source: 'lint', kinds: ['messageFlow'] });
    }
  });

  it('the process of a new pool takes its name alone, over many writes', async () => {
    let doc = Doc.create({ processName: 'Order', conventions: BARE });
    const processes: string[] = [];
    for (const name of ['Main', 'Customer', 'Supplier', 'Back office', 'Tax office']) {
      const result = await mutateDoc(doc, [{ op: 'add', kind: 'participant', name }] as EditCommand[], { layout: false, conventions: BARE });
      processes.push(...result.changes.created.filter((created) => created.kind === 'process').map((created) => created.id));
      doc = await Doc.fromXml(result.xml);
    }
    expect(processes).toEqual(['customer', 'supplier', 'backOffice', 'taxOffice']);
    expect(doc.processes().map((processElement) => processElement.get('id'))).toEqual(['order', ...processes]);
  });

  it('a new pool\'s process takes its name in the declared case whatever the file\'s process ids; an exact entry for bpmn:Process decides', async () => {
    const pools = (procs: [string, string]): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="collaboration_main">
    <bpmn:participant id="participant_customer" name="Customer" processRef="${procs[0]}"/>
    <bpmn:participant id="participant_shop" name="Shop" processRef="${procs[1]}"/>
  </bpmn:collaboration>
  <bpmn:process id="${procs[0]}" isExecutable="false"><bpmn:startEvent id="startEvent_order" name="Order"/></bpmn:process>
  <bpmn:process id="${procs[1]}" isExecutable="true"><bpmn:userTask id="userTask_checkOrder" name="Check order"/></bpmn:process>
</bpmn:definitions>`;
    const pool = async (xml: string, conventions: IdConventions | null): Promise<string[]> => {
      const result = await run(xml, [{ op: 'add', kind: 'participant', name: 'Bank account' }], conventions);
      return result.changes.created.filter((created) => created.kind === 'process' || created.kind === 'participant').map((created) => created.id);
    };
    for (const procs of [['process_customer', 'process_shop'], ['Process_1', 'Process_0k3x9qa']] as Array<[string, string]>) {
      const xml = pools(procs);
      expect([await pool(xml, BARE), await pool(xml, null)], procs[0]).toEqual([['bankAccount', 'participant_bankAccount'], ['bankAccount', 'participant_bankAccount']]);
      expect(await pool(xml, declared({ case: 'snake_case' })), procs[0]).toEqual(['bank_account', 'participant_bank_account']);
      expect(await pool(xml, declared({ prefixes: { 'bpmn:Process': 'process_' } })), procs[0]).toEqual(['process_bankAccount', 'participant_bankAccount']);
    }
    // the view: the process row is bpmn-cli's, or the declared prefix
    const xml = pools(['process_customer', 'process_shop']);
    expect(conventionsView(await Doc.fromXml(xml), BARE).rows.find((row) => row.kinds.includes('process'))).toEqual({ pattern: '{name:camel}', source: 'bpmn-cli', kinds: ['process'], note: 'not checked; unnamed: Process_1' });
    expect(conventionsView(await Doc.fromXml(xml), declared({ prefixes: { 'bpmn:Process': 'process_' } })).rows.find((row) => row.kinds.includes('process'))).toMatchObject({ pattern: '<kind>_{name:camel}', source: 'lint' });
  });

  it('explicit ids are taken as given; the process and the definitions keep theirs', async () => {
    const result = await run(definitionsXml(''), [
      { op: 'add', kind: 'serviceTask', name: 'Book', id: 'Activity_Book', in: 'Process_1' },
      { op: 'add', kind: 'participant', name: 'Billing' },
    ]);
    expect(createdIds(result)).toEqual(['Activity_Book', 'collaboration_process', 'participant_billing']);
    expect(result.xml).toContain('<bpmn:process id="Process_1"');
  });

  it('a flow of the declared form still names its ends: renamed after its new ones, or kept with keepFlowIds and named stale; a flow of another form keeps its id', async () => {
    const ops = [{ op: 'add', kind: 'task', name: 'Pack order', flow: 'flow_checkOrderToShipOrder' }];
    const renamed = await run(CONFORMING, ops);
    expect(renamed.changes.renames.map((rename) => `${rename.from} -> ${rename.to}`)).toEqual(['flow_checkOrderToShipOrder -> flow_checkOrderToPackOrder']);
    const kept = await run(CONFORMING, ops, BARE, { keepFlowIds: true });
    expect(kept.changes.renames).toEqual([]);
    expect(kept.changes.warnings.find((warning) => warning.code === 'W_FLOW_ID_STALE')?.hint).toContain('`bpmn set <file> flow_checkOrderToShipOrder id=flow_checkOrderToPackOrder`');
    const other = await run(PASCAL, [{ op: 'add', kind: 'task', name: 'Pack order', flow: 'Flow_CheckOrderToShipOrder' }]);
    expect(other.changes.renames).toEqual([]);
    expect(other.changes.warnings.filter((warning) => warning.code === 'W_FLOW_ID_STALE')).toEqual([]);
  });

  it('a host passes its own table (no plugin); unusable prefixes are left out; a type without one takes its type name', async () => {
    const host: IdConventions = { prefixes: { 'bpmn:ServiceTask': 'svc_', 'bpmn:SequenceFlow': 'sf_', 'bpmn:UserTask': 'user task_' }, case: 'camelCase' };
    const result = await applyToXml(PASCAL, [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' }, { op: 'add', kind: 'userTask', name: 'Approve', after: 'Activity_ShipOrder' }], { layout: false, conventions: host });
    expect(result.result.created.map((created) => created.id)).toEqual(['svc_bookOrder', 'sf_bookOrderToShipOrder', 'userTask_approve', 'sf_approveToDone']);
    const none = await applyToXml(PASCAL, [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'Activity_CheckOrder' }], { layout: false, conventions: { prefixes: { 'bpmn:ServiceTask': '1_' } } });
    expect(none.result.created.map((created) => created.id)).toEqual(['serviceTask_bookOrder', 'sequenceFlow_bookOrderToShipOrder']);
  });
});

describe('a new file under the rule', () => {
  it('the process and the definitions of an unnamed model take an exact prefix; one change after another follows the rule', async () => {
    const processOnly = declared({ prefixes: { 'bpmn:Process': 'process_' } });
    const unnamed = await mutateDoc(Doc.create({ conventions: processOnly }), [], { layout: false, conventions: processOnly });
    expect(unnamed.xml).toContain('id="definitions_main"');
    expect(unnamed.xml).toContain('<bpmn:process id="process_main"');
    let doc = Doc.create({ conventions: BARE });
    for (const ops of [
      [{ op: 'add', kind: 'startEvent', name: 'Order received', in: 'Process_1' }],
      [{ op: 'add', kind: 'serviceTask', name: 'Check order', after: 'startEvent_orderReceived' }],
      [{ op: 'add', kind: 'serviceTask', name: 'Book order', after: 'serviceTask_checkOrder' }],
      [{ op: 'add', kind: 'xor', name: 'Approved?', after: 'serviceTask_bookOrder' }],
      [{ op: 'split', after: 'gateway_approved', kind: 'and', branches: [{ nodes: [{ kind: 'userTask', name: 'Pack' }] }, { nodes: [{ kind: 'userTask', name: 'Bill' }] }] }],
    ]) {
      doc = await Doc.fromXml((await mutateDoc(doc, ops as EditCommand[], { layout: false, conventions: BARE })).xml);
    }
    expect(doc.flowElements(doc.processes()[0]!).map((element) => element.get('id'))).toEqual(expect.arrayContaining(['gateway_approved', 'gateway_afterApproved', 'gateway_afterApprovedJoin', 'userTask_pack', 'userTask_bill']));
  });

  it('a lane, pools and a message flow take the rule\'s defaults; a type whose prefix it cannot use bpmn-cli\'s own', async () => {
    const fresh = await run(definitionsXml('<bpmn:sendTask id="sendTask_send" name="Send"/>'), [
      { op: 'add', kind: 'lane', name: 'Sales', in: 'Process_1' },
      { op: 'add', kind: 'participant', name: 'Customer' },
      { op: 'add', kind: 'participant', name: 'Bank', as: '$b' },
      { op: 'connect', source: 'sendTask_send', target: '$b' },
    ]);
    expect(createdIds(fresh)).toEqual(['lane_sales', 'collaboration_process', 'participant_customer', 'bank', 'participant_bank', 'messageFlow_sendToBank']);
    const ignored = declared({ prefixes: { 'bpmn:UserTask': '1user_' } });
    expect(ignored.ignored).toEqual(['bpmn:UserTask']);
    expect(createdIds(await run(definitionsXml(''), [{ op: 'add', kind: 'userTask', name: 'Check it', in: 'Process_1' }], ignored))).toEqual(['userTask_checkIt']);
  });
});

describe('W_ID_PREFIX_STALE', () => {
  const EVENTS = definitionsXml(`
    <bpmn:serviceTask id="serviceTask_checkInvoice" name="Check invoice"/>
    <bpmn:userTask id="userTask_checkInvoice" name="Check invoice"/>
    <bpmn:task id="Activity_Legacy" name="Legacy"/>
    <bpmn:intermediateCatchEvent id="timerEvent_wait" name="Wait"><bpmn:timerEventDefinition id="T1"/></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="event_pause" name="Pause"><bpmn:timerEventDefinition id="T2"/></bpmn:intermediateCatchEvent>`);
  const stale = (mutation: MutationResult) => mutation.changes.warnings.filter((warning) => warning.code === 'W_ID_PREFIX_STALE');

  it('a retype keeps the id and names the `bpmn set` that follows the convention (free in the file)', async () => {
    const result = await run(EVENTS, [{ op: 'retype', id: 'serviceTask_checkInvoice', kind: 'userTask' }]);
    expect(stale(result)).toEqual([
      {
        code: 'W_ID_PREFIX_STALE',
        element: 'serviceTask_checkInvoice',
        message: 'serviceTask_checkInvoice keeps its id, whose prefix serviceTask_ is that of a serviceTask; element-id-naming (.bpmnlintrc in .) expects userTask_ for a userTask',
        hint: 'Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> serviceTask_checkInvoice id=userTask_checkInvoice2`.',
      },
    ]);
    expect(result.xml).toContain('id="serviceTask_checkInvoice"');
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
    const result = await run(shipping, [{ op: 'retype', id: 'serviceTask_shipGoods', kind: 'scriptTask' }], pascal);
    expect(stale(result)).toEqual([
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
    expect(stale(anyCase).map((warning) => warning.hint.match(/id=(\S+)`/)?.[1])).toEqual(['manualTask_checkOrder', 'manualTask_reviewIt']);
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
    expect(stale(twice).map((warning) => [warning.message, warning.hint])).toEqual([
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
    expect(stale(taken).map((warning) => warning.hint)).toEqual(['Code, tests and links that use the id keep working; to follow the convention: `bpmn set <file> serviceTask_checkInvoice id=scriptTask_checkInvoice2`.']);
  });

  it('an element the batch created is nobody\'s API yet: a retype or a trigger change gives it the new prefix, no warning', async () => {
    const start = definitionsXml('<bpmn:startEvent id="startEvent_start" name="Start"/>');
    const retyped = await run(start, [
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'startEvent_start', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ]);
    expect(stale(retyped)).toEqual([]);
    expect(retyped.changes.created.map((created) => [created.id, created.detail])).toEqual([
      ['userTask_checkInvoice', 'after startEvent_start'],
      // the flow's detail names the end by its final id too
      ['flow_startToCheckInvoice', 'startEvent_start -> userTask_checkInvoice'],
    ]);
    expect(retyped.changes.changed.map((changed) => changed.id)).toEqual(['userTask_checkInvoice']);
    expect(retyped.changes.renames).toEqual([{ from: 'serviceTask_checkInvoice', to: 'userTask_checkInvoice', regenerated: true }]);
    expect(mutationReport(retyped).renamed).toBeUndefined();
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
    expect(twice.changes.warnings.filter((warning) => warning.code === 'W_ID_SUFFIXED')).toEqual([]);
    const suffixed = await run(EVENTS, [{ op: 'add', kind: 'task', name: 'Check invoice', in: 'Process_1', as: '$t' }, { op: 'retype', id: '$t', kind: 'serviceTask' }]);
    expect(createdIds(suffixed)).toEqual(['serviceTask_checkInvoice2']);
    expect(suffixed.changes.warnings.filter((warning) => warning.code === 'W_ID_SUFFIXED').map((warning) => warning.message)).toEqual(['Id serviceTask_checkInvoice is already taken; using serviceTask_checkInvoice2']);
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
    expect(stale(explicit).map((warning) => warning.element)).toEqual(['serviceTask_mine']);
  });

  it('an op of the batch that changed the element before its retype (a new element of the new type): every entry names the final id', async () => {
    const start = definitionsXml('<bpmn:startEvent id="startEvent_start" name="Start"/>');
    const changes: EditCommand[] = [
      { op: 'set', id: '$t', values: { doc: 'Reviews the invoice' } },
      { op: 'set', id: '$t', values: { name: 'Check bill' } },
      { op: 'move', ids: ['$t'], in: 'Process_1' },
    ];
    for (const change of changes) {
      const result = await run(start, [{ op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'startEvent_start', as: '$t' }, change, { op: 'retype', id: '$t', kind: 'userTask' }]);
      const ids = new Set([...result.xml.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]));
      expect([...result.changes.created, ...result.changes.changed].map((entry) => entry.id).filter((id) => !ids.has(id)), change.op).toEqual([]);
      expect(result.changes.changed.map((changed) => changed.id), change.op).toContain('userTask_checkInvoice');
      const summary = mutationSummary(mutationReport(result));
      expect(summary.changed.filter((id) => !ids.has(id)), change.op).toEqual([]);
    }
  });

  it('the flows the batch named after such an element follow its new id: a prefix without separator, flows named by the ends\' ids, a suffix that no longer applies, a message flow', async () => {
    const glued = declared({ case: 'PascalCase', prefixes: { 'bpmn:ServiceTask': 'ST', 'bpmn:UserTask': 'UT', 'bpmn:SendTask': 'SN', 'bpmn:ReceiveTask': 'RT', 'bpmn:SequenceFlow': 'SF' } });
    const start = definitionsXml('<bpmn:startEvent id="startEvent_Go" name="Go"/>');
    const result = await run(start.replace('</bpmn:process>', '<bpmn:task id="Activity_Legacy" name="Legacy"/></bpmn:process>'), [
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'startEvent_Go', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ], glued);
    expect(result.changes.created.map((created) => [created.id, created.detail])).toEqual([['UTCheck', 'after startEvent_Go'], ['SFGoToUTCheck', 'startEvent_Go -> UTCheck']]);
    expect(result.changes.renames).toEqual([
      { from: 'STCheck', to: 'UTCheck', regenerated: true },
      { from: 'SFGoToSTCheck', to: 'SFGoToUTCheck', was: 'startEvent_Go -> STCheck', regenerated: true },
    ]);
    // it names its ends, so a later write renames it after its new ones
    const later = await run(result.xml, [{ op: 'add', kind: 'task', name: 'Prepare', flow: 'SFGoToUTCheck' }], glued);
    expect(later.changes.renames).toEqual([expect.objectContaining({ from: 'SFGoToUTCheck', to: 'SFGoToPrepare' })]);
    // a later op of the batch that names the flow's old id learns why it is gone
    await expect(run(start, [
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'startEvent_Go', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
      { op: 'set', id: 'SFGoToSTCheck', values: { name: 'x' } },
    ], glued)).rejects.toThrow('No element with id "SFGoToSTCheck": an op before this one renamed it to SFGoToUTCheck (its id named its old ends)');
    // a message flow, with its own default prefix
    const pools = `<bpmn:collaboration id="collaboration_main"><bpmn:participant id="participant_a" name="A" processRef="Process_1"/><bpmn:participant id="participant_b" name="B" processRef="Process_2"/></bpmn:collaboration>
  <bpmn:process id="Process_2"><bpmn:receiveTask id="RTGet" name="Get"/></bpmn:process>`;
    const message = await run(definitionsXml('<bpmn:startEvent id="startEvent_Go" name="Go"/>', { extraRoots: pools }), [
      { op: 'add', kind: 'serviceTask', name: 'Ask', after: 'startEvent_Go', as: '$t' },
      { op: 'connect', source: '$t', target: 'RTGet' },
      { op: 'retype', id: '$t', kind: 'sendTask' },
    ], glued);
    expect(createdIds(message)).toEqual(['SNAsk', 'SFGoToSNAsk', 'messageFlow_SNAskToRTGet']);
    // flows named by their ends' ids (idPair) are no form of bpmn-cli's: the spliced one keeps its id, the new one is named
    const idPair = definitionsXml(`
    <bpmn:task id="task_b" name="B"><bpmn:outgoing>flow_task_b_endEvent_done</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_task_b_endEvent_done</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_task_b_endEvent_done" sourceRef="task_b" targetRef="endEvent_done"/>`);
    const pair = await run(idPair, [
      { op: 'add', kind: 'serviceTask', name: 'Check', after: 'task_b' },
      { op: 'retype', id: 'serviceTask_check', kind: 'userTask' },
    ], declared({ case: 'any' }));
    expect(createdIds(pair)).toEqual(['userTask_check', 'flow_checkToDone']);
    expect(mutationReport(pair).renamed).toBeUndefined();
    // the suffix of the old id (serviceTask_check2) is not the new one's: the flow loses it too
    const twice = await run(definitionsXml(''), [
      { op: 'add', kind: 'serviceTask', name: 'Check', in: 'Process_1', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Check', after: '$a' },
      { op: 'retype', id: 'serviceTask_check2', kind: 'userTask' },
    ]);
    expect(twice.changes.created.map((created) => [created.id, created.detail])).toEqual([
      ['serviceTask_check', 'in Process_1'],
      ['userTask_check', 'after serviceTask_check'],
      ['flow_checkToCheck', 'serviceTask_check -> userTask_check'],
    ]);
    expect(twice.changes.warnings).toEqual([]);
  });

  it('a split\'s join is generated too: a retype in the batch gives it the new prefix, the notes name the final ids', async () => {
    const gateways = declared({ prefixes: { 'bpmn:ExclusiveGateway': 'xor_', 'bpmn:ParallelGateway': 'and_' } });
    const result = await run(definitionsXml('<bpmn:startEvent id="startEvent_go" name="Go"/>'), [
      { op: 'split', after: 'startEvent_go', kind: 'xor', name: 'Ok?', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }] },
      { op: 'retype', id: 'xor_ok', kind: 'and' },
      { op: 'retype', id: 'xor_okJoin', kind: 'and' },
    ], gateways);
    expect(createdIds(result)).toEqual(expect.arrayContaining(['and_ok', 'and_okJoin']));
    expect(stale(result)).toEqual([]);
    expect(result.changes.notes).toContain('split and_ok: 2 branch(es) ending at task_a, task_b, joined at and_okJoin');
    // an explicit joinId is the caller's
    const explicit = await run(definitionsXml('<bpmn:startEvent id="startEvent_go" name="Go"/>'), [
      { op: 'split', after: 'startEvent_go', kind: 'xor', name: 'Ok?', joinId: 'xor_mine', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }] },
      { op: 'retype', id: 'xor_mine', kind: 'and' },
    ], gateways);
    expect(stale(explicit).map((warning) => warning.element)).toEqual(['xor_mine']);
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
      const result = await run(existing, [
        { op: 'add', kind: 'serviceTask', name: 'Check', in: 'Process_1' },
        { op: 'remove', ids: ['serviceTask_check'] },
        claim,
        { op: 'retype', id: 'serviceTask_check', kind: 'userTask' },
      ]);
      expect(result.xml, claim.op).toContain('<bpmn:userTask id="serviceTask_check"');
      expect(stale(result).map((warning) => warning.element), claim.op).toEqual(['serviceTask_check']);
    }
  });
});

describe('bpmn show --conventions (the view)', () => {
  it('groups the patterns by source; a pattern of one kind reads as it is; the qualified prefixes in one line', async () => {
    const view = conventionsView(await Doc.fromXml(PASCAL), BARE, { file: 'x.bpmn', severity: 'warn' });
    expect(view).toMatchObject({ file: 'x.bpmn', exists: true, source: '.bpmnlintrc in .', rule: { severity: 'warn', case: 'camelCase', qualifier: 'optional' }, qualified: { mode: 'optional', examples: ['timerStartEvent_', 'messageEvent_', 'errorEndEvent_'] } });
    const row = (kind: string) => view.rows.find((conventionRow) => conventionRow.kinds.includes(kind));
    expect(row('serviceTask')).toEqual({ pattern: '<kind>_{name:camel}', source: 'lint', kinds: ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask', 'subProcess', 'callActivity', 'startEvent', 'endEvent', 'participant', 'lane', 'dataObject', 'dataStore', 'textAnnotation', 'group', 'collaboration'] });
    // what the rule does not check takes bpmn-cli's own prefix, whatever the file's ids; a named process its name alone
    expect(row('process')).toEqual({ pattern: '{name:camel}', source: 'bpmn-cli', kinds: ['process'], note: 'not checked; unnamed: Process_1' });
    expect(row('message')).toEqual({ pattern: 'message_{name:camel}', source: 'bpmn-cli', kinds: ['message'], note: 'not checked' });
    expect(row('sequenceFlow')).toEqual({ pattern: 'flow_{source}To{target}', source: 'lint', kinds: ['sequenceFlow'] });
    expect(row('messageFlow')).toEqual({ pattern: 'messageFlow_{source}To{target}', source: 'lint', kinds: ['messageFlow'] });

    const text = renderConventions(view);
    expect(text.split('\n').slice(0, 2)).toEqual(['conventions of x.bpmn', 'element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional']);
    expect(text).toContain('  events with a trigger: <trigger><Prefix> (timerStartEvent_, messageEvent_, errorEndEvent_) also accepted, new ids take the plain prefix');
    expect(text.split('\n')).toContain("sources: lint = element-id-naming; bpmn-cli = bpmn-cli's own prefix for a type element-id-naming does not check");
    // required: the qualified prefix is the one new ids take
    expect(renderConventions(conventionsView(undefined, REQUIRED))).toContain('required, new ids take it');
  });

  it('the flow rows join the ends in the declared case: To, _to_ under snake_case, -to- under kebab-case', () => {
    for (const [config, join] of [[{}, 'To'], [{ case: 'snake_case' }, '_to_'], [{ case: 'kebab-case' }, '-to-']] as const) {
      const rows = conventionsView(undefined, declared(config)).rows;
      expect(rows.filter((row) => row.kinds.includes('sequenceFlow') || row.kinds.includes('messageFlow')).map((row) => row.pattern), join).toEqual([`flow_{source}${join}{target}`, `messageFlow_{source}${join}{target}`]);
    }
  });

  it('a new file, and no conventions declared: the defaults of element-id-naming', async () => {
    const fresh = await conventionsXml(undefined, { conventions: BARE, file: 'new.bpmn' });
    expect(fresh.exists).toBe(false);
    expect(fresh.rows.find((conventionRow) => conventionRow.kinds.includes('lane'))).toMatchObject({ pattern: '<kind>_{name:camel}', source: 'lint' });
    expect(fresh.rows.find((conventionRow) => conventionRow.kinds.includes('process'))).toMatchObject({ pattern: '{name:camel}', source: 'bpmn-cli' });
    expect(renderConventions(fresh).split('\n')[0]).toBe('conventions of new.bpmn (no file yet: a new model)');
    const none = await conventionsXml(PASCAL);
    expect(none.rule).toBeUndefined();
    expect(none.qualified).toEqual({ mode: 'optional', examples: ['timerStartEvent_', 'messageEvent_', 'errorEndEvent_'] });
    expect(none.rows.find((conventionRow) => conventionRow.kinds.includes('serviceTask'))).toMatchObject({ pattern: '<kind>_{name:camel}', source: 'default' });
    expect(none.rows.find((conventionRow) => conventionRow.kinds.includes('process'))).toMatchObject({ pattern: '{name:camel}', source: 'bpmn-cli' });
    const lines = renderConventions(none).split('\n');
    expect(lines[1]).toBe("no id conventions declared: new ids follow element-id-naming's defaults (case camelCase)");
    expect(lines).toContain('  events with a trigger: <trigger><Prefix> (timerStartEvent_, messageEvent_, errorEndEvent_) also accepted, new ids take the plain prefix');
    expect(lines).toContain("sources: default = element-id-naming's defaults (nothing declared); bpmn-cli = bpmn-cli's own prefix for a type element-id-naming does not check");
  });

  it('says why none are declared; W_LINT_UNAVAILABLE among the notes', async () => {
    const doc = await Doc.fromXml(PASCAL);
    const line = (opts: Parameters<typeof conventionsView>[2], conventions?: IdConventions) => renderConventions(conventionsView(doc, conventions, opts)).split('\n')[1];
    expect(line({ undeclared: 'skipped' })).toBe("no id conventions: --no-lint-config leaves the .bpmnlintrc out; new ids follow element-id-naming's defaults (case camelCase)");
    expect(line({ undeclared: 'no config' })).toBe("no id conventions: no .bpmnlintrc applies here; new ids follow element-id-naming's defaults (case camelCase)");
    expect(line({ undeclared: 'off', where: '.bpmnlintrc in models' })).toBe("no id conventions: element-id-naming is off or not configured in the .bpmnlintrc in models; new ids follow element-id-naming's defaults (case camelCase)");
    const notes = [{ severity: 'warning' as const, code: 'W_LINT_UNAVAILABLE', message: '.bpmnlintrc is not JSON', hint: 'Write it as strict JSON.' }];
    const broken = conventionsView(doc, undefined, { undeclared: 'not loaded', where: '.bpmnlintrc in .', notes });
    expect(broken).toMatchObject({ source: '.bpmnlintrc in .', undeclared: 'not loaded', notes });
    expect(renderConventions(broken).split('\n')).toEqual(expect.arrayContaining([
      "no id conventions: the .bpmnlintrc in . could not be loaded (W_LINT_UNAVAILABLE below); new ids follow element-id-naming's defaults (case camelCase)",
      'warning W_LINT_UNAVAILABLE: .bpmnlintrc is not JSON  (Write it as strict JSON.)',
    ]));
    // declared: no reason
    expect(conventionsView(doc, BARE, { undeclared: 'off' }).undeclared).toBeUndefined();
  });

  it('a type the rule checks with a prefix new ids cannot follow is marked so, not `not checked`', async () => {
    const view = conventionsView(await Doc.fromXml(PASCAL), declared({ prefixes: { 'bpmn:UserTask': 'user task_', 'bpmn:Gateway': 'a gate_' } }));
    const row = (kind: string) => view.rows.find((conventionRow) => conventionRow.kinds.includes(kind));
    expect(row('userTask')).toEqual({ pattern: '<kind>_{name:camel}', source: 'bpmn-cli', kinds: ['userTask', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'complexGateway', 'eventBasedGateway'], note: 'checked; prefix ignored (W_CONFIG_IGNORED)' });
    expect(row('message')?.note).toBe('not checked');
    // under required, the triggers whose qualified prefix is too long for new ids: they take the plain prefix
    const long = conventionsView(undefined, declared({ case: 'snake_case', eventDefinitionQualifier: 'required', prefixes: { 'bpmn:EndEvent': 'endEventWithAVeryLongPrefixThatIsFiftyCharactersX_' } }));
    expect(long.rows.find((conventionRow) => conventionRow.kinds.includes('endEvent'))).toEqual({
      pattern: 'endEventWithAVeryLongPrefixThatIsFiftyCharactersX_{name:snake}',
      source: 'lint',
      kinds: ['endEvent'],
      note: 'message, escalation, terminate, compensate: qualified prefix ignored, new ids take the plain one (W_CONFIG_IGNORED)',
    });
    expect(renderConventions(long)).toContain(') required, new ids take it (not the triggers marked above)');
  });
});
