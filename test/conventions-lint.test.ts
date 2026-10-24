/**
 * Declared id conventions (issue #34): the ids bpmn-cli generates under
 * @miragon/rules/element-id-naming pass that rule, linted with the real
 * bpmnlint and @miragon/bpmnlint-plugin-rules (the ones the node layer
 * loads), in a new file and in files of other styles; and
 * idConventionsFromLint reads the rule's options as the rule does
 * (src/ids/conventions.ts).
 */
import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import type { BpmnlintRuleSetting } from '../src/validate/bpmnlint-validator.js';
import { idConventionsFromLint, ID_NAMING_RULE, type IdConventions } from '../src/ids/conventions.js';
import { Doc } from '../src/model/Doc.js';
import { bpmnlintEngine } from '../src/node/bpmnlint.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline/index.js';

const engine = bpmnlintEngine();
const naming = engine.plugin.naming;

/** The findings of element-id-naming with `setting` on `xml` (the real rule). */
async function lint(xml: string, setting: BpmnlintRuleSetting): Promise<Array<{ id: string; message: string }>> {
  const { rootElement } = await new BpmnModdle().fromXML(xml);
  const value = setting.config === undefined ? [setting.severity] : [setting.severity, setting.config];
  const linter = new engine.Linter({ config: { rules: { [ID_NAMING_RULE]: value } }, resolver: engine.resolver });
  return Object.values(await linter.lint(rootElement)).flat() as Array<{ id: string; message: string }>;
}

const conventionsOf = (setting: BpmnlintRuleSetting): IdConventions | undefined => idConventionsFromLint(setting, naming, { source: '.bpmnlintrc in .' }).conventions;

const LONG = 'Prüfe ob die eingegangene Lieferantenrechnung vollständig und sachlich richtig ist und gebucht werden kann';

