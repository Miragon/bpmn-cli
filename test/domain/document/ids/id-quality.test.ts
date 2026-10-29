/**
 * The verifier's id and report findings: flows at unnamed gateways
 * name them by their own speaking ids, no context chains, a length cap (no
 * cut below it, whole words: #31), transliteration beyond German, speaking
 * definitions ids of `new`, and the warnings delta (platform findings
 * counted, group warnings, a bridge that takes the removed flow's id,
 * warnings of a batch's final state, `new` with the platform's findings).
 * Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml, validateXml } from '../../../../src/api.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { camelSlug, cutAt, cutName, idWords, isFiller, keptTail, MAX_ID, slugify, snakeSlug, transliterate } from '../../../../src/domain/document/utils/slug.js';
import { IdRegistry } from '../../../../src/domain/document/ids/IdRegistry.js';
import { connectionRequest, kindRequest } from '../../../../src/domain/document/utils/requests.js';
import { IdStyle } from '../../../../src/domain/document/ids/IdStyle.js';
import { kindByName } from '../../../../src/domain/document/Kinds.js';
import { runOps, mutationSummary, renderMutation, renderSummary } from '../../../../src/index.js';
import { definitionsXml, flowBetween } from '../../../helpers/helpers.js';

const ids = (xml: string): string[] => [...xml.matchAll(/<bpmn:\w+ id="([^"]+)"/g)].map((match) => match[1]!);
const flowIds = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((match) => match[1]!);
/** a flow id with a side that is only a word for a kind (flow_gatewayToJoin, flow_checkToGateway, flow_taskToTask) */
const GENERIC_SIDE = /(^flow_|To)(gateway|Gateway|Join|Task|Timer|Catch)(To|$|\d+$)/;

/** The verifier's batch: an exclusive split after Check, a parallel split after Fix, every gateway unnamed. */
const NESTED_SPLITS: unknown[] = [
  { op: 'add', kind: 'startEvent', name: 'Start', in: 'gw', as: '$s' },
  { op: 'add', kind: 'task', name: 'Check', after: '$s', as: '$c' },
  { op: 'split', after: '$c', kind: 'exclusiveGateway', branches: [{ flowName: 'yes', condition: '${a}', nodes: [{ kind: 'task', name: 'Fix' }] }, { flowName: 'no', default: true, nodes: [] }] },
  { op: 'split', after: 'task_fix', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [] }] },
];

describe('flows at unnamed gateways name them by their speaking ids', () => {
  it('distinct, readable flow ids without collision suffixes (AfterCheck, CheckJoin)', async () => {
    const applied = await applyToXml((await newXml({ processName: 'Gw' })).xml, NESTED_SPLITS);
    const flows = flowIds(applied.xml);
    expect(flows.sort()).toEqual(
      [
        'flow_startToCheck',
        'flow_checkToAfterCheck',
        'flow_afterCheckToFix',
        'flow_afterCheckToCheckJoin',
        'flow_fixToAfterFix',
        'flow_afterFixToA',
        'flow_afterFixToFixJoin',
        'flow_aToFixJoin',
        'flow_fixJoinToCheckJoin',
      ].sort(),
    );
    for (const id of flows) {
      expect(id).not.toMatch(GENERIC_SIDE);
    }
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    expect(new Set(ids(applied.xml)).size).toBe(ids(applied.xml).length);
  });

  it('unnamed gateways and tasks in a row: the nearest named anchor once, the kind spelled out, then the anchor named', async () => {
    const base = await newXml({ processName: 'Row' });
    const start = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'row', as: '$s' },
      { op: 'add', kind: 'task', name: 'Check', after: '$s', as: '$c' },
    ];
    const run = async (ops: unknown[]): Promise<{ aliases: Record<string, string>; flows: string[]; suffixed: number }> => {
      const applied = await applyToXml(base.xml, [...start, ...ops], { layout: false });
      return { aliases: applied.result.aliases ?? {}, flows: flowIds(applied.xml).sort(), suffixed: applied.result.warnings.added.filter((warning) => warning.code === 'W_ID_SUFFIXED').length };
    };
    // an exclusive and a parallel gateway in a row, then an end event
    const gw = await run([
      { op: 'add', kind: 'exclusiveGateway', after: '$c', as: '$g' },
      { op: 'add', kind: 'parallelGateway', after: '$g', as: '$h' },
      { op: 'add', kind: 'endEvent', after: '$h', as: '$e' },
    ]);
    expect(gw.aliases).toMatchObject({ $g: 'gateway_afterCheck', $h: 'gateway_parallelAfterCheck', $e: 'endEvent_afterCheckGateway' });
    expect(gw.flows).toEqual(['flow_afterCheckToParallelAfterCheck', 'flow_checkToAfterCheck', 'flow_parallelAfterCheckToAfterCheckGateway', 'flow_startToCheck']);
    expect(gw.suffixed).toBe(0);
    // an unnamed task after the unnamed gateway: its body would be the gateway's (flow_afterCheckToAfterCheck), and its prefix
    // says its kind, so it names its anchor's kind; the next one names its own anchor's kind after that
    const tasks = await run([
      { op: 'add', kind: 'exclusiveGateway', after: '$c', as: '$g' },
      { op: 'add', kind: 'serviceTask', after: '$g', as: '$u' },
      { op: 'add', kind: 'serviceTask', after: '$u', as: '$v' },
    ]);
    expect(tasks.aliases).toMatchObject({ $g: 'gateway_afterCheck', $u: 'serviceTask_afterCheckGateway', $v: 'serviceTask_afterCheckGatewayServiceTask' });
    expect(tasks.flows).toEqual(expect.arrayContaining(['flow_afterCheckToAfterCheckGateway', 'flow_afterCheckGatewayToAfterCheckGatewayServiceTask']));
    expect(tasks.suffixed).toBe(0);
    // a split right after an unnamed split: no suffix, the flows of each split and join apart
    const splits = await run([
      { op: 'split', after: '$c', kind: 'exclusiveGateway', as: '$g', branches: [{ nodes: [{ kind: 'task', name: 'X' }] }, { nodes: [] }] },
      { op: 'split', after: '$g', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'Y' }] }, { nodes: [] }] },
    ]);
    expect(splits.suffixed).toBe(0);
    expect(splits.flows).toEqual(expect.arrayContaining(['flow_afterCheckToParallelAfterCheck', 'flow_parallelAfterCheckToY', 'flow_yToParallelAfterCheckJoin']));
    for (const id of [...Object.values(gw.aliases), ...gw.flows, ...Object.values(tasks.aliases), ...tasks.flows, ...splits.flows]) {
      expect(id).not.toMatch(/AfterAfter|_\d+$/);
    }
  });

  it('a flow an earlier version named (Flow_GatewayToShip) keeps its id when a splice changes its ends; the new flow follows the current rule', async () => {
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
    // the old form is not the current one: the spliced flow keeps its id, the new one names its ends
    const doc = await Doc.fromXml(xml);
    const cs = runOps(doc, [{ op: 'add', kind: 'task', name: 'Pack', flow: 'Flow_GatewayToShip' }]);
    expect(flowBetween(doc, 'Gateway_AfterCheck', 'task_pack')).toBe('Flow_GatewayToShip');
    expect(cs.renames).toEqual([]);
    expect(cs.created.map((change) => change.id)).toEqual(['task_pack', 'flow_packToShip']);
    expect(flowBetween(doc, 'Activity_Check', 'Gateway_AfterCheck')).toBe('Flow_CheckToGateway');
  });
});

/** Bodies of ids without their prefix: `Task_AfterCheck` and `ExclusiveGateway_AfterCheck` share `AfterCheck`. */
const body = (id: string): string => id.slice(id.indexOf('_') + 1);
/** A flow whose two ends read alike (flow_afterCheckToAfterCheck, flow_after_checkToAfter_check). */
const SAME_ENDS = /^[A-Za-z]+_(\w+?)(?:To|_to_)(\w+)$/;
const sameEnds = (id: string): boolean => {
  const match = SAME_ENDS.exec(id);
  return !!match && match[1]!.toLowerCase() === match[2]!.toLowerCase();
};

