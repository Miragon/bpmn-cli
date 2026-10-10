/**
 * Step 3, the verifier's id findings: flows at unnamed gateways name them by
 * their own speaking ids, no context chains, a length cap, transliteration
 * beyond German, speaking definitions ids of `new`. Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { cutAt, MAX_ID, transliterate } from '../src/ids.js';
import { runOps } from '../src/ops/index.js';
import { definitionsXml, flowBetween } from './helpers.js';

const ids = (xml: string): string[] => [...xml.matchAll(/<bpmn:\w+ id="([^"]+)"/g)].map((m) => m[1]!);
const flowIds = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((m) => m[1]!);
/** a flow id with a side that is only a word for a kind (Flow_GatewayToJoin, Flow_CheckToGateway, Flow_TaskToTask) */
const GENERIC_SIDE = /(^Flow_|To)(Gateway|Join|Task|Timer|Catch)(To|$|_\d+$)/;

/** The verifier's batch: an exclusive split after Check, a parallel split after Fix, every gateway unnamed. */
const NESTED_SPLITS: unknown[] = [
  { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Gw', as: '$s' },
  { op: 'add', kind: 'task', name: 'Check', after: '$s', as: '$c' },
  { op: 'split', after: '$c', kind: 'exclusiveGateway', branches: [{ flowName: 'yes', condition: '${a}', nodes: [{ kind: 'task', name: 'Fix' }] }, { flowName: 'no', default: true, nodes: [] }] },
  { op: 'split', after: 'Activity_Fix', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [] }] },
];