/** One batch that asks for every kind and trigger: named, unnamed, a number first, long, repeated names, a split with branch nodes, pools, lanes, data, a message flow. */
function everyKind(processId: string): Op[] {
  const ops: unknown[] = [
    { op: 'add', kind: 'startEvent', name: 'Invoice received', as: '$s' },
    { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$s', as: '$t1' },
    { op: 'add', kind: 'userTask', name: 'Check invoice', after: '$t1', as: '$t2' },
    { op: 'add', kind: 'userTask', name: 'Check invoice', after: '$t2', as: '$t3' },
    { op: 'add', kind: 'scriptTask', name: '4 Augen Prinzip', after: '$t3', as: '$t4' },
    { op: 'add', kind: 'sendTask', name: LONG, after: '$t4', as: '$t5' },
    { op: 'add', kind: 'receiveTask', name: 'Wait for reply', after: '$t5', as: '$t6' },
    { op: 'add', kind: 'manualTask', name: 'File paper copy', after: '$t6', as: '$t7' },
    { op: 'add', kind: 'businessRuleTask', name: 'Decide approver', after: '$t7', as: '$t8' },
    { op: 'add', kind: 'task', name: 'Plain task', after: '$t8', as: '$t9' },
    { op: 'add', kind: 'callActivity', name: 'Call archive', after: '$t9', as: '$t10' },
    { op: 'add', kind: 'subProcess', name: 'Handle details', after: '$t10', as: '$sp' },
    { op: 'add', kind: 'startEvent', in: '$sp', as: '$sps' },
    { op: 'add', kind: 'task', after: '$sps', as: '$spt' },
    { op: 'add', kind: 'endEvent', after: '$spt' },
    { op: 'add', kind: 'adHocSubProcess', name: 'Collect documents', after: '$sp', as: '$ah' },
    { op: 'add', kind: 'transaction', name: 'Book payment', after: '$ah', as: '$tx' },
    { op: 'add', kind: 'startEvent', in: '$tx', as: '$txs' },
    { op: 'add', kind: 'endEvent:cancel', name: 'Booking cancelled', after: '$txs' },
    { op: 'add', kind: 'boundaryEvent:cancel', name: 'Cancelled', on: '$tx' },
    { op: 'add', kind: 'xor', name: 'Approved?', after: '$tx', as: '$g' },
    { op: 'add', kind: 'xor', after: '$g', as: '$g2' },
    { op: 'add', kind: 'and', after: '$g2', as: '$g3' },
    { op: 'add', kind: 'or', name: 'Which channels?', after: '$g3', as: '$g4' },
    { op: 'add', kind: 'eventBased', name: 'Wait', after: '$g4', as: '$eg' },
    { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Payment received', after: '$eg', message: 'PaymentReceived', as: '$c1' },
    { op: 'add', kind: 'intermediateCatchEvent:timer', name: '2 days', after: '$eg', timer: 'P2D', as: '$c2' },
    { op: 'add', kind: 'intermediateCatchEvent:signal', name: 'Stop signal', after: '$eg', signal: 'Stop', as: '$c3' },
    { op: 'add', kind: 'intermediateCatchEvent:conditional', name: 'Limit reached', after: '$eg', when: '${limit}', as: '$c4' },
    { op: 'add', kind: 'intermediateThrowEvent', name: 'Milestone', after: '$c1', as: '$th1' },
    { op: 'add', kind: 'intermediateThrowEvent:message', name: 'Notify customer', after: '$th1', as: '$th2' },
    { op: 'add', kind: 'intermediateThrowEvent:signal', name: 'Broadcast', after: '$th2', signal: 'Bcast', as: '$th3' },
    { op: 'add', kind: 'intermediateThrowEvent:escalation', name: 'Escalate', after: '$th3', escalation: 'Esc', as: '$th4' },
    { op: 'add', kind: 'intermediateThrowEvent:compensate', name: 'Undo', after: '$th4', as: '$th6' },
    { op: 'add', kind: 'intermediateThrowEvent:link', name: 'Go on', after: '$th6', link: 'L1', as: '$th5' },
    { op: 'add', kind: 'intermediateCatchEvent:link', name: 'Go on there', link: 'L1', in: processId, as: '$lc' },
    { op: 'add', kind: 'endEvent', name: 'Done', in: processId },
    { op: 'add', kind: 'endEvent:message', name: 'Reply sent', after: '$c2' },
    { op: 'add', kind: 'endEvent:error', name: 'Failed', after: '$c3', error: 'Failed' },
    { op: 'add', kind: 'endEvent:signal', name: 'Signal end', after: '$c4', signal: 'End' },
    { op: 'add', kind: 'endEvent:escalation', name: 'Escalated', after: '$lc', escalation: 'Esc2' },
    { op: 'add', kind: 'endEvent:terminate', name: 'Terminated', after: '$g' },
    { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', on: '$t2', timer: 'P2D' },
    { op: 'add', kind: 'boundaryEvent:message', name: 'Reminder', on: '$t3', message: 'Reminder' },
    { op: 'add', kind: 'boundaryEvent:error', name: 'Script failed', on: '$t4', error: 'ScriptFailed' },
    { op: 'add', kind: 'boundaryEvent:signal', on: '$t5', signal: 'S2' },
    { op: 'add', kind: 'boundaryEvent:escalation', name: 'Escalation caught', on: '$t6', escalation: 'Esc3' },
    { op: 'add', kind: 'boundaryEvent:conditional', name: 'Changed', on: '$t7', when: '${changed}' },
    { op: 'add', kind: 'boundaryEvent:compensate', name: 'Compensate', on: '$t8' },
    { op: 'add', kind: 'eventSubProcess:error', name: 'Handle errors', in: processId, error: 'AnyError' },
    { op: 'add', kind: 'eventSubProcess:timer', name: 'Remind', in: processId, timer: 'R/P1D', nonInterrupting: true },
    { op: 'add', kind: 'eventSubProcess:message', name: '5 minute warning', in: processId, message: 'CancelRequest' },
    { op: 'add', kind: 'startEvent:message', name: 'Order placed', in: processId, message: 'OrderPlaced' },
    { op: 'add', kind: 'startEvent:timer', name: '1st of month', in: processId, timer: 'R/P1M' },
    { op: 'add', kind: 'startEvent:signal', name: 'Signal start', in: processId, signal: 'S4' },
    { op: 'add', kind: 'startEvent:conditional', name: 'Condition start', in: processId, when: '${y}' },
    { op: 'split', after: '$t9', kind: 'and', branches: [{ nodes: [{ kind: 'task', name: 'Branch one' }] }, { nodes: [{ kind: 'userTask', name: 'Branch one' }, { kind: 'task', name: '3 checks' }] }, { nodes: [] }] },
    { op: 'split', after: '$t10', branches: [{ nodes: [{ kind: 'task' }] }, { nodes: [{ kind: 'task' }] }] },
    { op: 'add', kind: 'dataObject', name: 'Invoice', in: processId },
    { op: 'add', kind: 'dataStore', name: 'Archive', in: processId },
    { op: 'add', kind: 'textAnnotation', text: 'Check the amount', in: processId },
    { op: 'add', kind: 'participant', name: 'Billing' },
    { op: 'add', kind: 'participant', name: 'Customer', as: '$cust' },
    { op: 'add', kind: 'lane', name: 'Accounting', in: processId },
    { op: 'connect', source: '$th2', target: '$cust' },
    // a taken id whose body ends in a digit: the collision number after the word No under camelCase / PascalCase
    { op: 'add', kind: 'serviceTask', name: 'Step 1', in: processId, as: '$n1' },
    { op: 'add', kind: 'serviceTask', name: 'Step 1', in: processId, as: '$n2' },
    { op: 'add', kind: 'serviceTask', name: 'Step 12', in: processId },
    { op: 'connect', source: '$n1', target: '$n2' },
    { op: 'connect', source: '$n1', target: '$n2' },
  ];
  return ops as Op[];
}

const SETTINGS: Array<[string, BpmnlintRuleSetting]> = [
  ['the bare flag (DEFAULT_PREFIXES, camelCase, optional)', { severity: 'warn', config: {} }],
  ['["warn"] (no options)', { severity: 'warn', config: undefined }],
  ['PascalCase with Flow_, ScriptTask off', { severity: 'error', config: { prefixes: { 'bpmn:SequenceFlow': 'Flow_', 'bpmn:ScriptTask': false }, case: 'PascalCase' } }],
  ['snake_case, qualifier required', { severity: 'error', config: { case: 'snake_case', eventDefinitionQualifier: 'required' } }],
  ['exact Participant / Lane / Message / MessageFlow / Process / DataObjectReference / Definitions prefixes, required', { severity: 'error', config: { eventDefinitionQualifier: 'required', prefixes: { 'bpmn:Participant': 'pool_', 'bpmn:Lane': 'lane_', 'bpmn:Message': 'message_', 'bpmn:MessageFlow': 'messageFlow_', 'bpmn:Process': 'process_', 'bpmn:DataObjectReference': 'dataObject_', 'bpmn:Definitions': 'definitions_', 'bpmn:DataStore': 'store_' } } }],
  ['prefixes without separator, PascalCase, qualifier off', { severity: 'error', config: { case: 'PascalCase', eventDefinitionQualifier: 'off', prefixes: { 'bpmn:UserTask': 'UT', 'bpmn:Gateway': 'Gw', 'bpmn:SequenceFlow': 'SF' } } }],
  ['camelCase prefixes without separator', { severity: 'warn', config: { prefixes: { 'bpmn:Task': 'task', 'bpmn:SequenceFlow': 'flow', 'bpmn:Gateway': 'gw' } } }],
  ['case any', { severity: 'warn', config: { case: 'any' } }],
];

describe('the ids of a new file pass element-id-naming (the real rule)', () => {
  for (const [name, setting] of SETTINGS) {
    it(name, async () => {
      const conventions = conventionsOf(setting);
      expect(conventions).toBeDefined();
      const doc = Doc.create({ processName: 'Invoice handling', conventions }, 'invoice-handling.bpmn');
      const processId = doc.processes()[0]!.get<string>('id');
      const result = await mutateDoc(doc, everyKind(processId), { layout: false, conventions, force: true });
      expect(result.changes.created.length).toBeGreaterThan(100);
      expect(await lint(result.xml, setting)).toEqual([]);
    });
  }

  it('a taken id whose body ends in a digit passes it with the word No before the number: serviceTask_step1No2, ServiceTask_Phase2No2', async () => {
    const cases: Array<[BpmnlintRuleSetting, string, string[]]> = [
      [{ severity: 'warn', config: {} }, 'Step 1', ['serviceTask_step1', 'serviceTask_step1No2', 'serviceTask_step1No3', 'flow_step1ToStep1No2', 'flow_step1ToStep1No2No2']],
      [{ severity: 'warn', config: { case: 'PascalCase', prefixes: { 'bpmn:ServiceTask': 'ServiceTask_', 'bpmn:SequenceFlow': 'Flow_' } } }, 'Phase 2', ['ServiceTask_Phase2', 'ServiceTask_Phase2No2', 'ServiceTask_Phase2No3', 'Flow_Phase2ToPhase2No2', 'Flow_Phase2ToPhase2No2No2']],
    ];
    for (const [setting, name, ids] of cases) {
      const conventions = conventionsOf(setting);
      const doc = Doc.create({ processName: 'Steps', conventions });
      const processId = doc.processes()[0]!.get<string>('id');
      const ops = [
        { op: 'add', kind: 'serviceTask', name, in: processId, as: '$a' },
        { op: 'add', kind: 'serviceTask', name, in: processId, as: '$b' },
        { op: 'add', kind: 'serviceTask', name, in: processId },
        { op: 'connect', source: '$a', target: '$b' },
        { op: 'connect', source: '$a', target: '$b' },
      ] as unknown as Op[];
      const result = await mutateDoc(doc, ops, { layout: false, conventions });
      expect(result.changes.created.map((c) => c.id)).toEqual(ids);
      expect(await lint(result.xml, setting)).toEqual([]);
    }
  });

  it('without declared conventions the same batch gives ids the rule reports (the control)', async () => {
    const doc = Doc.create({ processName: 'Invoice handling' }, 'invoice-handling.bpmn');
    const result = await mutateDoc(doc, everyKind('Process_InvoiceHandling'), { layout: false, force: true });
    expect((await lint(result.xml, { severity: 'warn', config: {} })).length).toBeGreaterThan(50);
  });

  it('the process and the definitions keep their ids unless a prefix names their type exactly', async () => {
    const bare = conventionsOf({ severity: 'warn', config: {} });
    const plain = Doc.create({ processName: 'Invoice handling', conventions: bare });
    expect([plain.processes()[0]!.get('id'), plain.definitions.get('id')]).toEqual(['Process_InvoiceHandling', 'Definitions_InvoiceHandling']);
    const exact = conventionsOf({ severity: 'warn', config: { prefixes: { 'bpmn:Process': 'process_', 'bpmn:Definitions': 'definitions_' } } });
    const named = Doc.create({ processName: 'Invoice handling', conventions: exact });
    expect([named.processes()[0]!.get('id'), named.definitions.get('id')]).toEqual(['process_invoiceHandling', 'definitions_invoiceHandling']);
    // without a name: a word for the kind (Process_1 would fail the prefix); the definitions say Main too
    const unnamed = Doc.create({ conventions: exact });
    expect([unnamed.processes()[0]!.get('id'), unnamed.definitions.get('id')]).toEqual(['process_main', 'definitions_main']);
    expect(Doc.create({ conventions: conventionsOf({ severity: 'warn', config: { prefixes: { 'bpmn:Definitions': 'defs_' } } }) }).definitions.get('id')).toBe('defs_main');
    expect(Doc.create({ conventions: bare }).processes()[0]!.get('id')).toBe('Process_1');
    expect(Doc.create({ conventions: bare }).definitions.get('id')).toBe('Definitions_1');
  });
});

/* ------------------------------------------------------------------ */
/* files of other styles                                                */
/* ------------------------------------------------------------------ */

const wrap = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x"><bpmn:process id="P" isExecutable="true">${body}</bpmn:process></bpmn:definitions>`;

/** start -> two tasks -> gateway -> end in a style, the first and the last task. */
const FILES: Record<string, [string, string, string]> = {
  'Camunda Modeler hashes': [
    wrap(`<bpmn:startEvent id="StartEvent_1"/><bpmn:task id="Activity_0abc123" name="Check invoice"/><bpmn:task id="Activity_1def456" name="Book"/><bpmn:exclusiveGateway id="Gateway_0k3j2h1" name="Ok?"/><bpmn:endEvent id="Event_0z9x8c7"/>
<bpmn:sequenceFlow id="Flow_0q1w2e3" sourceRef="StartEvent_1" targetRef="Activity_0abc123"/><bpmn:sequenceFlow id="Flow_1r4t5y6" sourceRef="Activity_0abc123" targetRef="Activity_1def456"/><bpmn:sequenceFlow id="Flow_2u7i8o9" sourceRef="Activity_1def456" targetRef="Gateway_0k3j2h1"/><bpmn:sequenceFlow id="Flow_3p0a1s2" sourceRef="Gateway_0k3j2h1" targetRef="Event_0z9x8c7"/>`),
    'Activity_0abc123',
    'Activity_1def456',
  ],
  'speaking PascalCase': [
    wrap(`<bpmn:startEvent id="Event_Start" name="Start"/><bpmn:task id="Activity_CheckInvoice" name="Check invoice"/><bpmn:task id="Activity_Book" name="Book"/><bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"/><bpmn:endEvent id="Event_Done" name="Done"/>
<bpmn:sequenceFlow id="Flow_StartToCheckInvoice" sourceRef="Event_Start" targetRef="Activity_CheckInvoice"/><bpmn:sequenceFlow id="Flow_CheckInvoiceToBook" sourceRef="Activity_CheckInvoice" targetRef="Activity_Book"/><bpmn:sequenceFlow id="Flow_BookToOk" sourceRef="Activity_Book" targetRef="Gateway_Ok"/><bpmn:sequenceFlow id="Flow_OkToDone" sourceRef="Gateway_Ok" targetRef="Event_Done"/>`),
    'Activity_CheckInvoice',
    'Activity_Book',
  ],
  snake: [
    wrap(`<bpmn:startEvent id="start_event_start" name="Start"/><bpmn:task id="task_check_invoice" name="Check invoice"/><bpmn:task id="task_book" name="Book"/><bpmn:exclusiveGateway id="gateway_ok" name="Ok?"/><bpmn:endEvent id="end_event_done" name="Done"/>
<bpmn:sequenceFlow id="flow_start_to_check_invoice" sourceRef="start_event_start" targetRef="task_check_invoice"/><bpmn:sequenceFlow id="flow_check_invoice_to_book" sourceRef="task_check_invoice" targetRef="task_book"/><bpmn:sequenceFlow id="flow_book_to_ok" sourceRef="task_book" targetRef="gateway_ok"/><bpmn:sequenceFlow id="flow_ok_to_done" sourceRef="gateway_ok" targetRef="end_event_done"/>`),
    'task_check_invoice',
    'task_book',
  ],
  'bare camelCase ids': [
    wrap(`<bpmn:startEvent id="start" name="Start"/><bpmn:task id="checkInvoice" name="Check invoice"/><bpmn:task id="book" name="Book"/><bpmn:exclusiveGateway id="ok" name="Ok?"/><bpmn:endEvent id="done" name="Done"/>
<bpmn:sequenceFlow id="startToCheckInvoice" sourceRef="start" targetRef="checkInvoice"/><bpmn:sequenceFlow id="checkInvoiceToBook" sourceRef="checkInvoice" targetRef="book"/><bpmn:sequenceFlow id="bookToOk" sourceRef="book" targetRef="ok"/><bpmn:sequenceFlow id="okToDone" sourceRef="ok" targetRef="done"/>`),
    'checkInvoice',
    'book',
  ],
  'idPair flows': [
    wrap(`<bpmn:startEvent id="Event_Start" name="Start"/><bpmn:task id="Activity_CheckInvoice" name="Check invoice"/><bpmn:task id="Activity_Book" name="Book"/><bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"/><bpmn:endEvent id="Event_Done" name="Done"/>
<bpmn:sequenceFlow id="Flow_Event_Start_Activity_CheckInvoice" sourceRef="Event_Start" targetRef="Activity_CheckInvoice"/><bpmn:sequenceFlow id="Flow_Activity_CheckInvoice_Activity_Book" sourceRef="Activity_CheckInvoice" targetRef="Activity_Book"/><bpmn:sequenceFlow id="Flow_Activity_Book_Gateway_Ok" sourceRef="Activity_Book" targetRef="Gateway_Ok"/><bpmn:sequenceFlow id="Flow_Gateway_Ok_Event_Done" sourceRef="Gateway_Ok" targetRef="Event_Done"/>`),
    'Activity_CheckInvoice',
    'Activity_Book',
  ],
  'scoped flows': [
    wrap(`<bpmn:startEvent id="Event_KotO_Start" name="Start"/><bpmn:task id="Activity_KotO_CheckInvoice" name="Check invoice"/><bpmn:task id="Activity_KotO_Book" name="Book"/><bpmn:exclusiveGateway id="Gateway_KotO_Ok" name="Ok?"/><bpmn:endEvent id="Event_KotO_Done" name="Done"/>
<bpmn:sequenceFlow id="Flow_KotO_StartToCheckInvoice" sourceRef="Event_KotO_Start" targetRef="Activity_KotO_CheckInvoice"/><bpmn:sequenceFlow id="Flow_KotO_CheckInvoiceToBook" sourceRef="Activity_KotO_CheckInvoice" targetRef="Activity_KotO_Book"/><bpmn:sequenceFlow id="Flow_KotO_BookToOk" sourceRef="Activity_KotO_Book" targetRef="Gateway_KotO_Ok"/><bpmn:sequenceFlow id="Flow_KotO_OkToDone" sourceRef="Gateway_KotO_Ok" targetRef="Event_KotO_Done"/>`),
    'Activity_KotO_CheckInvoice',
    'Activity_KotO_Book',
  ],
};

/** Names a hash or a slug cannot make an id of, or make one that begins with a number. */
const NAMES = ['Rechnung prüfen', "Customer's order", 'v2.0 release', '2024', 'Ölwechsel', '检查发票', 'A', 'Go / No-Go?', 'Check  invoice!!', 'ÄÖÜ Straße'];

function intoFile(first: string, last: string): Op[] {
  const ops: unknown[] = [
    { op: 'add', kind: 'serviceTask', name: 'Approve', after: first, as: '$a' },
    { op: 'add', kind: 'userTask', name: 'Check invoice', after: '$a', as: '$b' },
    { op: 'add', kind: 'task', after: '$b', as: '$c' },
    { op: 'add', kind: 'xor', after: '$c', as: '$g' },
    { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', on: '$b', timer: 'P2D' },
    { op: 'add', kind: 'boundaryEvent:error', on: '$a', error: 'E1' },
    { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Paid', after: '$g', message: 'Paid', as: '$m' },
    { op: 'add', kind: 'intermediateThrowEvent', after: '$m', as: '$th' },
    { op: 'add', kind: 'endEvent:terminate', after: '$th' },
    { op: 'split', after: last, kind: 'xor', branches: [{ nodes: [{ kind: 'task', name: 'Branch one' }] }, { nodes: [{ kind: 'userTask', name: 'Branch one' }, { kind: 'task', name: '3 checks' }] }, { nodes: [] }] },
    { op: 'add', kind: 'startEvent:timer', name: '1st of month', in: 'P', timer: 'R/P1M' },
    ...NAMES.map((name, i) => ({ op: 'add', kind: i % 2 ? 'serviceTask' : 'task', name, in: 'P' })),
    { op: 'add', kind: 'eventSubProcess:message', name: '5 minute warning', in: 'P', message: 'W5' },
    // created, then retyped or given another trigger in the same batch: the id follows the new kind
    { op: 'add', kind: 'serviceTask', name: 'Retyped later', in: 'P', as: '$r' },
    { op: 'retype', id: '$r', kind: 'userTask' },
    { op: 'add', kind: 'intermediateCatchEvent:timer', name: 'Wait a bit', in: 'P', timer: 'P1D', as: '$w' },
    { op: 'set', id: '$w', values: { trigger: 'message', message: 'Late' } },
    { op: 'add', kind: 'startEvent', name: 'Monthly', in: 'P', as: '$ms' },
    { op: 'set', id: '$ms', values: { trigger: 'timer', timer: 'R/P1M' } },
  ];
  return ops as Op[];
}

const MATRIX: Array<[string, BpmnlintRuleSetting]> = [
  ['bare', { severity: 'warn', config: {} }],
  ['required', { severity: 'warn', config: { eventDefinitionQualifier: 'required' } }],
  ['PascalCase without separator', { severity: 'warn', config: { case: 'PascalCase', prefixes: { 'bpmn:ServiceTask': 'ST', 'bpmn:SequenceFlow': 'SF', 'bpmn:Gateway': 'GW', 'bpmn:Task': 'T' } } }],
  ['snake_case with flow-', { severity: 'warn', config: { case: 'snake_case', prefixes: { 'bpmn:SequenceFlow': 'flow-' } } }],
  ['catch / throw / xor, parallel off', { severity: 'warn', config: { eventDefinitionQualifier: 'required', prefixes: { 'bpmn:IntermediateCatchEvent': 'catch_', 'bpmn:IntermediateThrowEvent': 'throw_', 'bpmn:ExclusiveGateway': 'xor_', 'bpmn:ParallelGateway': false } } }],
  ['sequence flows off', { severity: 'warn', config: { prefixes: { 'bpmn:SequenceFlow': false } } }],
  ['an unknown case (the rule checks PascalCase)', { severity: 'warn', config: { case: 'camelcase' } }],
  ['PascalCase with Start_ / End_', { severity: 'warn', config: { case: 'PascalCase', prefixes: { 'bpmn:StartEvent': 'Start_', 'bpmn:EndEvent': 'End_' } } }],
];

describe('in files of other styles, every id a change generates passes element-id-naming', () => {
  for (const [setting, value] of MATRIX) {
    it(setting, async () => {
      const conventions = conventionsOf(value);
      for (const [style, [xml, first, last]] of Object.entries(FILES)) {
        const doc = await Doc.fromXml(xml, 'x.bpmn');
        const result = await mutateDoc(doc, intoFile(first, last), { layout: false, conventions, force: true });
        const made = new Set([...result.changes.created.map((c) => c.id), ...result.changes.renames.map((r) => r.to)]);
        expect(made.size, style).toBeGreaterThan(25);
        const findings = (await lint(result.xml, value)).filter((f) => made.has(f.id));
        expect(findings, style).toEqual([]);
      }
    });
  }

  it('the join after an explicit split id in another case, and the ids a retype or a trigger change gives what the batch created, pass it too', async () => {
    const branches = [{ nodes: [{ kind: 'task', name: 'Yes' }] }, { nodes: [{ kind: 'task', name: 'No' }] }];
    const split = (id?: string): Op => ({ op: 'split', after: 'start', kind: 'xor', ...(id ? { id } : {}), name: 'Approved?', branches }) as Op;
    // [config, ops, retype the split's gateways to `and` in the same batch]
    const cases: Array<[Record<string, unknown>, Op[], boolean?]> = [];
    for (const id of ['gateway_Approved', 'gateway_approved_check', 'gateway_ok-1', 'Gateway_Check']) cases.push([{}, [split(id)]]);
    for (const id of ['gateway_approved', 'gateway_ok-1']) cases.push([{ case: 'PascalCase' }, [split(id)]]);
    for (const id of ['gateway_Approved', 'gateway_okCheck']) cases.push([{ case: 'snake_case' }, [split(id)]]);
    cases.push([{ prefixes: { 'bpmn:Gateway': 'gw' } }, [split('gwApproved')]]);
    const retyped = [
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: 'start', as: '$t' },
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$t', as: '$u' },
      { op: 'retype', id: '$u', kind: 'userTask' },
      { op: 'add', kind: 'intermediateCatchEvent:timer', name: 'Two days', after: 'start', timer: 'P2D', as: '$e' },
      { op: 'set', id: '$e', values: { trigger: 'message', message: 'Reply' } },
      { op: 'add', kind: 'scriptTask', name: 'Run', in: 'P', as: '$r' },
      { op: 'retype', id: '$r', kind: 'serviceTask' },
    ] as Op[];
    for (const config of [
      { case: 'PascalCase', prefixes: { 'bpmn:ServiceTask': 'ST', 'bpmn:UserTask': 'UT', 'bpmn:SequenceFlow': 'SF', 'bpmn:Gateway': 'Gw' } },
      { case: 'snake_case', eventDefinitionQualifier: 'required', prefixes: { 'bpmn:ScriptTask': false } },
      { prefixes: { 'bpmn:ExclusiveGateway': 'xor_', 'bpmn:ParallelGateway': 'and_' } },
    ]) {
      cases.push([config, retyped], [config, [split()], true]);
    }
    const fresh = () => Doc.fromXml(wrap('<bpmn:startEvent id="start" name="Start"/>'), 'x.bpmn');
    for (const [config, ops, gateways] of cases) {
      const setting: BpmnlintRuleSetting = { severity: 'warn', config };
      const conventions = conventionsOf(setting);
      let result = await mutateDoc(await fresh(), ops, { layout: false, conventions, force: true });
      if (gateways) {
        const ids = result.changes.created.filter((c) => c.kind === 'exclusiveGateway').map((c) => c.id);
        expect(ids).toHaveLength(2);
        result = await mutateDoc(await fresh(), [...ops, ...ids.map((id) => ({ op: 'retype', id, kind: 'and' }) as Op)], { layout: false, conventions, force: true });
      }
      const made = new Set([...result.changes.created.map((c) => c.id), ...result.changes.renames.map((r) => r.to)]);
      const explicit = ops.map((o) => (o as { id?: string }).id);
      const findings = (await lint(result.xml, setting)).filter((f) => made.has(f.id) && !explicit.includes(f.id));
      expect(findings, JSON.stringify([config, ops[0]])).toEqual([]);
      expect(result.changes.warnings.filter((w) => w.code === 'W_ID_PREFIX_STALE'), JSON.stringify(config)).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* the options, read as the rule reads them                             */
/* ------------------------------------------------------------------ */

describe('idConventionsFromLint', () => {
  it('builds the prefix table over every concrete bpmn: type and the qualified prefix of each event kind and trigger', () => {
    const bare = conventionsOf({ severity: 'warn', config: {} })!;
    const plain = Object.keys(bare.prefixes).filter((k) => k.split(':').length === 2);
    const qualified = Object.keys(bare.prefixes).filter((k) => k.split(':').length === 3);
    // every task and sub-process, every gateway (complex too), every event, sequence flows
    expect(plain.length).toBe(23);
    expect(bare.prefixes).toMatchObject({
      'bpmn:ServiceTask': 'serviceTask_',
      'bpmn:AdHocSubProcess': 'subProcess_',
      'bpmn:Transaction': 'subProcess_',
      'bpmn:ComplexGateway': 'gateway_',
      'bpmn:BoundaryEvent': 'event_',
      'bpmn:SequenceFlow': 'flow_',
      'bpmn:StartEvent:timer': 'timerStartEvent_',
      'bpmn:BoundaryEvent:message': 'messageEvent_',
      'bpmn:EndEvent:cancel': 'cancelEndEvent_',
    });
    expect(qualified.length).toBe(32);
    for (const type of ['bpmn:Process', 'bpmn:Definitions', 'bpmn:Lane', 'bpmn:Participant', 'bpmn:MessageFlow', 'bpmn:Message']) expect(bare.prefixes[type], type).toBeUndefined();
    expect(bare).toMatchObject({ case: 'camelCase', qualifier: 'optional', source: '.bpmnlintrc in .' });
    // the qualifier off: no qualified prefixes; case any: none declared
    const off = conventionsOf({ severity: 'error', config: { eventDefinitionQualifier: 'off', case: 'any' } })!;
    expect(Object.keys(off.prefixes).filter((k) => k.split(':').length === 3)).toEqual([]);
    expect(off.case).toBeUndefined();
    // false switches a type off (no fallback either), an exact entry names any type
    const exact = conventionsOf({ severity: 'warn', config: { prefixes: { 'bpmn:ScriptTask': false, 'bpmn:DataStore': 'store_', 'bpmn:Definitions': 'definitions_' } } })!;
    expect(exact.prefixes['bpmn:ScriptTask']).toBeUndefined();
    expect(exact.prefixes['bpmn:DataStore']).toBe('store_');
    expect(exact.prefixes['bpmn:Definitions']).toBe('definitions_');
  });

  it('declares nothing for the severity off, no setting, or every prefix off', () => {
    expect(idConventionsFromLint(undefined, naming)).toEqual({ notes: [] });
    expect(idConventionsFromLint({ severity: 'off', config: { case: 'nonsense' } }, naming)).toEqual({ notes: [] });
    const all = Object.fromEntries(Object.keys(naming.DEFAULT_PREFIXES).map((k) => [k, false]));
    expect(idConventionsFromLint({ severity: 'warn', config: { prefixes: all } }, naming).conventions).toBeUndefined();
  });

  it('a prefix new ids cannot start with is left out with one W_CONFIG_IGNORED naming the .bpmnlintrc, the key and the value', () => {
    const { conventions, notes } = idConventionsFromLint({ severity: 'warn', config: { prefixes: { 'bpmn:UserTask': 'user task_', 'bpmn:Gateway': '1_', 'bpmn:ServiceTask': true, 'bpmn:SendTask': 'x'.repeat(57), 'bpmn:Task': 'svc:' } } }, naming, { source: '.bpmnlintrc in models' });
    for (const type of ['bpmn:UserTask', 'bpmn:ExclusiveGateway', 'bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:Task']) expect(conventions!.prefixes[type], type).toBeUndefined();
    expect(conventions!.prefixes['bpmn:ScriptTask']).toBe('scriptTask_');
    // the concrete types the rule still checks with them (show --conventions marks them)
    expect(conventions!.ignored).toEqual(expect.arrayContaining(['bpmn:UserTask', 'bpmn:ExclusiveGateway', 'bpmn:ComplexGateway', 'bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:Task']));
    // one note per configured type (every gateway falls back to bpmn:Gateway)
    expect(notes.map((n) => n.code)).toEqual(Array(5).fill('W_CONFIG_IGNORED'));
    expect(notes[0]).toMatchObject({
      severity: 'warning',
      message: ".bpmnlintrc in models: @miragon/rules/element-id-naming prefix of bpmn:UserTask \"user task_\" cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters): new ids of the type follow the learned id style, and the rule reports them",
      hint: 'Fix the prefix in the .bpmnlintrc, or set it to false to switch bpmn:UserTask off.',
    });
    expect(notes.map((n) => n.message.split(' "')[0])).toContain('.bpmnlintrc in models: @miragon/rules/element-id-naming prefix of bpmn:Gateway');
  });

  it('a prefix declared for a DI type is one W_CONFIG_IGNORED each: DI ids follow their element, and the rule reports the new ones', async () => {
    const setting: BpmnlintRuleSetting = { severity: 'warn', config: { prefixes: { 'bpmndi:BPMNShape': 'shape_', 'bpmndi:BPMNEdge': 'edge_', 'bpmndi:BPMNPlane': false, 'bpmndi:BPMNDiagram': null } } };
    const { conventions, notes } = idConventionsFromLint(setting, naming, { source: '.bpmnlintrc in models' });
    const message = (type: string, prefix: string): string => `.bpmnlintrc in models: @miragon/rules/element-id-naming prefix of ${type} "${prefix}" is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids`;
    expect(notes.map((n) => [n.code, n.message, n.hint])).toEqual([
      ['W_CONFIG_IGNORED', message('bpmndi:BPMNShape', 'shape_'), 'Set it to false or remove it; bpmn-js names DI <id>_di too.'],
      ['W_CONFIG_IGNORED', message('bpmndi:BPMNEdge', 'edge_'), 'Set it to false or remove it; bpmn-js names DI <id>_di too.'],
    ]);
    // the element types are declared as before; the DI types are in no table
    expect(conventions).toEqual({ ...conventionsOf({ severity: 'warn', config: {} })!, source: '.bpmnlintrc in models' });
    expect(Object.keys(conventions!.prefixes).filter((k) => k.startsWith('bpmndi:'))).toEqual([]);
    // the rule checks DI ids indeed: the DI bpmn-cli writes for a new element is reported
    const doc = Doc.create({ conventions });
    const r = await mutateDoc(doc, [{ op: 'add', kind: 'startEvent', name: 'Order received', in: 'Process_1' }] as Op[], { conventions });
    expect((await lint(r.xml, setting)).map((f) => f.id)).toEqual(['BPMNShape_startEvent_orderReceived']);
    expect(idConventionsFromLint({ severity: 'warn', config: { prefixes: { 'bpmndi:BPMNShape': false } } }, naming).notes).toEqual([]);
    // only the DI types bpmn-cli writes ids for: not BPMNLabel (written without an id, which the rule skips), nor a key
    // that names no type (as for an unknown bpmn: key); a plane's prefix is one
    const others = idConventionsFromLint({ severity: 'warn', config: { prefixes: { 'bpmndi:BPMNLabel': 'label_', 'bpmndi:Nope': 'x_', 'bpmn:Nope': 'y_', 'bpmndi:BPMNPlane': 'plane_' } } }, naming, { source: '.bpmnlintrc in models' }).notes;
    expect(others.map((n) => n.message)).toEqual([message('bpmndi:BPMNPlane', 'plane_')]);
  });

  it('an unknown case or qualifier is one note naming the fallback the rule applies', () => {
    const { conventions, notes } = idConventionsFromLint({ severity: 'warn', config: { case: 'camelcase', eventDefinitionQualifier: 'requried' } }, naming);
    expect(conventions).toMatchObject({ case: 'PascalCase', qualifier: 'optional' });
    expect(notes.map((n) => [n.message, n.hint])).toEqual([
      ['.bpmnlintrc: @miragon/rules/element-id-naming case "camelcase" is unknown: the rule checks PascalCase, and new ids take it', 'Write one of camelCase, PascalCase, snake_case, any in the .bpmnlintrc. Did you mean camelCase?'],
      ['.bpmnlintrc: @miragon/rules/element-id-naming eventDefinitionQualifier "requried" is unknown: the rule and new ids take optional', 'Write one of off, optional, required in the .bpmnlintrc. Did you mean required?'],
    ]);
    // the hint's guess: any case, - or _, a prefix, a small typo; nothing for a value that means something else
    const hint = (config: Record<string, string>) => idConventionsFromLint({ severity: 'warn', config }, naming).notes[0]?.hint;
    expect(hint({ case: 'pascal' })).toContain('Did you mean PascalCase?');
    expect(hint({ case: 'snake-case' })).toContain('Did you mean snake_case?');
    expect(hint({ eventDefinitionQualifier: 'opt' })).toContain('Did you mean optional?');
    expect(hint({ eventDefinitionQualifier: 'on' })).toBe('Write one of off, optional, required in the .bpmnlintrc.');
    expect(hint({ eventDefinitionQualifier: '' })).toBe('Write one of off, optional, required in the .bpmnlintrc.');
    // the rule's own spellings give no note; ["warn"] and the bare flag are its defaults
    for (const config of [undefined, {}, { case: 'snake_case', eventDefinitionQualifier: 'off' }]) expect(idConventionsFromLint({ severity: 'warn', config }, naming).notes).toEqual([]);
  });

  it('says why a value is ignored: a case named like a property of JavaScript\'s Object (unknown like any other; a plugin before 0.12.1 cannot check it), a prefix outside ASCII', async () => {
    const { conventions, notes } = idConventionsFromLint({ severity: 'warn', config: { case: 'toString', prefixes: { 'bpmn:UserTask': 'prüfung_' } } }, naming);
    expect(conventions).toMatchObject({ case: 'PascalCase', ignored: ['bpmn:UserTask'] });
    expect(notes.map((n) => n.message)).toEqual([
      '.bpmnlintrc: @miragon/rules/element-id-naming case "toString" is unknown: the rule checks PascalCase, and new ids take it',
      '.bpmnlintrc: @miragon/rules/element-id-naming prefix of bpmn:UserTask "prüfung_" has a character outside ASCII, which bpmn-cli does not write in ids: new ids of the type follow the learned id style, and the rule reports them',
    ]);
    expect(conventionsOf({ severity: 'warn', config: { case: 'constructor' } })?.case).toBe('PascalCase');
    // the rule checks PascalCase there (since @miragon/bpmnlint-plugin-rules 0.12.1; 0.12.0 could not: it reported
    // <userTask_undefined> for an id without the prefix and threw on the first id with it), for __proto__ too
    const ids = wrap('<bpmn:userTask id="userTask_checkInvoice"/><bpmn:userTask id="userTask_CheckInvoice"/>');
    for (const name of ['toString', '__proto__']) {
      expect((await lint(ids, { severity: 'warn', config: { case: name } })).map((f) => [f.id, f.message])).toEqual([['userTask_checkInvoice', 'Element id must match the naming convention <userTask_PascalCase>']]);
      expect(idConventionsFromLint({ severity: 'warn', config: { case: name } }, naming).notes.map((n) => n.message)).toEqual([`.bpmnlintrc: @miragon/rules/element-id-naming case "${name}" is unknown: the rule checks PascalCase, and new ids take it`]);
    }
    // injected helpers of a plugin before 0.12.1 answer such a name with Object.prototype's property (a function, or
    // Object.prototype itself), which has no label: new ids take the fallback, and the note says that rule cannot check it
    const older = { ...naming, resolveCase: (c: string) => (({}) as Record<string, unknown>)[c] as ReturnType<typeof naming.resolveCase> ?? naming.resolveCase(c) };
    for (const name of ['toString', '__proto__']) {
      const old = idConventionsFromLint({ severity: 'warn', config: { case: name } }, older);
      expect(old.conventions?.case).toBe('PascalCase');
      expect(old.notes.map((n) => n.message)).toEqual([`.bpmnlintrc: @miragon/rules/element-id-naming case "${name}" is unknown, and the rule of a @miragon/bpmnlint-plugin-rules before 0.12.1 cannot check it: new ids take PascalCase, the fallback for an unknown case`]);
    }
    expect(idConventionsFromLint({ severity: 'warn', config: { case: 'snake_case' } }, older).notes).toEqual([]);
  });

  it('under required, a qualified prefix too long for new ids is one note; such events follow the learned style, no W_ID_PREFIX_STALE names the plain prefix', async () => {
    const plain = 'endEventOfTheOrderHandlingProcessInTheBackOffice_';
    const setting: BpmnlintRuleSetting = { severity: 'warn', config: { eventDefinitionQualifier: 'required', prefixes: { 'bpmn:EndEvent': plain } } };
    const { conventions, notes } = idConventionsFromLint(setting, naming);
    // escalation, terminate and compensate make it longer than 56 characters; error, signal and message do not
    expect(notes.map((n) => n.message.split(' "')[0])).toEqual(['escalation', 'terminate', 'compensate'].map((t) => `.bpmnlintrc: @miragon/rules/element-id-naming prefix of bpmn:EndEvent:${t}`));
    expect(notes[0]?.message).toContain('is longer than 56 characters (the bpmn:EndEvent prefix qualified with the trigger): new ids of such events follow the learned id style');
    expect(conventions!.ignored).toEqual(['bpmn:EndEvent:escalation', 'bpmn:EndEvent:terminate', 'bpmn:EndEvent:compensate']);
    expect(conventions!.prefixes['bpmn:EndEvent:error']).toBe(`error${plain.charAt(0).toUpperCase()}${plain.slice(1)}`);
    const xml = wrap(`<bpmn:startEvent id="startEvent_start" name="Start"/><bpmn:endEvent id="errorEndEventOfTheOrderHandlingProcessInTheBackOffice_fail" name="Fail"><bpmn:errorEventDefinition id="E1"/></bpmn:endEvent>`);
    const r = await mutateDoc(await Doc.fromXml(xml), [
      { op: 'add', kind: 'endEvent:escalation', name: 'Late', in: 'P', escalation: 'Late' },
      { op: 'retype', id: 'errorEndEventOfTheOrderHandlingProcessInTheBackOffice_fail', kind: 'endEvent:escalation', escalation: 'Late' },
    ] as Op[], { layout: false, conventions, force: true });
    const late = r.changes.created.find((c) => c.name === 'Late' && c.kind.startsWith('endEvent'))!.id;
    expect(late.startsWith(plain)).toBe(false);
    expect(r.conventions?.ids ?? []).not.toContain(late);
    expect(r.changes.warnings.filter((w) => w.code === 'W_ID_PREFIX_STALE')).toEqual([]);
  });
});