/** A file of the older Camunda Modeler: hashed ids. */
const OLD_MODELER = definitionsXml(`
    <bpmn:startEvent id="StartEvent_1"><bpmn:outgoing>SequenceFlow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_0k3x9qa" name="Check"><bpmn:incoming>SequenceFlow_0a1b2c3</bpmn:incoming><bpmn:outgoing>SequenceFlow_1d2e3f4</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="Task_1m2n3o4" name="Book"><bpmn:incoming>SequenceFlow_1d2e3f4</bpmn:incoming><bpmn:outgoing>SequenceFlow_0g5h6i7</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:exclusiveGateway id="ExclusiveGateway_0p9q8r7" />
    <bpmn:endEvent id="EndEvent_0s1t2u3"><bpmn:incoming>SequenceFlow_0g5h6i7</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="SequenceFlow_0a1b2c3" sourceRef="StartEvent_1" targetRef="Task_0k3x9qa" />
    <bpmn:sequenceFlow id="SequenceFlow_1d2e3f4" sourceRef="Task_0k3x9qa" targetRef="Task_1m2n3o4" />
    <bpmn:sequenceFlow id="SequenceFlow_0g5h6i7" sourceRef="Task_1m2n3o4" targetRef="EndEvent_0s1t2u3" />`);

describe('unnamed elements in a row where the prefix says the kind (task_)', () => {
  const run = async (xml: string, ops: unknown[]) => {
    const applied = await applyToXml(xml, ops, { layout: false });
    const before = new Set(ids(xml));
    const fresh = ids(applied.xml).filter((id) => !before.has(id));
    return { aliases: applied.result.aliases ?? {}, fresh, flows: flowIds(applied.xml).filter((id) => !before.has(id)), suffixed: applied.result.warnings.added.filter((warning) => warning.code === 'W_ID_SUFFIXED') };
  };
  const nodes = (fresh: string[], flows: string[]): string[] => fresh.filter((id) => !flows.includes(id));

  it('a task after an unnamed gateway and the next task get bodies of their own: each names its anchor, no suffix', async () => {
    const applied = await run(OLD_MODELER, [
      { op: 'add', kind: 'exclusiveGateway', after: 'Task_0k3x9qa', as: '$g' },
      { op: 'add', kind: 'task', after: '$g', as: '$u' },
      { op: 'add', kind: 'task', after: '$u', as: '$v' },
    ]);
    // before: task_afterCheck (the gateway's body: flow_afterCheckToAfterCheck) and task_afterCheck2 with W_ID_SUFFIXED
    expect(applied.aliases).toMatchObject({ $g: 'gateway_afterCheck', $u: 'task_afterCheckGateway', $v: 'task_afterCheckGatewayTask' });
    expect(applied.flows).toEqual(expect.arrayContaining(['flow_afterCheckToAfterCheckGateway', 'flow_afterCheckGatewayToAfterCheckGatewayTask']));
    expect(applied.suffixed).toEqual([]);
    const bodies = nodes(applied.fresh, applied.flows).map(body);
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const id of applied.flows) {
      expect(sameEnds(id)).toBe(false);
    }
  });

  it('after a task whose name gives no id words', async () => {
    // a service task named in CJK and a task named with symbols: both unnamed for their ids
    const tricky = await run(OLD_MODELER, [
      { op: 'add', kind: 'serviceTask', name: '审批 订单', after: 'Task_0k3x9qa', as: '$c' },
      { op: 'add', kind: 'task', name: '✓✓✓', after: '$c', as: '$k' },
    ]);
    expect(tricky.aliases).toMatchObject({ $c: 'serviceTask_afterCheck', $k: 'task_afterCheckServiceTask' });
    expect(tricky.suffixed).toEqual([]);
  });

  it('a long anchor keeps the kind word through the length cut', async () => {
    const applied = await run(OLD_MODELER, [
      { op: 'add', kind: 'userTask', name: 'Prüfen ob die eingereichten Unterlagen vollständig und fristgerecht vorliegen', after: 'Task_0k3x9qa', as: '$l' },
      { op: 'add', kind: 'exclusiveGateway', after: '$l', as: '$g' },
      { op: 'add', kind: 'task', after: '$g', as: '$u' },
    ]);
    expect(applied.aliases['$u']).toMatch(/^task_after\w+Gateway$/);
    for (const id of applied.fresh) {
      expect(id.length).toBeLessThanOrEqual(MAX_ID);
    }
    expect(applied.suffixed).toEqual([]);
  });

  it('W_ID_SUFFIXED stays a signal: a repeated name, and two unnamed tasks that only an index could tell apart', async () => {
    // the name of a task already in the file
    const named = await run(OLD_MODELER, [
      { op: 'add', kind: 'task', name: 'Ship', after: 'Task_0k3x9qa' },
      { op: 'add', kind: 'task', name: 'Ship', after: 'Task_1m2n3o4' },
    ]);
    expect(named.fresh).toEqual(expect.arrayContaining(['task_ship', 'task_ship2']));
    expect(named.suffixed.map((suffixWarning) => suffixWarning.element)).toEqual(['task_ship2']);
    // two unnamed tasks on two branches right after the same unnamed gateway: the second one takes a suffix on the
    // form that names the gateway, never the gateway's own body (flow_afterCheckToAfterCheck)
    const branches = await run(OLD_MODELER, [{ op: 'split', after: 'Task_0k3x9qa', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task' }] }, { nodes: [{ kind: 'task' }] }] }]);
    expect(branches.fresh).toEqual(expect.arrayContaining(['task_afterCheckGateway', 'task_afterCheckGateway2']));
    expect(branches.suffixed.map((suffixWarning) => suffixWarning.element)).toEqual(['task_afterCheckGateway2']);
    for (const id of branches.flows) {
      expect(sameEnds(id)).toBe(false);
    }
  });
});

describe('id quality: context once, length cap, transliteration', () => {
  it('an unnamed element after an unnamed one is placed after the nearest named anchor, once (no AfterAfter chains)', async () => {
    const base = await newXml({ processName: 'Tricky' });
    const applied = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'tricky', as: '$s' },
      { op: 'add', kind: 'userTask', name: '4-Augen-Prinzip: prüfen & freigeben (2. Stufe)?', after: '$s', as: '$q' },
      { op: 'add', kind: 'serviceTask', name: '审批 订单', after: '$q', as: '$c' },
      { op: 'add', kind: 'task', name: '✓✓✓', after: '$c', as: '$d' },
      { op: 'add', kind: 'exclusiveGateway', after: '$d', as: '$g' },
      { op: 'add', kind: 'endEvent', after: '$g', as: '$e' },
    ]);
    const all = ids(applied.xml);
    for (const id of all) {
      expect(id).not.toMatch(/AfterAfter|BeforeBefore/);
    }
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    expect(applied.result.aliases).toMatchObject({
      // a body that would begin with a number begins with the kind word
      $q: 'userTask_userTask4AugenPrinzipPruefenFreigeben2',
      $c: 'serviceTask_afterUserTask4AugenPrinzipPruefen2',
      // two unnamed elements after the same named anchor: the second names the first one's kind (no suffix; the body is cut at 40 characters)
      $d: 'task_afterUserTask4AugenPrinzip2ServiceTask',
      $g: 'gateway_exclusiveAfterUserTask4AugenPrinzip2',
      // a body of more than 40 characters is cut at a word boundary
      $e: 'endEvent_afterUserTask4AugenPrinzip2',
    });
  });

  it('a name without letters names nothing: no numbered id', async () => {
    const base = await newXml({ processName: 'Digits' });
    const applied = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'digits', as: '$s' },
      { op: 'add', kind: 'task', name: '123', after: '$s', as: '$t' },
    ]);
    expect(applied.result.aliases?.['$t']).toBe('task_afterStart');
  });

  it('generated ids are at most 64 characters, cut at whole words, the same every time', async () => {
    const ops = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'long', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Prüfen ob die eingereichten Unterlagen vollständig und fristgerecht vorliegen', after: '$s', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Benachrichtigung über den Bearbeitungsstand an alle beteiligten Stellen versenden', after: '$a', as: '$b' },
      { op: 'add', kind: 'boundaryEvent:message', on: '$b', message: 'Rückmeldung der beteiligten Stellen zum Bearbeitungsstand eingegangen' },
    ];
    const base = await newXml({ processName: 'Long' });
    const applied = await applyToXml(base.xml, ops);
    for (const id of ids(applied.xml)) {
      expect(id.length).toBeLessThanOrEqual(MAX_ID);
    }
    // a name gives at most 40 characters of words, although serviceTask_benachrichtigungUeberDenBearbeitungsstand fits into 64,
    // and they never end on a filler word (before: serviceTask_benachrichtigungUeberDen)
    expect(applied.result.aliases).toMatchObject({ $a: 'userTask_pruefenObDieEingereichtenUnterlagen', $b: 'serviceTask_benachrichtigungUeber' });
    // a flow's two ends share the room: of the cuts with the most words the longest, the target gives up Den, not the
    // source Unterlagen (0.6 and the first cut of #31: flow_pruefenObDieEingereichtenToBenachrichtigungUeberDen)
    expect(flowIds(applied.xml)).toContain('flow_pruefenObDieEingereichtenUnterlagenToBenachrichtigungUeber');
    expect((await applyToXml(base.xml, ops)).xml).toBe(applied.xml);
    expect(cutAt('flow_checkInvoiceToBookInvoice', 23)).toBe('flow_checkInvoiceToBook');
    expect(cutAt('flow_checkInvoiceToBookInvoice', 22)).toBe('flow_checkInvoiceTo');
    expect(cutAt('check_invoice_and_book_it', 15)).toBe('check_invoice');
    expect(cutAt('Abcdefghijklmnopqrstuvwxyz', 10)).toBe('Abcdefghij');
    expect(cutAt('Activity_URLCheckAndMore', 17)).toBe('Activity_URLCheck');
    expect(cutAt('_abcdefghijklmnop', 5)).toBe('_abcd');
    // a cut keeps a letter, and a number never runs into the kept one: the next word is cut inside instead
    expect(cutAt('10Warenwirtschaftssystemabgleich10', 24)).toBe('10Warenwirtschaftssyst10');
    expect(cutAt('2URLAPIWarenwirtschaftssystemabgleich2', 37)).toBe('2URLAPIWarenwirtschaftssystemabgleic2');
    expect(cutAt('2URLAPIWarenwirtschaftssystemabgleich', 20)).toBe('2URLAPIWarenwirtscha');
    expect(cutAt('Stufe2Freigabeprozess3', 9)).toBe('Stufe2Fr3');
    // the words a cut keeps or drops (idWords: cutAt keeps whole ones), each word with the separator before it
    expect(idWords('check_invoice')).toEqual(['check', '_invoice']);
    expect(idWords('CheckInvoice2')).toEqual(['Check', 'Invoice', '2']);
    expect(idWords('URLCheck')).toEqual(['URLCheck']);
    expect(idWords('flow_pruefenToBenachrichtigung2').join('')).toBe('flow_pruefenToBenachrichtigung2');
    expect([keptTail('CheckJoin'), keptTail('Check_join_2'), keptTail('Check_2'), keptTail('2'), keptTail('Check')]).toEqual(['Join', '_join_2', '_2', '', '']);
  });

  it('a long flow a file got before the cap still follows its ends', async () => {
    const checkTask = 'serviceTask_checkTheIncomingDocumentsForCompleteness';
    const archiveTask = 'serviceTask_archiveTheDocumentsInTheLongTermStorage';
    const notifyTask = 'serviceTask_notifyTheApplicant';
    const long = 'flow_checkTheIncomingDocumentsForCompletenessToArchiveTheDocumentsInTheLongTermStorage';
    const xml = definitionsXml(`
    <bpmn:serviceTask id="${checkTask}" name="Check the incoming documents for completeness"><bpmn:outgoing>${long}</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${archiveTask}" name="Archive the documents in the long term storage"><bpmn:incoming>${long}</bpmn:incoming><bpmn:outgoing>flow_archiveTheDocumentsInTheLongTermStorageToNotifyTheApplicant</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${notifyTask}" name="Notify the applicant"><bpmn:incoming>flow_archiveTheDocumentsInTheLongTermStorageToNotifyTheApplicant</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="${long}" sourceRef="${checkTask}" targetRef="${archiveTask}" />
    <bpmn:sequenceFlow id="flow_archiveTheDocumentsInTheLongTermStorageToNotifyTheApplicant" sourceRef="${archiveTask}" targetRef="${notifyTask}" />`);
    const doc = await Doc.fromXml(xml);
    runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Scan', after: checkTask }]);
    const renamed = flowBetween(doc, checkTask, 'serviceTask_scan');
    expect(renamed).not.toBe(long);
    expect(renamed.length).toBeLessThanOrEqual(MAX_ID);
    expect(renamed).toMatch(/^flow_checkTheIncoming\w*ToScan$/);
  });

  /** The issue's model: a splice after `<word> synchronisieren` renames the flow to the end `<word> aktualisiert`. */
  async function sync(word: string) {
    const first = await applyToXml((await newXml({ processName: 'Sync' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Every minute', in: 'sync', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: `${word} synchronisieren`, after: '$s', as: '$a' },
      { op: 'add', kind: 'endEvent', name: `${word} aktualisiert`, after: '$a' },
    ]);
    return applyToXml(first.xml, [{ op: 'add', kind: 'serviceTask', name: `${word} protokollieren`, after: first.result.aliases!['$a']! }]);
  }

  it('#31: an id that fits into 64 characters is not cut (a renamed flow included)', async () => {
    const applied = await sync('Consignations');
    expect(flowIds(applied.xml)).toContain('flow_consignationsSynchronisierenToConsignationsProtokollieren');
    expect(applied.result.renamed).toEqual({ flow_consignationsSynchronisierenToConsignationsAktualisiert: 'flow_consignationsSynchronisierenToConsignationsProtokollieren' });
    expect(flowIds((await sync('Deliveriesabc')).xml)).toContain('flow_deliveriesabcSynchronisierenToDeliveriesabcProtokollieren');
    const full = 'flow_deliveriesabcdSynchronisierenToDeliveriesabcdProtokollieren';
    expect(full).toHaveLength(MAX_ID);
    expect(flowIds((await sync('Deliveriesabcd')).xml)).toContain(full);
    expect(flowIds((await sync('Shipments')).xml)).toContain('flow_shipmentsSynchronisierenToShipmentsProtokollieren');
  });

  it('#31: a camelCase flow that fits is not cut either', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`
    <bpmn:startEvent id="startEvent_everyMinute" name="Every minute"><bpmn:outgoing>flow_everyMinuteToConsignationsSynchronisieren</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="serviceTask_consignationsSynchronisieren" name="Consignations synchronisieren"><bpmn:incoming>flow_everyMinuteToConsignationsSynchronisieren</bpmn:incoming><bpmn:outgoing>flow_consignationsSynchronisierenToConsignationsAktualisiert</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_consignationsAktualisiert" name="Consignations aktualisiert"><bpmn:incoming>flow_consignationsSynchronisierenToConsignationsAktualisiert</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_everyMinuteToConsignationsSynchronisieren" sourceRef="startEvent_everyMinute" targetRef="serviceTask_consignationsSynchronisieren" />
    <bpmn:sequenceFlow id="flow_consignationsSynchronisierenToConsignationsAktualisiert" sourceRef="serviceTask_consignationsSynchronisieren" targetRef="endEvent_consignationsAktualisiert" />`),
    );
    runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Consignations protokollieren', after: 'serviceTask_consignationsSynchronisieren' }]);
    expect(flowBetween(doc, 'serviceTask_consignationsSynchronisieren', 'serviceTask_consignationsProtokollieren')).toBe('flow_consignationsSynchronisierenToConsignationsProtokollieren');
  });

  it('#31: a cut drops whole words, the longer end first; ends that begin alike keep their last word', async () => {
    // 66 characters uncut: the source, one letter longer, gives up the word the two ends share
    expect(flowIds((await sync('Deliveriesabcde')).xml)).toContain('flow_synchronisierenToDeliveriesabcdeProtokollieren');
    // 0.6: flow_lieferantenbSynchronisierenToLieferantenbeProtokollieren
    expect(flowIds((await sync('Lieferantenbestellungen')).xml)).toContain('flow_synchronisierenToLieferantenbestellungenProtokollieren');
    // the target gives up Abgleichen, then the source Lieferantenbestellungsuebersicht: Abgleichen fits again and comes back (not ...PruefenUnd)
    const flow = (labels: { sourceLabel: string; targetLabel: string }): string => IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', labels));
    expect(flow({ sourceLabel: 'Neue Lieferantenbestellungsübersicht', targetLabel: 'Zahlungseingänge prüfen und abgleichen' })).toBe('flow_neueToZahlungseingaengePruefenUndAbgleichen');
    // name pairs of 1 to 6 words (a third begin alike, some end in a number): every id within 64 characters, the
    // uncut one where it fits, else every word of it a whole word of the names (an end cut to its first words that
    // begins unlike the other has no room for its next word), and the same id every time
    const vocabulary = ['auftrag', 'pruefen', 'lieferung', 'synchronisieren', 'bestellungen', 'rechnung', 'freigeben', 'kunde', 'protokollieren', 'eingegangen', 'versenden', 'und', 'an', 'archivieren', '2', '10'];
    let seed = 31;
    const pick = (bound: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % bound;
    };
    const name = (head?: string): string => {
      const words = [head ?? vocabulary[pick(vocabulary.length - 2)]!];
      for (let remaining = pick(6); remaining > 0; remaining--) {
        words.push(vocabulary[pick(vocabulary.length)]!);
      }
      return words.join(' ');
    };
    for (let index = 0; index < 2000; index++) {
      const sourceLabel = name();
      const targetLabel = pick(3) === 0 ? name(sourceLabel.split(' ')[0]) : name();
      const req = connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel });
      const id = IdStyle.of().derivedBase(req);
      const uncut = `flow_${camelSlug(sourceLabel)}To${slugify(targetLabel)}`;
      const known = new Set([...idWords(camelSlug(sourceLabel)), ...idWords(slugify(targetLabel)), 'To'].map((word) => word.toLowerCase()));
      expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
      if (uncut.length <= MAX_ID) {
        expect(id).toBe(uncut);
      } else {
        const words = idWords(id.slice('flow_'.length));
        for (const word of words) {
          expect(known, `${word} in ${id}`).toContain(word.toLowerCase());
        }
        const [full, other] = [idWords(camelSlug(sourceLabel)), idWords(slugify(targetLabel))];
        if (full[0]!.toLowerCase() !== other[0]!.toLowerCase()) {
          const at = words.indexOf('To');
          for (const [cut, whole] of [[words.slice(0, at), full], [words.slice(at + 1), other]] as const) {
            // a number goes with the word after it (an end never ends on a number it did not end with), so does a filler
            // word (und, an: a cut never ends on one)
            let cutEnd = cut.length;
            while (cutEnd < whole.length - 1 && (/^\d+$/.test(whole[cutEnd]!) || isFiller(whole[cutEnd]!))) {
              cutEnd++;
            }
            const next = whole.slice(cut.length, cutEnd + 1).join('');
            if (cut.length < whole.length && cut.every((word, wordIndex) => word === whole[wordIndex])) {
              expect(id.length + next.length, `${next} after ${id}`).toBeGreaterThan(MAX_ID);
            }
          }
        }
      }
      expect(IdStyle.of().derivedBase(req)).toBe(id);
    }
  });

  it('#31: a word is cut inside only when no end has a word left to give up, and then in the longer end where the other fits whole', () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // one word each, 32 and 30 characters in a room of 57 (before: both cut, ...ToZahlungseingangsbestaetigunge)
    expect(flow('Lieferantenbestellungsübersicht', 'Zahlungseingangsbestätigungen')).toBe('flow_lieferantenbestellungsueberToZahlungseingangsbestaetigungen');
    // each end first gives up its second word; on a tie the source is cut
    expect(flow('Kundenstammdatenaktualisierung durchführen', 'Vertragsunterlagenarchivierung abschließen')).toBe('flow_kundenstammdatenaktualisierToVertragsunterlagenarchivierung');
    // ends that begin alike are down to their last word
    expect(flow('Bestellung Lieferantenstammdatenprotokoll', 'Bestellung Warenwirtschaftssystemabgleich')).toBe('flow_lieferantenstammdatenprotokToWarenwirtschaftssystemabgleich');
  });

  it('#31: of the cuts that fit, the one with the most words, then the most characters: a short word goes before a long one', async () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // 66 characters uncut: Aktualisieren goes, not Lieferantenbestellungen (the longer end first: flow_synchronisierenAktualisierenToRechnung)
    expect(flow('Synchronisieren aktualisieren', 'Rechnung Lieferantenbestellungen')).toBe('flow_synchronisierenToRechnungLieferantenbestellungen');
    // both keep two words: the longer pair (not flow_versendenToAbgleichenBestellungDie)
    expect(flow('Versenden Zahlungseingangsbestätigung', 'Abgleichen Bestellung die')).toBe('flow_versendenZahlungseingangsbestaetigungToAbgleichenBestellung');
    // ends named by their ids keep their words too (not flow_pruefenUebermittelnInformierenToUnd)
    expect(IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', 'task_pruefenUebermittelnInformieren', 'task_undZahlungseingangsbestaetigungKundeAn'))).toBe('flow_pruefenUebermittelnToUndZahlungseingangsbestaetigungKundeAn');
  });

  it('#31: an end never shrinks to a number, and the id never ends on one that reads like a suffix; a word between numbers is cut inside, the numbers kept', async () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // the word between two numbers stays (no 32024), so the end is cut inside it, and the other end keeps what fits
    // beside it (0.6: Flow_32024ToLieferantenbestellungsuebersichtPruefen); a source that begins with a number begins
    // with From, which is no word the end keeps instead of the number and the word after it
    expect(flow('3 Zahlungseingangsbestätigungen 2024', 'Lieferantenbestellungsübersicht prüfen')).toBe('flow_from3Zahlungseingangs2024ToLieferantenbestellungsuebersicht');
    expect(flow('Lieferantenbestellungsübersicht prüfen', '3 Zahlungseingangsbestätigungen 2024')).toBe('flow_lieferantenbestellungsuebersichtTo3Zahlungseingangsbest2024');
    expect(flow('2 Zahlungseingangsbestätigungen 2', 'Lieferantenbestellungsübersicht prüfen')).toBe('flow_from2Zahlungseingangsbes2ToLieferantenbestellungsuebersicht');
    expect(flow('10 Warenwirtschaftssystemabgleich 10', 'Warenwirtschaftssystemabgleich 100')).toBe('flow_from10Warenwirtschafts10ToWarenwirtschaftssystemabgleich100');
    // a leading number keeps the word after it (0.6: Flow_2ToVertragsunterlagenarchivierung)
    expect(flow('2 Lieferantenbestellungsübersichten', 'Vertragsunterlagenarchivierung abschließen')).toBe('flow_from2LieferantenbestellungsToVertragsunterlagenarchivierung');
    // the same through an edit
    const applied = await applyToXml((await newXml({ processName: 'Num' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'num', as: '$s' },
      { op: 'add', kind: 'task', name: '3 Zahlungseingangsbestätigungen 2024', after: '$s', as: '$a' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellungsübersicht prüfen', after: '$a' },
    ]);
    expect(flowIds(applied.xml)).toEqual(expect.arrayContaining(['flow_task2024ToLieferantenbestellungsuebersichtPruefen']));
    // a number the given-up word leaves stays where it cannot read like a collision suffix (a glued `2` here): before To;
    // so two flows that differ only by their number keep their own ids (before this fix both
    // Flow_PhaseToZahlungseingangsbestaetigungenAbgleichen, the second one with _2); at the end of the id it goes
    expect(flow('Zahlungseingangsbestätigungen', 'Lieferantenbestellungen 4 Augen ab')).toBe('flow_zahlungseingangsbestaetigungenToLieferantenbestellungen');
    expect(flow('Phase 1 Lieferantenbestellungsübersicht prüfen', 'Zahlungseingangsbestätigungen abgleichen')).toBe('flow_phase1ToZahlungseingangsbestaetigungenAbgleichen');
    expect(flow('Phase 2 Lieferantenbestellungsübersicht prüfen', 'Zahlungseingangsbestätigungen abgleichen')).toBe('flow_phase2ToZahlungseingangsbestaetigungenAbgleichen');
    expect(flow('V2 Lieferantenbestellungsübersicht', 'Zahlungseingangsbestätigungen abgleichen')).toBe('flow_v2ToZahlungseingangsbestaetigungenAbgleichen');
    expect(flow('Zahlungseingangsbestätigungen abgleichen', 'Stufe 2 Lieferantenbestellungsübersicht prüfen')).toBe('flow_zahlungseingangsbestaetigungenAbgleichenToStufe');
    const phases = await applyToXml((await newXml({ processName: 'Phase' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'phase', as: '$s' },
      { op: 'split', after: '$s', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'Phase 1 Lieferantenbestellungsübersicht prüfen', as: '$p1' }] }, { nodes: [{ kind: 'task', name: 'Phase 2 Lieferantenbestellungsübersicht prüfen', as: '$p2' }] }], joinAs: '$j' },
      { op: 'add', kind: 'task', name: 'Zahlungseingangsbestätigungen abgleichen', after: '$j', as: '$z' },
      { op: 'connect', source: '$p1', target: '$z' },
      { op: 'connect', source: '$p2', target: '$z' },
    ]);
    expect(flowIds(phases.xml)).toEqual(expect.arrayContaining(['flow_phase1ToZahlungseingangsbestaetigungenAbgleichen', 'flow_phase2ToZahlungseingangsbestaetigungenAbgleichen']));
    expect(phases.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    // where it would read like a suffix (a separated `_4` at the end of the id) it goes with the given-up word: the base
    // never reads like a suffixed id, and no suffix is skipped
    const stemSnake = IdStyle.of({ prefixes: { 'bpmn:Task': 'Task_', 'bpmn:SequenceFlow': 'Flow_' }, case: 'snake_case' });
    // before: Flow_zahlungseingangsbestaetigungen_to_lieferantenbestellungen_4, whose _4 the suffixes then skipped
    const req = connectionRequest('bpmn:SequenceFlow', 'Task_zahlungseingangsbestaetigungen', 'Task_lieferantenbestellungen_4_augen_ab');
    const base = 'Flow_zahlungseingangsbestaetigungen_to_lieferantenbestellungen';
    expect(stemSnake.derivedBase(req)).toBe(base);
    const registry = new IdRegistry();
    const given: string[] = [];
    for (let index = 0; index < 5; index++) {
      const { id } = stemSnake.next(req, registry);
      registry.claim(id);
      given.push(id.slice(base.length));
    }
    expect(given).toEqual(['', '_2', '_3', '_4', '_5']);
  });

  it('an element body the cap ends on a number skips the suffix its cut gives back', async () => {
    // an element body that the 64-character cap ends on a number skips the suffix its cut gives back: a shorter cut would
    // read as another name's id (never <prefix>_auftrag_2 for the second Auftrag 2 2, which pushed Auftrag 2 to _2_4,
    // nor <prefix>_step_kunde_2 for the second Step Kunde Kunde 2 freigeben)
    const task = kindByName('task')!;
    const long = 'orderFulfilmentProcessTaskWithAVeryLongPrefixNameForTestingXYZ';
    const repeated = async (prefix: string, names: string[]): Promise<string[]> => {
      const style = IdStyle.of({ prefixes: { 'bpmn:Task': `${prefix}_` }, case: 'snake_case' });
      const registry = new IdRegistry();
      return names.map((name) => {
        const { id } = style.next(kindRequest(task, { name }), registry);
        registry.claim(id);
        expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
        return id.slice(prefix.length);
      });
    };
    expect(await repeated(long.slice(0, 52), ['Auftrag 2 2', 'Auftrag 2 2', 'Auftrag 2 2', 'Auftrag 2', 'Auftrag'])).toEqual(['_auftrag_2_2', '_auftrag_2_3', '_auftrag_2_4', '_auftrag_2', '_auftrag']);
    expect(await repeated(long.slice(0, 45), Array(3).fill('Step Kunde Kunde 2 freigeben'))).toEqual(['_step_kunde_kunde_2', '_step_kunde_kunde_3', '_step_kunde_kunde_4']);
  });

  it('#31: a camelCase end without its first word starts as camelSlug writes it', async () => {
    const style = IdStyle.of();
    const flow = (sourceLabel: string, targetLabel: string): string => style.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    expect(flow('URL PDF versenden', 'Ship')).toBe('flow_urlPDFVersendenToShip');
    // the ends begin alike: the source gives up its first word, and the rest reads as above (not urlpdfVersenden)
    // (the target's 40 characters end before the filler word: before ...PruefenUnd)
    expect(flow('Lieferantenbestellungen URL PDF versenden', 'Lieferantenbestellungen prüfen und abschließen')).toBe('flow_urlPDFVersendenToLieferantenbestellungenPruefen');
    // also where camelSlug cut the name at 40 characters, so that the end is a run of its middle words
    expect(flow('Lieferantenbestellungen URL PDF versenden und archivieren', 'Lieferantenbestellungen prüfen und abschließen')).toBe('flow_urlPDFVersendenToLieferantenbestellungenPruefen');
  });

  it('a body keeps a letter in a small room', () => {
    // a room that ends inside a leading number: the cut starts at the first word with a letter (before: 10202422024)
    expect(cutAt('10202422024Rechnung', 11)).toBe('Rechnung');
    expect(cutAt('10202422024Rechnung', 6)).toBe('Rechnu');
    expect(cutAt('2024_100_rechnung_pruefen', 9)).toBe('rechnung');
    // a cut that keeps a letter is unchanged
    expect(cutAt('10202422024Rechnung', 12)).toBe('10202422024R');
  });

  it('#31: a cut keeps a Join and number tail and the first word before a number, the source gives up a word on a tie', async () => {
    const flow = (source: string, target: string, labels: { sourceLabel?: string; targetLabel?: string } = {}): string => IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', source, target, labels));
    // ends that begin alike: the join of a split and its number stay whole, the word before them goes
    expect(flow('Gateway_LieferantenbestellungenPruefenJoin_2', 'Activity_LieferantenbestellungenArchivierenSofort')).toBe('flow_lieferantenbestellungenJoin2ToLieferantenbestellungenSofort');
    // the Join is no word with a letter the end could keep instead of its last one: never a bare Join (before this fix:
    // flow_joinToLieferantenbestellungenBuchenUndAnDie, flow_2JoinToWarenwirtschaftssystemabgleich)
    const joined = await applyToXml((await newXml({ processName: 'J' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'j', as: '$s' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellungen prüfen', after: '$s', as: '$t' },
      { op: 'split', after: '$t', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }], joinAs: '$j' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellungen buchen lassen und melden', after: '$j' },
    ]);
    // (the target's 40 characters end before the filler word: LieferantenbestellungenBuchenLassen, before ...LassenUnd)
    expect(flowIds(joined.xml)).toContain('flow_lieferantenbestellungenJoinToLieferantenbestellungenLassen');
    expect(flow('Activity_A', 'Activity_B', { sourceLabel: '2 Lieferantenbestellungen Join', targetLabel: 'Warenwirtschaftssystemabgleich' })).toBe('flow_from2LieferantenbestellungenJoinToWarenwirtschaftssystemabg');
    // an end never shrinks to a number: its first word stays, the other end gives up its own
    expect(flow('Activity_A', 'Activity_B', { sourceLabel: 'Lieferantenbestellungsabwicklung 10', targetLabel: 'Lieferantenbestellungsabwicklung ok' })).toBe('flow_lieferantenbestellungsabwicklung10ToOk');
    // ends of 29 characters each, one word too long: the source gives it up
    expect(flow('Activity_A', 'Activity_B', { sourceLabel: 'Eingangsrechnung pruefen lassen', targetLabel: 'Lieferschein scannen und ablegen' })).toBe('flow_eingangsrechnungPruefenToLieferscheinScannenUndAblegen');
  });

  it('a cut never ends on a filler word (und, an, die): the ends of a flow and the 40 characters of a name give it up too, never the first word', async () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.of().derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // before: flow_lieferungVersendenUndToRechnungEingegangenUndZahlungPruefen
    expect(flow('Lieferung versenden und Kunde informieren', 'Rechnung eingegangen und Zahlung prüfen')).toBe('flow_lieferungVersendenUndKundeToRechnungEingegangenUndZahlung');
    // before: flow_lieferungAnKundenToRechnungAnBuchhaltungWeiterleitenUnd
    expect(flow('Lieferung an Kunden versenden', 'Rechnung an Buchhaltung weiterleiten und prüfen')).toBe('flow_lieferungAnKundenToRechnungAnBuchhaltungWeiterleiten');
    // a name that ends on one is the author's: an end that is not cut keeps it
    expect(flow('Ware prüfen und', 'Lieferantenbestellungsübersicht aktualisieren oder abschließen')).toBe('flow_warePruefenUndToLieferantenbestellungsuebersicht');
    // the 40 characters of a name (before: LieferantenbestellungVersendenUnd), also before a number tail, in every case
    expect(slugify('Lieferantenbestellung versenden und Zahlungseingang prüfen')).toBe('LieferantenbestellungVersenden');
    expect(slugify('Lieferantenbestellungen prüfen und an Buchhaltung 2')).toBe('LieferantenbestellungenPruefen2');
    expect(snakeSlug('Die Lieferantenbestellungen und Zahlungseingangsbestätigungen')).toBe('die_lieferantenbestellungen');
    // between a number and the number tail a filler word stays: it keeps them apart (before this fix a word was cut
    // inside instead: StartAfter2UndLieferantenbestellungsueb2)
    expect(slugify('Start After 2 und Lieferantenbestellungsübersicht 2')).toBe('StartAfter2Und2');
    // the first word stays, and a cut of an id (a DI id) is no name
    expect(cutName('UndLieferantenbestellungsuebersichtsseiten', 10)).toBe('Und');
    expect(cutAt('Lieferantenbestellungen_pruefen_und_buchen', 35)).toBe('Lieferantenbestellungen_pruefen_und');
    const applied = await applyToXml((await newXml({ processName: 'Filler' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'filler', as: '$s' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellung versenden und Zahlungseingang prüfen', after: '$s', as: '$t' },
    ], { layout: false });
    expect(applied.result.aliases).toMatchObject({ $t: 'task_lieferantenbestellungVersenden' });
    expect(flowIds(applied.xml)).toEqual(['flow_goToLieferantenbestellungVersenden']);
  });

  it('#31: a suffix that cuts an anchor-qualified id again keeps the anchor kind', async () => {
    // a declared task prefix of 27 characters: the form that names the gateway has 64, its suffix cuts it again
    const prefix = 'orderFulfilmentProcessTask';
    const conventions = { prefixes: { 'bpmn:Task': `${prefix}_` }, case: 'camelCase' } as const;
    const xml = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="${prefix}_checkOrder" name="Check order"><bpmn:incoming>flow_goToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="${prefix}_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="flow_goToCheckOrder" sourceRef="startEvent_go" targetRef="${prefix}_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="${prefix}_checkOrder" targetRef="${prefix}_shipOrder" />`);
    const applied = await applyToXml(
      xml,
      [
        { op: 'add', kind: 'task', name: 'Lieferung pruefen Abcdefghi', after: `${prefix}_shipOrder`, as: '$l' },
        { op: 'split', after: '$l', kind: 'exclusiveGateway', branches: [{ nodes: [{ kind: 'task', as: '$a' }] }, { nodes: [{ kind: 'task', as: '$b' }] }] },
      ],
      { layout: false, conventions },
    );
    // without the anchor's kind the 2 would read like the gateway (..._afterLieferungPruefenAbcdefghi2)
    expect(applied.result.aliases).toMatchObject({ $a: `${prefix}_afterLieferungPruefenAbcdefghiGateway`, $b: `${prefix}_afterLieferungPruefenGateway2` });
    expect(applied.result.aliases!['$a']).toHaveLength(MAX_ID);
    for (const id of ids(applied.xml)) {
      expect(id.length).toBeLessThanOrEqual(MAX_ID);
    }
    for (const id of flowIds(applied.xml)) {
      expect(sameEnds(id), id).toBe(false);
    }
  });

  it('#31: ends of any length are cut fast: only the forms that can fit are listed', async () => {
    const style = IdStyle.of({ prefixes: { 'bpmn:Task': 'Task_', 'bpmn:SequenceFlow': 'Flow_' }, case: 'snake_case' });
    // ids of 1,600 short words (4,800 characters): before, every form of each end was listed and paired (256 ms of CPU)
    const words = (prefixLetter: string): string => Array.from({ length: 1600 }, (_unused, index) => `${prefixLetter}${String.fromCharCode(97 + (index % 26))}`).join('_');
    const req = connectionRequest('bpmn:SequenceFlow', `Task_${words('a')}`, `Task_${words('b')}`);
    const times: number[] = [];
    let bases: string[] = [];
    for (let index = 0; index < 3; index++) {
      const t0 = performance.now();
      bases = style.derivedBases(req);
      times.push(performance.now() - t0);
    }
    expect(bases[0]).toBe('Flow_aa_ab_ac_ad_ae_af_ag_ah_ai_to_ba_bb_bc_bd_be_bf_bg_bh_bi_bj');
    expect(bases[0]!.length).toBeLessThanOrEqual(MAX_ID);
    expect(times.sort((first, second) => first - second)[1]).toBeLessThan(100);
  });

  it('#31: a collision suffix fits into 64 characters: the ends are cut again at whole words, and the flow follows its ends', async () => {
    const applied = await applyToXml((await newXml({ processName: 'Sync' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'sync', as: '$s' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Deliveriesabcd synchronisieren', after: '$s', as: '$g' },
      { op: 'add', kind: 'serviceTask', name: 'Deliveriesabcd protokollieren', after: '$g', as: '$t' },
      { op: 'connect', source: '$g', target: '$t', as: '$f' },
    ]);
    const suffixed = applied.result.aliases!['$f']!;
    expect(suffixed).toBe('flow_synchronisierenToDeliveriesabcdProtokollieren2');
    expect(applied.result.warnings.added.find((warning) => warning.code === 'W_ID_SUFFIXED')?.message).toBe(`Id flow_deliveriesabcdSynchronisierenToDeliveriesabcdProtokollieren is already taken; using ${suffixed}`);
    const r2 = await applyToXml(applied.xml, [{ op: 'add', kind: 'task', name: 'Pruefen', flow: suffixed }]);
    expect(r2.result.renamed).toEqual({ [suffixed]: 'flow_deliveriesabcdSynchronisierenToPruefen' });
    // every suffix up to _101 stays within 64, and each suffixed id is recognised as named after its ends
    const req = connectionRequest('bpmn:SequenceFlow', 'Gateway_DeliveriesabcdSynchronisieren', 'Activity_DeliveriesabcdProtokollieren');
    const registry = new IdRegistry();
    const given: string[] = [];
    for (let index = 0; index < 101; index++) {
      const { id } = IdStyle.of().next(req, registry);
      registry.claim(id);
      given.push(id);
    }
    expect(given.slice(98)).toEqual(['flow_synchronisierenToDeliveriesabcdProtokollieren99', 'flow_synchronisierenToDeliveriesabcdProtokollieren100', 'flow_synchronisierenToDeliveriesabcdProtokollieren101']);
    expect(given.filter((id) => id.length > MAX_ID)).toEqual([]);
    const bases = IdStyle.of().derivedBases(req);
    for (const id of given) {
      expect(bases.some((base) => id === base || (id.startsWith(base) && /^\d+$/.test(id.slice(base.length)))), id).toBe(true);
    }
  });

  it('#31: a flow keeps its suffix without a separator when the suffix cuts it again', async () => {
    const gateway = 'exclusiveGateway_deliveriesabcdSynchronisieren';
    const task = 'serviceTask_deliveriesabcdProtokollieren';
    const flow = 'flow_deliveriesabcdSynchronisierenToDeliveriesabcdProtokollieren';
    expect(flow).toHaveLength(MAX_ID);
    const xml = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToDeliveriesabcdSynchronisieren</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="${gateway}" name="Deliveriesabcd synchronisieren"><bpmn:incoming>flow_goToDeliveriesabcdSynchronisieren</bpmn:incoming><bpmn:outgoing>${flow}</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:serviceTask id="${task}" name="Deliveriesabcd protokollieren"><bpmn:incoming>${flow}</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="flow_goToDeliveriesabcdSynchronisieren" sourceRef="startEvent_go" targetRef="${gateway}" />
    <bpmn:sequenceFlow id="${flow}" sourceRef="${gateway}" targetRef="${task}" />`);
    const applied = await applyToXml(xml, [{ op: 'connect', source: gateway, target: task, as: '$f' }], { layout: false });
    expect(applied.result.aliases!['$f']).toBe('flow_synchronisierenToDeliveriesabcdProtokollieren2');
    const r2 = await applyToXml(applied.xml, [{ op: 'add', kind: 'task', name: 'Pruefen', flow: 'flow_synchronisierenToDeliveriesabcdProtokollieren2' }], { layout: false });
    expect(r2.result.renamed).toEqual({ flow_synchronisierenToDeliveriesabcdProtokollieren2: 'flow_deliveriesabcdSynchronisierenToPruefen' });
  });

  it('a cut flow to an end that ends in a digit takes No before its suffix and follows its ends', async () => {
    const gateway = 'exclusiveGateway_lieferantenbestellungSynchronisieren';
    const task = 'serviceTask_zahlungseingangProtokollieren10';
    const xml = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_checkOrder" name="Check order"><bpmn:incoming>flow_goToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming></bpmn:task>
    <bpmn:exclusiveGateway id="${gateway}" name="Lieferantenbestellung synchronisieren"/>
    <bpmn:serviceTask id="${task}" name="Zahlungseingang protokollieren 10"/>
    <bpmn:sequenceFlow id="flow_goToCheckOrder" sourceRef="startEvent_go" targetRef="task_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="task_checkOrder" targetRef="task_shipOrder" />`);
    const applied = await applyToXml(xml, [1, 2, 3, 4].map((index) => ({ op: 'connect', source: gateway, target: task, as: `$f${index}` })), { layout: false });
    // before: ...Zahlungseingang102, ...103, which read like flows to a task 102
    const base = 'flow_lieferantenbestellungSynchronisierenToZahlungseingang10';
    expect(Object.values(applied.result.aliases!)).toEqual([base, `${base}No2`, `${base}No3`, `${base}No4`]);
    expect(`${base}No2`).toHaveLength(63);
    // a splice renames the suffixed one
    const r2 = await applyToXml(applied.xml, [{ op: 'add', kind: 'task', name: 'Pruefen', flow: `${base}No3` }], { layout: false });
    expect(r2.result.renamed).toEqual({ [`${base}No3`]: 'flow_lieferantenbestellungSynchronisierenToPruefen' });
  });

  it('#31: element ids of 62 to 64 characters are not cut; the --if-absent hint gets the same cap', async () => {
    const typed = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="userTask_checkOrder" name="Check order"><bpmn:incoming>flow_goToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="serviceTask_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming><bpmn:outgoing>flow_shipOrderToDone</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_shipOrderToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_goToCheckOrder" sourceRef="startEvent_go" targetRef="userTask_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="userTask_checkOrder" targetRef="serviceTask_shipOrder" />
    <bpmn:sequenceFlow id="flow_shipOrderToDone" sourceRef="serviceTask_shipOrder" targetRef="endEvent_done" />`);
    const conventions = { prefixes: { 'bpmn:IntermediateThrowEvent': 'intermediateThrowEvent_' }, case: 'camelCase' } as const;
    const event = { op: 'add', kind: 'intermediateThrowEvent', name: 'Lieferung vollständig eingegangen Abcdefgh' } as const;
    const full = 'intermediateThrowEvent_lieferungVollstaendigEingegangenAbcdefgh';
    expect(full).toHaveLength(63);
    // 0.6: intermediateThrowEvent_lieferungVollstaendigEingegangen; a second one takes the glued suffix, which still fits
    const applied = await applyToXml(typed, [{ ...event, after: 'serviceTask_shipOrder', as: '$e' }, { ...event, after: '$e', as: '$e2' }], { layout: false, conventions });
    expect(applied.result.aliases).toMatchObject({ $e: full, $e2: 'intermediateThrowEvent_lieferungVollstaendigEingegangenAbcdefgh2' });
    // the id --if-absent asks for is the one add generates
    const doc = await Doc.fromXml(typed);
    doc.conventions = conventions;
    let hint: string | undefined;
    try {
      runOps(doc, [{ ...event, after: 'serviceTask_shipOrder', ifAbsent: true }]);
    } catch (error) {
      hint = (error as { details?: { hint?: string } }).details?.hint;
    }
    expect(hint).toContain(`--id ${full} `);
  });

  it('#31: the join of a split stays within 64 characters, a suffixed one too', async () => {
    const join = IdStyle.of().joinId('gateway_consignationsSynchronisierenUndLieferscheinePruefenAbc');
    expect(join).toBe('gateway_consignationsSynchronisierenUndLieferscheinePruefenJoin');
    expect(join.length).toBeLessThanOrEqual(MAX_ID);
    // a gateway id of 59 characters: its join has 63, a taken one keeps Join before the suffix
    const gateway = 'gateway_consignationsSynchronisierenUndLieferscheinePruefen';
    const applied = await applyToXml((await newXml({ processName: 'Join' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'join', as: '$s' },
      { op: 'add', kind: 'task', id: join, name: 'Taken', after: '$s', as: '$t' },
      { op: 'split', after: '$t', id: gateway, branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }], joinAs: '$j' },
    ]);
    expect(applied.result.aliases!['$j']).toBe('gateway_consignationsSynchronisierenUndLieferscheinePruefenJoin2');
    expect(ids(applied.xml).filter((id) => id.length > MAX_ID)).toEqual([]);
  });

  it('transliterates beyond German: Nordic letters spelled out, other accents dropped', async () => {
    expect(transliterate('Øre Åse Æble')).toBe('Oere Aase Aeble');
    expect(transliterate('ØRE')).toBe('OERE');
    expect(transliterate('Œuvre Łódź Þing')).toBe('Oeuvre Lodz Thing');
    const base = await newXml({ processName: 'Nordic' });
    const applied = await applyToXml(base.xml, [{ op: 'add', kind: 'task', name: 'Ünïcödé Çàfé Øre', in: 'nordic', as: '$t' }]);
    expect(applied.result.aliases?.['$t']).toBe('task_uenicoedeCafeOere');
  });
});

describe('bpmn new: a speaking definitions id', () => {
  it('definitions_<name> with --name, definitions_<stem> with a speaking --id, the tool defaults without either', async () => {
    const defsId = (xml: string): string => /<bpmn:definitions[^>]* id="([^"]+)"/.exec(xml)![1]!;
    expect(defsId((await newXml({ processName: 'Order to cash', target: 'camunda8' })).xml)).toBe('definitions_orderToCash');
    expect(defsId((await newXml({ processId: 'Process_Billing' })).xml)).toBe('definitions_billing');
    expect(defsId((await newXml({})).xml)).toBe('Definitions_1');
  });
});

describe('the warnings delta', () => {
  it("counts the platform profile's findings the file already had", async () => {
    const base = await newXml({ processName: 'Pf', target: 'camunda8' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'pf', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Charge', after: '$s', as: '$c' },
      { op: 'add', kind: 'serviceTask', name: 'Ship', after: '$c', as: '$h' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$h' },
    ]);
    expect((await validateXml(built.xml)).platform?.counts.deploy).toBe(2);
    const applied = await applyToXml(built.xml, [{ op: 'set', id: 'endEvent_done', values: { name: 'Finished' } }]);
    expect(applied.result.warnings.added).toEqual([]);
    expect(applied.result.warnings.preexistingCount).toBe(2);
    expect(renderSummary(mutationSummary(applied.result))).toContain('warnings: 0 added, 0 resolved, 2 already in the file');
  });

  it('counts what `bpmn validate` lists: a missing start once, as the platform finding', async () => {
    const base = await newXml({ processName: 'Empty', target: 'camunda8' });
    const xml = (await applyToXml(base.xml, [{ op: 'add', kind: 'serviceTask', name: 'Charge', in: 'empty' }])).xml;
    const listed = (await validateXml(xml)).warnings.map((warning) => warning.code);
    expect(listed).toEqual(expect.arrayContaining(['W_C8_DEPLOY_START_EVENT', 'W_C8_DEPLOY_IMPLEMENTATION']));
    expect(listed).not.toContain('W_NO_START');
    const applied = await applyToXml(xml, [{ op: 'set', id: 'empty', values: { name: 'Still empty' } }]);
    expect(applied.result.warnings.added).toEqual([]);
    expect(applied.result.warnings.preexistingCount).toBe(listed.length);
  });

  /** T1, T2, T3 all named "Check" between Go and Done. */
  async function threeChecks(): Promise<string> {
    const base = await newXml({ processName: 'Dn' });
    return (
      await applyToXml(base.xml, [
        { op: 'add', kind: 'startEvent', name: 'Go', in: 'dn', as: '$s' },
        { op: 'add', kind: 'task', name: 'Check', id: 'T1', after: '$s' },
        { op: 'add', kind: 'task', name: 'Check', id: 'T2', after: 'T1' },
        { op: 'add', kind: 'task', name: 'Check', id: 'T3', after: 'T2' },
        { op: 'add', kind: 'endEvent', name: 'Done', after: 'T3' },
      ])
    ).xml;
  }

  it('a duplicate-name warning whose group only shrank is the old one; gone is resolved; a new member is added', async () => {
    const xml = await threeChecks();
    const one = await applyToXml(xml, [{ op: 'remove', ids: ['T3'] }]);
    expect(one.result.warnings.added.map((warning) => warning.code)).toEqual([]);
    expect(one.result.warnings.resolved.map((warning) => warning.code)).toEqual([]);
    expect(one.result.warnings.preexistingCount).toBe(1);
    const both = await applyToXml(xml, [{ op: 'remove', ids: ['T2'] }, { op: 'remove', ids: ['T3'] }]);
    expect(both.result.warnings.resolved.map((warning) => warning.code)).toEqual(['W_DUPLICATE_NAME']);
    const first = await applyToXml(xml, [{ op: 'remove', ids: ['T1'] }]);
    expect(first.result.warnings.added.map((warning) => warning.code)).toEqual([]);
    expect(first.result.warnings.resolved.map((warning) => warning.code)).toEqual([]);
    const more = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Check', id: 'T4', after: 'startEvent_go' }]);
    expect(more.result.warnings.added.map((warning) => warning.code)).toContain('W_DUPLICATE_NAME');
    expect(more.result.warnings.resolved.map((warning) => warning.code)).toEqual([]);
  });

  it('a bridge that takes the id of the flow it replaces lists every id once: the old flow removed, the taken id changed', async () => {
    const xml = await threeChecks();
    const applied = await applyToXml(xml, [{ op: 'remove', ids: ['T3'] }]);
    expect(flowIds(applied.xml)).toEqual(expect.arrayContaining(['flow_checkToDone']));
    expect(flowIds(applied.xml)).not.toContain('flow_checkToCheck2');
    const summary = mutationSummary(applied.result);
    expect(summary.removed).toEqual(['flow_checkToCheck2', 'T3']);
    expect(summary.changed).toEqual(['flow_checkToDone']);
    expect(summary.renamed).toBeUndefined();
    const text = renderMutation(applied.result);
    expect(text).toContain('changed sequenceFlow flow_checkToDone - T2 -> endEvent_done (bridged T3)\n');
    expect(text).toContain('removed sequenceFlow flow_checkToCheck2 - T2 -> T3');
    // the same over two ops of a batch: the flow from T1 that T2's bridge kept takes the id of T3's outgoing flow
    const two = mutationSummary((await applyToXml(xml, [{ op: 'remove', ids: ['T2'] }, { op: 'remove', ids: ['T3'] }])).result);
    expect([...two.removed].sort()).toEqual(['T2', 'T3', 'flow_checkToCheck', 'flow_checkToCheck2']);
    expect(two.changed).toEqual(['flow_checkToDone']);
    expect(two.renamed).toBeUndefined();
  });

  it('a batch reports the warnings of its final state: lanes added before the participant that wraps the process', async () => {
    const base = await newXml({ processName: 'Demo' });
    const started = await applyToXml(base.xml, [{ op: 'add', kind: 'startEvent', name: 'Start', in: 'demo' }]);
    const applied = await applyToXml(started.xml, [
      { op: 'add', kind: 'lane', name: 'Sales', in: 'demo', members: ['startEvent_start'] },
      { op: 'add', kind: 'participant', name: 'Seller', process: 'demo' },
    ]);
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANES_WITHOUT_POOL');
    // without the participant it still holds
    const lanesOnly = await applyToXml(started.xml, [{ op: 'add', kind: 'lane', name: 'Sales', in: 'demo', members: ['startEvent_start'] }]);
    expect(lanesOnly.result.warnings.added.map((warning) => warning.code)).toContain('W_LANES_WITHOUT_POOL');
  });

  it('a batch drops an implicit join a later op of it resolved', async () => {
    const base = await newXml({ processName: 'Join' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'join', as: '$s' },
      { op: 'split', after: '$s', kind: 'parallelGateway', join: false, branches: [{ nodes: [{ kind: 'task', name: 'Left' }] }, { nodes: [{ kind: 'task', name: 'Right' }] }] },
      { op: 'add', kind: 'endEvent', name: 'Done', after: 'task_left' },
    ]);
    const join = [
      { op: 'connect', source: 'task_right', target: 'endEvent_done', as: '$right' },
      { op: 'add', kind: 'parallelGateway', id: 'gateway_sync', flow: 'flow_leftToDone' },
      { op: 'set', id: '$right', values: { target: 'gateway_sync' } },
    ];
    expect((await applyToXml(built.xml, join.slice(0, 1))).result.warnings.added.map((warning) => warning.code)).toContain('W_IMPLICIT_JOIN');
    const applied = await applyToXml(built.xml, join);
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_IMPLICIT_JOIN');
  });

  it('new reports the platform findings an edit would, and the next edit resolves what new showed', async () => {
    const base = await newXml({ processName: 'Order', target: 'camunda8' });
    const shown = base.result.warnings.added.map((warning) => warning.code);
    expect(shown).toContain('W_C8_DEPLOY_START_EVENT');
    expect(shown).not.toContain('W_NO_START');
    const applied = await applyToXml(base.xml, [{ op: 'add', kind: 'startEvent', name: 'Go', in: 'order' }]);
    expect(applied.result.warnings.resolved.map((warning) => warning.code)).toEqual(['W_C8_DEPLOY_START_EVENT']);
    expect(shown).toEqual(expect.arrayContaining(applied.result.warnings.resolved.map((warning) => warning.code)));
  });
});