describe('flows at unnamed gateways name them by their speaking ids', () => {
  it('distinct, readable flow ids without collision suffixes (AfterCheck, CheckJoin)', async () => {
    const r = await applyToXml((await newXml({ processName: 'Gw' })).xml, NESTED_SPLITS);
    const flows = flowIds(r.xml);
    expect(flows.sort()).toEqual(
      [
        'Flow_StartToCheck',
        'Flow_CheckToAfterCheck',
        'Flow_AfterCheckToFix',
        'Flow_AfterCheckToCheckJoin',
        'Flow_FixToAfterFix',
        'Flow_AfterFixToA',
        'Flow_AfterFixToFixJoin',
        'Flow_AToFixJoin',
        'Flow_FixJoinToCheckJoin',
      ].sort(),
    );
    for (const id of flows) expect(id).not.toMatch(GENERIC_SIDE);
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
    expect(new Set(ids(r.xml)).size).toBe(ids(r.xml).length);
  });

  it('unnamed gateways and tasks in a row: the nearest named anchor once, the kind spelled out before a suffix', async () => {
    const base = await newXml({ processName: 'Row' });
    const start = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Row', as: '$s' },
      { op: 'add', kind: 'task', name: 'Check', after: '$s', as: '$c' },
    ];
    const run = async (ops: unknown[]): Promise<{ aliases: Record<string, string>; flows: string[]; suffixed: number }> => {
      const r = await applyToXml(base.xml, [...start, ...ops], { layout: false });
      return { aliases: r.result.aliases ?? {}, flows: flowIds(r.xml).sort(), suffixed: r.result.warnings.added.filter((w) => w.code === 'W_ID_SUFFIXED').length };
    };
    // an exclusive and a parallel gateway in a row, then an end event
    const gw = await run([
      { op: 'add', kind: 'exclusiveGateway', after: '$c', as: '$g' },
      { op: 'add', kind: 'parallelGateway', after: '$g', as: '$h' },
      { op: 'add', kind: 'endEvent', after: '$h', as: '$e' },
    ]);
    expect(gw.aliases).toMatchObject({ $g: 'Gateway_AfterCheck', $h: 'Gateway_ParallelAfterCheck', $e: 'Event_EndAfterCheck' });
    expect(gw.flows).toEqual(['Flow_AfterCheckToParallelAfterCheck', 'Flow_CheckToAfterCheck', 'Flow_ParallelAfterCheckToEndAfterCheck', 'Flow_StartToCheck']);
    expect(gw.suffixed).toBe(0);
    // an unnamed task after the unnamed gateway: its body would be the gateway's (Flow_AfterCheckToAfterCheck), so it says its kind
    const tasks = await run([
      { op: 'add', kind: 'exclusiveGateway', after: '$c', as: '$g' },
      { op: 'add', kind: 'serviceTask', after: '$g', as: '$u' },
      { op: 'add', kind: 'serviceTask', after: '$u', as: '$v' },
    ]);
    expect(tasks.aliases).toMatchObject({ $g: 'Gateway_AfterCheck', $u: 'Activity_ServiceTaskAfterCheck', $v: 'Activity_AfterCheck' });
    expect(tasks.flows).toContain('Flow_AfterCheckToServiceTaskAfterCheck');
    expect(tasks.suffixed).toBe(0);
    // a split right after an unnamed split: no suffix, the flows of each split and join apart
    const splits = await run([
      { op: 'split', after: '$c', kind: 'exclusiveGateway', as: '$g', branches: [{ nodes: [{ kind: 'task', name: 'X' }] }, { nodes: [] }] },
      { op: 'split', after: '$g', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'Y' }] }, { nodes: [] }] },
    ]);
    expect(splits.suffixed).toBe(0);
    expect(splits.flows).toEqual(expect.arrayContaining(['Flow_AfterCheckToParallelAfterCheck', 'Flow_ParallelAfterCheckToY', 'Flow_YToParallelAfterCheckJoin']));
    for (const id of [...Object.values(gw.aliases), ...gw.flows, ...Object.values(tasks.aliases), ...tasks.flows, ...splits.flows]) expect(id).not.toMatch(/AfterAfter|_\d+$/);
  });

  it('a flow renamed after its new ends uses the same rule; one named by an earlier version (Flow_CheckToGateway) still follows its ends', async () => {
    const xml = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToCheck</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_Check" name="Check"><bpmn:incoming>Flow_StartToCheck</bpmn:incoming><bpmn:outgoing>Flow_CheckToGateway</bpmn:outgoing></bpmn:task>
    <bpmn:parallelGateway id="Gateway_AfterCheck"><bpmn:incoming>Flow_CheckToGateway</bpmn:incoming><bpmn:outgoing>Flow_GatewayToShip</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:task id="Activity_Ship" name="Ship"><bpmn:incoming>Flow_GatewayToShip</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_StartToCheck" sourceRef="Event_Start" targetRef="Activity_Check" />
    <bpmn:sequenceFlow id="Flow_CheckToGateway" sourceRef="Activity_Check" targetRef="Gateway_AfterCheck" />
    <bpmn:sequenceFlow id="Flow_GatewayToShip" sourceRef="Gateway_AfterCheck" targetRef="Activity_Ship" />`);
    // a no-op keeps every id
    const noop = await applyToXml(xml, [{ op: 'set', id: 'Activity_Ship', values: { name: 'Ship' } }], { layout: false });
    expect(noop.unchanged).toBe(true);
    // a splice renames the old flow after its new ends, by the current rule
    const doc = await Doc.fromXml(xml);
    const cs = runOps(doc, [{ op: 'add', kind: 'task', name: 'Pack', flow: 'Flow_GatewayToShip' }]);
    expect(flowBetween(doc, 'Gateway_AfterCheck', 'Activity_Pack')).toBe('Flow_AfterCheckToPack');
    expect(cs.renames).toEqual([expect.objectContaining({ from: 'Flow_GatewayToShip', to: 'Flow_AfterCheckToPack' })]);
    expect(flowBetween(doc, 'Activity_Check', 'Gateway_AfterCheck')).toBe('Flow_CheckToGateway');
  });
});

describe('id quality: context once, length cap, transliteration', () => {
  it('an unnamed element after an unnamed one is placed after the nearest named anchor, once (no AfterAfter chains)', async () => {
    const base = await newXml({ processName: 'Tricky' });
    const r = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Tricky', as: '$s' },
      { op: 'add', kind: 'userTask', name: '4-Augen-Prinzip: prüfen & freigeben (2. Stufe)?', after: '$s', as: '$q' },
      { op: 'add', kind: 'serviceTask', name: '审批 订单', after: '$q', as: '$c' },
      { op: 'add', kind: 'task', name: '✓✓✓', after: '$c', as: '$d' },
      { op: 'add', kind: 'exclusiveGateway', after: '$d', as: '$g' },
      { op: 'add', kind: 'endEvent', after: '$g', as: '$e' },
    ]);
    const all = ids(r.xml);
    for (const id of all) expect(id).not.toMatch(/AfterAfter|BeforeBefore/);
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
    expect(r.result.aliases).toMatchObject({
      $q: 'Activity_4AugenPrinzipPruefenFreigeben2Stufe',
      $c: 'Activity_After4AugenPrinzipPruefenFreigeben2Stufe',
      // two unnamed tasks after the same named anchor: the second spells out its kind (no suffix; the body is cut at 40 characters)
      $d: 'Activity_TaskAfter4AugenPrinzipPruefenFreigeben2',
      $g: 'Gateway_After4AugenPrinzipPruefenFreigeben2',
      // a body of more than 40 characters is cut at a word boundary
      $e: 'Event_EndAfter4AugenPrinzipPruefenFreigeben2',
    });
  });

  it('a name without letters names nothing: no numbered id', async () => {
    const base = await newXml({ processName: 'Digits' });
    const r = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Digits', as: '$s' },
      { op: 'add', kind: 'task', name: '123', after: '$s', as: '$t' },
    ]);
    expect(r.result.aliases?.['$t']).toBe('Activity_AfterStart');
  });

  it('generated ids are at most 64 characters, cut at a word boundary, the same every time', async () => {
    const ops = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Long', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Prüfen ob die eingereichten Unterlagen vollständig und fristgerecht vorliegen', after: '$s', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Benachrichtigung über den Bearbeitungsstand an alle beteiligten Stellen versenden', after: '$a', as: '$b' },
      { op: 'add', kind: 'boundaryEvent:message', on: '$b', message: 'Rückmeldung der beteiligten Stellen zum Bearbeitungsstand eingegangen' },
    ];
    const base = await newXml({ processName: 'Long' });
    const r = await applyToXml(base.xml, ops);
    for (const id of ids(r.xml)) expect(id.length).toBeLessThanOrEqual(MAX_ID);
    expect(r.result.aliases).toMatchObject({ $a: 'Activity_PruefenObDieEingereichtenUnterlagen', $b: 'Activity_BenachrichtigungUeberDen' });
    // a flow's two ends share the room
    expect(flowIds(r.xml)).toContain('Flow_PruefenObDieEingereichtenToBenachrichtigungUeberDen');
    expect((await applyToXml(base.xml, ops)).xml).toBe(r.xml);
    expect(cutAt('Flow_CheckInvoiceToBookInvoice', 23)).toBe('Flow_CheckInvoiceToBook');
    expect(cutAt('Flow_CheckInvoiceToBookInvoice', 22)).toBe('Flow_CheckInvoiceTo');
    expect(cutAt('check_invoice_and_book_it', 15)).toBe('check_invoice');
    expect(cutAt('Abcdefghijklmnopqrstuvwxyz', 10)).toBe('Abcdefghij');
  });

  it('a long flow a file got before the cap still follows its ends', async () => {
    const a = 'serviceTask_checkTheIncomingDocumentsForCompleteness';
    const b = 'serviceTask_archiveTheDocumentsInTheLongTermStorage';
    const c = 'serviceTask_notifyTheApplicant';
    const long = 'flow_checkTheIncomingDocumentsForCompletenessToArchiveTheDocumentsInTheLongTermStorage';
    const xml = definitionsXml(`
    <bpmn:serviceTask id="${a}" name="Check the incoming documents for completeness"><bpmn:outgoing>${long}</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${b}" name="Archive the documents in the long term storage"><bpmn:incoming>${long}</bpmn:incoming><bpmn:outgoing>flow_archiveTheDocumentsInTheLongTermStorageToNotifyTheApplicant</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${c}" name="Notify the applicant"><bpmn:incoming>flow_archiveTheDocumentsInTheLongTermStorageToNotifyTheApplicant</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="${long}" sourceRef="${a}" targetRef="${b}" />
    <bpmn:sequenceFlow id="flow_archiveTheDocumentsInTheLongTermStorageToNotifyTheApplicant" sourceRef="${b}" targetRef="${c}" />`);
    const doc = await Doc.fromXml(xml);
    runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Scan', after: a }]);
    const renamed = flowBetween(doc, a, 'serviceTask_scan');
    expect(renamed).not.toBe(long);
    expect(renamed.length).toBeLessThanOrEqual(MAX_ID);
    expect(renamed).toMatch(/^flow_checkTheIncoming\w*ToScan$/);
  });

  it('transliterates beyond German: Nordic letters spelled out, other accents dropped', async () => {
    expect(transliterate('Øre Åse Æble')).toBe('Oere Aase Aeble');
    expect(transliterate('ØRE')).toBe('OERE');
    expect(transliterate('Œuvre Łódź Þing')).toBe('Oeuvre Lodz Thing');
    const base = await newXml({ processName: 'Nordic' });
    const r = await applyToXml(base.xml, [{ op: 'add', kind: 'task', name: 'Ünïcödé Çàfé Øre', in: 'Process_Nordic', as: '$t' }]);
    expect(r.result.aliases?.['$t']).toBe('Activity_UenicoedeCafeOere');
  });
});

describe('bpmn new: a speaking definitions id', () => {
  it('Definitions_<Name> with --name, Definitions_<stem> with a speaking --id, the tool defaults without either', async () => {
    const defsId = (xml: string): string => /<bpmn:definitions[^>]* id="([^"]+)"/.exec(xml)![1]!;
    expect(defsId((await newXml({ processName: 'Order to cash', target: 'camunda8' })).xml)).toBe('Definitions_OrderToCash');
    expect(defsId((await newXml({ processId: 'Process_Billing' })).xml)).toBe('Definitions_Billing');
    expect(defsId((await newXml({})).xml)).toBe('Definitions_1');
  });
});
