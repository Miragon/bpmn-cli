/**
 * Step 3, the verifier's id and report findings: flows at unnamed gateways
 * name them by their own speaking ids, no context chains, a length cap (no
 * cut below it, whole words: #31), transliteration beyond German, speaking
 * definitions ids of `new`, and the warnings delta (platform findings
 * counted, group warnings, a bridge that takes the removed flow's id,
 * warnings of a batch's final state, `new` with the platform's findings).
 * Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml, validateXml } from '../src/api.js';
import { Doc } from '../src/model/Doc.js';
import { conventionsView } from '../src/index.js';
import { ID_CONVENTIONS } from '../src/report/guide.js';
import { cutAt, cutName, idWords, isFiller, keptTail, MAX_ID, slugify, snakeSlug, transliterate } from '../src/ids/utils/slug.js';
import { IdRegistry } from '../src/ids/IdRegistry.js';
import { connectionRequest, kindRequest } from '../src/ids/utils/requests.js';
import { IdStyle } from '../src/ids/IdStyle.js';
import { kindByName } from '../src/model/utils/kinds.js';
import { runOps, mutationSummary, renderMutation, renderSummary } from '../src/index.js';
import { definitionsXml, flowBetween } from './helpers.js';

const ids = (xml: string): string[] => [...xml.matchAll(/<bpmn:\w+ id="([^"]+)"/g)].map((match) => match[1]!);
const flowIds = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((match) => match[1]!);
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
    const applied = await applyToXml((await newXml({ processName: 'Gw' })).xml, NESTED_SPLITS);
    const flows = flowIds(applied.xml);
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
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    expect(new Set(ids(applied.xml)).size).toBe(ids(applied.xml).length);
  });

  it('unnamed gateways and tasks in a row: the nearest named anchor once, the kind spelled out, then the anchor named', async () => {
    const base = await newXml({ processName: 'Row' });
    const start = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Row', as: '$s' },
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
    expect(gw.aliases).toMatchObject({ $g: 'Gateway_AfterCheck', $h: 'Gateway_ParallelAfterCheck', $e: 'Event_EndAfterCheck' });
    expect(gw.flows).toEqual(['Flow_AfterCheckToParallelAfterCheck', 'Flow_CheckToAfterCheck', 'Flow_ParallelAfterCheckToEndAfterCheck', 'Flow_StartToCheck']);
    expect(gw.suffixed).toBe(0);
    // an unnamed task after the unnamed gateway: its body would be the gateway's (Flow_AfterCheckToAfterCheck), so it says its kind;
    // the next one would repeat that, so it names its anchor (the Check service task), not the gateway's body again
    const tasks = await run([
      { op: 'add', kind: 'exclusiveGateway', after: '$c', as: '$g' },
      { op: 'add', kind: 'serviceTask', after: '$g', as: '$u' },
      { op: 'add', kind: 'serviceTask', after: '$u', as: '$v' },
    ]);
    expect(tasks.aliases).toMatchObject({ $g: 'Gateway_AfterCheck', $u: 'Activity_ServiceTaskAfterCheck', $v: 'Activity_AfterCheckServiceTask' });
    expect(tasks.flows).toEqual(expect.arrayContaining(['Flow_AfterCheckToServiceTaskAfterCheck', 'Flow_ServiceTaskAfterCheckToAfterCheckServiceTask']));
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

/** Bodies of ids without their prefix: `Task_AfterCheck` and `ExclusiveGateway_AfterCheck` share `AfterCheck`. */
const body = (id: string): string => id.slice(id.indexOf('_') + 1);
/** A flow whose two ends read alike (Flow_AfterCheckToAfterCheck, flow_after_checkToAfter_check). */
const SAME_ENDS = /^[A-Za-z]+_(\w+?)(?:To|_to_)(\w+)$/;
const sameEnds = (id: string): boolean => {
  const match = SAME_ENDS.exec(id);
  return !!match && match[1]!.toLowerCase() === match[2]!.toLowerCase();
};

/** A file of the older Camunda Modeler: `Task_` for every task, gateways and flows named after their type with a hash. */
const OLD_MODELER = definitionsXml(`
    <bpmn:startEvent id="StartEvent_1"><bpmn:outgoing>SequenceFlow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_0k3x9qa" name="Check"><bpmn:incoming>SequenceFlow_0a1b2c3</bpmn:incoming><bpmn:outgoing>SequenceFlow_1d2e3f4</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="Task_1m2n3o4" name="Book"><bpmn:incoming>SequenceFlow_1d2e3f4</bpmn:incoming><bpmn:outgoing>SequenceFlow_0g5h6i7</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:exclusiveGateway id="ExclusiveGateway_0p9q8r7" />
    <bpmn:endEvent id="EndEvent_0s1t2u3"><bpmn:incoming>SequenceFlow_0g5h6i7</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="SequenceFlow_0a1b2c3" sourceRef="StartEvent_1" targetRef="Task_0k3x9qa" />
    <bpmn:sequenceFlow id="SequenceFlow_1d2e3f4" sourceRef="Task_0k3x9qa" targetRef="Task_1m2n3o4" />
    <bpmn:sequenceFlow id="SequenceFlow_0g5h6i7" sourceRef="Task_1m2n3o4" targetRef="EndEvent_0s1t2u3" />`);

/** snake_case bodies with `task_` for every task. */
const SNAKE = definitionsXml(`
    <bpmn:startEvent id="startEvent_order_received" name="Order received"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="task_check_order" name="Check order"><bpmn:incoming>flow_1</bpmn:incoming><bpmn:outgoing>flow_2</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="task_book_order" name="Book order"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="flow_1" sourceRef="startEvent_order_received" targetRef="task_check_order" />
    <bpmn:sequenceFlow id="flow_2" sourceRef="task_check_order" targetRef="task_book_order" />`);

describe('unnamed elements in a row where the prefix says the kind (Task_, task_)', () => {
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
    // before: Task_AfterCheck (the gateway's body: SequenceFlow_AfterCheckToAfterCheck) and Task_AfterCheck_2 with W_ID_SUFFIXED
    expect(applied.aliases).toMatchObject({ $g: 'ExclusiveGateway_AfterCheck', $u: 'Task_AfterCheckGateway', $v: 'Task_AfterCheckGatewayTask' });
    expect(applied.flows).toEqual(expect.arrayContaining(['SequenceFlow_AfterCheckToAfterCheckGateway', 'SequenceFlow_AfterCheckGatewayToAfterCheckGatewayTask']));
    expect(applied.suffixed).toEqual([]);
    const bodies = nodes(applied.fresh, applied.flows).map(body);
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const id of applied.flows) expect(sameEnds(id)).toBe(false);
  });

  it('the same in a snake_case file, and after a task whose name gives no id words', async () => {
    const snake = await run(SNAKE, [
      { op: 'add', kind: 'exclusiveGateway', after: 'task_check_order', as: '$g' },
      { op: 'add', kind: 'task', after: '$g', as: '$u' },
      { op: 'add', kind: 'task', after: '$u', as: '$v' },
    ]);
    expect(snake.aliases).toMatchObject({ $u: 'task_after_check_order_gateway', $v: 'task_after_check_order_gateway_task' });
    expect(snake.suffixed).toEqual([]);
    for (const id of snake.flows) expect(sameEnds(id)).toBe(false);
    // a service task named in CJK and a task named with symbols: both unnamed for their ids, both Task_
    const tricky = await run(OLD_MODELER, [
      { op: 'add', kind: 'serviceTask', name: '审批 订单', after: 'Task_0k3x9qa', as: '$c' },
      { op: 'add', kind: 'task', name: '✓✓✓', after: '$c', as: '$k' },
    ]);
    expect(tricky.aliases).toMatchObject({ $c: 'Task_AfterCheck', $k: 'Task_AfterCheckServiceTask' });
    expect(tricky.suffixed).toEqual([]);
  });

  it('a long anchor keeps the kind word through the length cut', async () => {
    const applied = await run(OLD_MODELER, [
      { op: 'add', kind: 'userTask', name: 'Prüfen ob die eingereichten Unterlagen vollständig und fristgerecht vorliegen', after: 'Task_0k3x9qa', as: '$l' },
      { op: 'add', kind: 'exclusiveGateway', after: '$l', as: '$g' },
      { op: 'add', kind: 'task', after: '$g', as: '$u' },
    ]);
    expect(applied.aliases['$u']).toMatch(/^Task_After\w+Gateway$/);
    for (const id of applied.fresh) expect(id.length).toBeLessThanOrEqual(MAX_ID);
    expect(applied.suffixed).toEqual([]);
  });

  it('W_ID_SUFFIXED stays a signal: a repeated name, and two unnamed tasks that only an index could tell apart', async () => {
    // the name of a task already in the file
    const named = await run(OLD_MODELER, [
      { op: 'add', kind: 'task', name: 'Ship', after: 'Task_0k3x9qa' },
      { op: 'add', kind: 'task', name: 'Ship', after: 'Task_1m2n3o4' },
    ]);
    expect(named.fresh).toEqual(expect.arrayContaining(['Task_Ship', 'Task_Ship_2']));
    expect(named.suffixed.map((suffixWarning) => suffixWarning.element)).toEqual(['Task_Ship_2']);
    // two unnamed tasks on two branches right after the same unnamed gateway: the second one takes a suffix on the
    // form that names the gateway, never the gateway's own body (SequenceFlow_AfterCheckToAfterCheck)
    const branches = await run(OLD_MODELER, [{ op: 'split', after: 'Task_0k3x9qa', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task' }] }, { nodes: [{ kind: 'task' }] }] }]);
    expect(branches.fresh).toEqual(expect.arrayContaining(['Task_AfterCheckGateway', 'Task_AfterCheckGateway_2']));
    expect(branches.suffixed.map((suffixWarning) => suffixWarning.element)).toEqual(['Task_AfterCheckGateway_2']);
    for (const id of branches.flows) expect(sameEnds(id)).toBe(false);
  });
});

describe('id quality: context once, length cap, transliteration', () => {
  it('an unnamed element after an unnamed one is placed after the nearest named anchor, once (no AfterAfter chains)', async () => {
    const base = await newXml({ processName: 'Tricky' });
    const applied = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Tricky', as: '$s' },
      { op: 'add', kind: 'userTask', name: '4-Augen-Prinzip: prüfen & freigeben (2. Stufe)?', after: '$s', as: '$q' },
      { op: 'add', kind: 'serviceTask', name: '审批 订单', after: '$q', as: '$c' },
      { op: 'add', kind: 'task', name: '✓✓✓', after: '$c', as: '$d' },
      { op: 'add', kind: 'exclusiveGateway', after: '$d', as: '$g' },
      { op: 'add', kind: 'endEvent', after: '$g', as: '$e' },
    ]);
    const all = ids(applied.xml);
    for (const id of all) expect(id).not.toMatch(/AfterAfter|BeforeBefore/);
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    expect(applied.result.aliases).toMatchObject({
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
    const applied = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Digits', as: '$s' },
      { op: 'add', kind: 'task', name: '123', after: '$s', as: '$t' },
    ]);
    expect(applied.result.aliases?.['$t']).toBe('Activity_AfterStart');
  });

  it('generated ids are at most 64 characters, cut at whole words, the same every time', async () => {
    const ops = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Long', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Prüfen ob die eingereichten Unterlagen vollständig und fristgerecht vorliegen', after: '$s', as: '$a' },
      { op: 'add', kind: 'serviceTask', name: 'Benachrichtigung über den Bearbeitungsstand an alle beteiligten Stellen versenden', after: '$a', as: '$b' },
      { op: 'add', kind: 'boundaryEvent:message', on: '$b', message: 'Rückmeldung der beteiligten Stellen zum Bearbeitungsstand eingegangen' },
    ];
    const base = await newXml({ processName: 'Long' });
    const applied = await applyToXml(base.xml, ops);
    for (const id of ids(applied.xml)) expect(id.length).toBeLessThanOrEqual(MAX_ID);
    // a name gives at most 40 characters of words, although Activity_BenachrichtigungUeberDenBearbeitungsstand fits into 64,
    // and they never end on a filler word (before: Activity_BenachrichtigungUeberDen)
    expect(applied.result.aliases).toMatchObject({ $a: 'Activity_PruefenObDieEingereichtenUnterlagen', $b: 'Activity_BenachrichtigungUeber' });
    // a flow's two ends share the room: of the cuts with the most words the longest, the target gives up Den, not the
    // source Unterlagen (0.6 and the first cut of #31: Flow_PruefenObDieEingereichtenToBenachrichtigungUeberDen)
    expect(flowIds(applied.xml)).toContain('Flow_PruefenObDieEingereichtenUnterlagenToBenachrichtigungUeber');
    expect((await applyToXml(base.xml, ops)).xml).toBe(applied.xml);
    expect(cutAt('Flow_CheckInvoiceToBookInvoice', 23)).toBe('Flow_CheckInvoiceToBook');
    expect(cutAt('Flow_CheckInvoiceToBookInvoice', 22)).toBe('Flow_CheckInvoiceTo');
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
    expect(idWords('Flow_PruefenToBenachrichtigung_2').join('')).toBe('Flow_PruefenToBenachrichtigung_2');
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
      { op: 'add', kind: 'startEvent', name: 'Every minute', in: 'Process_Sync', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: `${word} synchronisieren`, after: '$s', as: '$a' },
      { op: 'add', kind: 'endEvent', name: `${word} aktualisiert`, after: '$a' },
    ]);
    return applyToXml(first.xml, [{ op: 'add', kind: 'serviceTask', name: `${word} protokollieren`, after: first.result.aliases!['$a']! }]);
  }

  it('#31: an id that fits into 64 characters is not cut (a renamed flow included)', async () => {
    const applied = await sync('Consignations');
    expect(flowIds(applied.xml)).toContain('Flow_ConsignationsSynchronisierenToConsignationsProtokollieren');
    expect(applied.result.renamed).toEqual({ Flow_ConsignationsSynchronisierenToConsignationsAktualisiert: 'Flow_ConsignationsSynchronisierenToConsignationsProtokollieren' });
    expect(flowIds((await sync('Deliveriesabc')).xml)).toContain('Flow_DeliveriesabcSynchronisierenToDeliveriesabcProtokollieren');
    const full = 'Flow_DeliveriesabcdSynchronisierenToDeliveriesabcdProtokollieren';
    expect(full).toHaveLength(MAX_ID);
    expect(flowIds((await sync('Deliveriesabcd')).xml)).toContain(full);
    expect(flowIds((await sync('Shipments')).xml)).toContain('Flow_ShipmentsSynchronisierenToShipmentsProtokollieren');
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
    expect(flowIds((await sync('Deliveriesabcde')).xml)).toContain('Flow_SynchronisierenToDeliveriesabcdeProtokollieren');
    // 0.6: Flow_LieferantenbSynchronisierenToLieferantenbeProtokollieren
    expect(flowIds((await sync('Lieferantenbestellungen')).xml)).toContain('Flow_SynchronisierenToLieferantenbestellungenProtokollieren');
    // the target gives up Abgleichen, then the source Lieferantenbestellungsuebersicht: Abgleichen fits again and comes back (not ...PruefenUnd)
    const flow = (labels: { sourceLabel: string; targetLabel: string }): string => IdStyle.DEFAULT.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', labels));
    expect(flow({ sourceLabel: 'Neue Lieferantenbestellungsübersicht', targetLabel: 'Zahlungseingänge prüfen und abgleichen' })).toBe('Flow_NeueToZahlungseingaengePruefenUndAbgleichen');
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
      for (let remaining = pick(6); remaining > 0; remaining--) words.push(vocabulary[pick(vocabulary.length)]!);
      return words.join(' ');
    };
    for (let index = 0; index < 2000; index++) {
      const sourceLabel = name();
      const targetLabel = pick(3) === 0 ? name(sourceLabel.split(' ')[0]) : name();
      const req = connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel });
      const id = IdStyle.DEFAULT.derivedBase(req);
      const uncut = `Flow_${slugify(sourceLabel)}To${slugify(targetLabel)}`;
      const known = new Set([...idWords(slugify(sourceLabel)), ...idWords(slugify(targetLabel)), 'To']);
      expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
      if (uncut.length <= MAX_ID) expect(id).toBe(uncut);
      else {
        const words = idWords(id.slice('Flow_'.length));
        for (const word of words) expect(known, `${word} in ${id}`).toContain(word);
        const [full, other] = [idWords(slugify(sourceLabel)), idWords(slugify(targetLabel))];
        if (full[0] !== other[0]) {
          const at = words.indexOf('To');
          for (const [cut, whole] of [[words.slice(0, at), full], [words.slice(at + 1), other]] as const) {
            // a number goes with the word after it (an end never ends on a number it did not end with), so does a filler
            // word (und, an: a cut never ends on one)
            let cutEnd = cut.length;
            while (cutEnd < whole.length - 1 && (/^\d+$/.test(whole[cutEnd]!) || isFiller(whole[cutEnd]!))) cutEnd++;
            const next = whole.slice(cut.length, cutEnd + 1).join('');
            if (cut.length < whole.length && cut.every((word, wordIndex) => word === whole[wordIndex])) expect(id.length + next.length, `${next} after ${id}`).toBeGreaterThan(MAX_ID);
          }
        }
      }
      expect(IdStyle.DEFAULT.derivedBase(req)).toBe(id);
    }
  });

  it('#31: a word is cut inside only when no end has a word left to give up, and then in the longer end where the other fits whole', () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.DEFAULT.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // one word each, 32 and 30 characters in a room of 57 (before: both cut, ...ToZahlungseingangsbestaetigunge)
    expect(flow('Lieferantenbestellungsübersicht', 'Zahlungseingangsbestätigungen')).toBe('Flow_LieferantenbestellungsueberToZahlungseingangsbestaetigungen');
    // each end first gives up its second word; on a tie the source is cut
    expect(flow('Kundenstammdatenaktualisierung durchführen', 'Vertragsunterlagenarchivierung abschließen')).toBe('Flow_KundenstammdatenaktualisierToVertragsunterlagenarchivierung');
    // ends that begin alike are down to their last word
    expect(flow('Bestellung Lieferantenstammdatenprotokoll', 'Bestellung Warenwirtschaftssystemabgleich')).toBe('Flow_LieferantenstammdatenprotokToWarenwirtschaftssystemabgleich');
  });

  it('#31: of the cuts that fit, the one with the most words, then the most characters: a short word goes before a long one', async () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.DEFAULT.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // 66 characters uncut: Aktualisieren goes, not Lieferantenbestellungen (the longer end first: Flow_SynchronisierenAktualisierenToRechnung)
    expect(flow('Synchronisieren aktualisieren', 'Rechnung Lieferantenbestellungen')).toBe('Flow_SynchronisierenToRechnungLieferantenbestellungen');
    // both keep two words: the longer pair (not Flow_VersendenToAbgleichenBestellungDie)
    expect(flow('Versenden Zahlungseingangsbestätigung', 'Abgleichen Bestellung die')).toBe('Flow_VersendenZahlungseingangsbestaetigungToAbgleichenBestellung');
    // a stemTo end keeps its words too (not flow_pruefenUebermittelnInformierenToUnd)
    const xml = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_checkOrder" name="Check order"><bpmn:incoming>flow_goToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="flow_goToCheckOrder" sourceRef="startEvent_go" targetRef="task_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="task_checkOrder" targetRef="task_shipOrder" />`);
    const stemTo = IdStyle.infer((await Doc.fromXml(xml)).definitions);
    expect(stemTo.info().sequenceFlow.form).toBe('stemTo');
    expect(stemTo.derivedBase(connectionRequest('bpmn:SequenceFlow', 'task_pruefenUebermittelnInformieren', 'task_undZahlungseingangsbestaetigungKundeAn'))).toBe('flow_pruefenUebermittelnToUndZahlungseingangsbestaetigungKundeAn');
  });

  it('#31: an end never shrinks to a number, and the id never ends on one that reads like a suffix; a word between numbers is cut inside, the numbers kept', async () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.DEFAULT.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // the word between two numbers stays (no 32024), so the end is cut inside it, and the other end keeps what fits
    // beside it (0.6: Flow_32024ToLieferantenbestellungsuebersichtPruefen; before this fix: ...ToLieferantenbestellungsuebersicht, 44 characters)
    expect(flow('3 Zahlungseingangsbestätigungen 2024', 'Lieferantenbestellungsübersicht prüfen')).toBe('Flow_3Zahlungseingangsbest2024ToLieferantenbestellungsuebersicht');
    expect(flow('Lieferantenbestellungsübersicht prüfen', '3 Zahlungseingangsbestätigungen 2024')).toBe('Flow_LieferantenbestellungsuebersichtTo3Zahlungseingangsbest2024');
    expect(flow('2 Zahlungseingangsbestätigungen 2', 'Lieferantenbestellungsübersicht prüfen')).toBe('Flow_2Zahlungseingangsbestaet2ToLieferantenbestellungsuebersicht');
    expect(flow('10 Warenwirtschaftssystemabgleich 10', 'Warenwirtschaftssystemabgleich 100')).toBe('Flow_10Warenwirtschaftssyst10ToWarenwirtschaftssystemabgleich100');
    // a leading number keeps the word after it (0.6: Flow_2ToVertragsunterlagenarchivierung)
    expect(flow('2 Lieferantenbestellungsübersichten', 'Vertragsunterlagenarchivierung abschließen')).toBe('Flow_2LieferantenbestellungsuebeToVertragsunterlagenarchivierung');
    // the same through an edit
    const applied = await applyToXml((await newXml({ processName: 'Num' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Num', as: '$s' },
      { op: 'add', kind: 'task', name: '3 Zahlungseingangsbestätigungen 2024', after: '$s', as: '$a' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellungsübersicht prüfen', after: '$a' },
    ]);
    expect(flowIds(applied.xml)).toContain('Flow_3Zahlungseingangsbest2024ToLieferantenbestellungsuebersicht');
    // a number the given-up word leaves stays where it cannot read like a collision suffix (`_2` here): before To, and
    // glued to the target's last word; so two flows that differ only by their number keep their own ids (before this
    // fix both Flow_PhaseToZahlungseingangsbestaetigungenAbgleichen, the second one with _2)
    expect(flow('Zahlungseingangsbestätigungen', 'Lieferantenbestellungen 4 Augen ab')).toBe('Flow_ZahlungseingangsbestaetigungenToLieferantenbestellungen4');
    expect(flow('Phase 1 Lieferantenbestellungsübersicht prüfen', 'Zahlungseingangsbestätigungen abgleichen')).toBe('Flow_Phase1ToZahlungseingangsbestaetigungenAbgleichen');
    expect(flow('Phase 2 Lieferantenbestellungsübersicht prüfen', 'Zahlungseingangsbestätigungen abgleichen')).toBe('Flow_Phase2ToZahlungseingangsbestaetigungenAbgleichen');
    expect(flow('V2 Lieferantenbestellungsübersicht', 'Zahlungseingangsbestätigungen abgleichen')).toBe('Flow_V2ToZahlungseingangsbestaetigungenAbgleichen');
    expect(flow('Zahlungseingangsbestätigungen abgleichen', 'Stufe 2 Lieferantenbestellungsübersicht prüfen')).toBe('Flow_ZahlungseingangsbestaetigungenAbgleichenToStufe2');
    const phases = await applyToXml((await newXml({ processName: 'Phase' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Phase', as: '$s' },
      { op: 'split', after: '$s', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'Phase 1 Lieferantenbestellungsübersicht prüfen', as: '$p1' }] }, { nodes: [{ kind: 'task', name: 'Phase 2 Lieferantenbestellungsübersicht prüfen', as: '$p2' }] }], joinAs: '$j' },
      { op: 'add', kind: 'task', name: 'Zahlungseingangsbestätigungen abgleichen', after: '$j', as: '$z' },
      { op: 'connect', source: '$p1', target: '$z' },
      { op: 'connect', source: '$p2', target: '$z' },
    ]);
    expect(flowIds(phases.xml)).toEqual(expect.arrayContaining(['Flow_Phase1ToZahlungseingangsbestaetigungenAbgleichen', 'Flow_Phase2ToZahlungseingangsbestaetigungenAbgleichen']));
    expect(phases.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    // where it would read like a suffix (a separated `_4` at the end of the id) it goes with the given-up word: the base
    // never reads like a suffixed id, and no suffix is skipped
    const snakeXml = definitionsXml(`
    <bpmn:task id="Task_check_order" name="Check order"><bpmn:outgoing>Flow_check_order_to_ship_order</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_ship_order" name="Ship order"><bpmn:incoming>Flow_check_order_to_ship_order</bpmn:incoming><bpmn:outgoing>Flow_ship_order_to_bill_order</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_bill_order" name="Bill order"><bpmn:incoming>Flow_ship_order_to_bill_order</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_check_order_to_ship_order" sourceRef="Task_check_order" targetRef="Task_ship_order" />
    <bpmn:sequenceFlow id="Flow_ship_order_to_bill_order" sourceRef="Task_ship_order" targetRef="Task_bill_order" />`);
    const stemSnake = IdStyle.infer((await Doc.fromXml(snakeXml)).definitions);
    expect(stemSnake.info().sequenceFlow.form).toBe('stemSnake');
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
    // nor does a cut leave a number right before a kept number tail (stufe_2_2 for stufe_2_pruefung_2, whose _2 the suffixes skipped)
    const pair = await idFlows('_');
    for (const [target, last] of [['Task_freigabe_stufe_2_pruefung_2', 12], ['Task_lieferung_10_teil_10', 12]] as const) {
      const ids = new IdRegistry();
      const suffixed: string[] = [];
      for (let index = 0; index < last; index++) {
        const { id } = pair.next(connectionRequest('bpmn:SequenceFlow', 'Task_zahlungseingangsbestaetigungen_pruefen', target), ids);
        ids.claim(id);
        expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
        suffixed.push(index ? /_(\d+)$/.exec(id)![1]! : '');
      }
      expect(suffixed, target).toEqual(['', ...Array.from({ length: last - 1 }, (_unused, index) => String(index + 2))]);
    }
    expect(pair.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Task_zahlungseingangsbestaetigungen_pruefen', 'Task_freigabe_stufe_2_pruefung_2'))).toBe('Flow_Task_zahlungseingangsbestaetigungen_pruefen_Task_freigabe_2');
  });

  it('a cut flow to a target that ends in two numbers keeps both: x_2_2 never names x_2, and a flow skips no suffix', async () => {
    const pair = await idFlows('_');
    const source = 'Task_zahlungseingangsbestaetigungen_pruefen_und_buchen';
    const registry = new IdRegistry();
    const flows = ['Task_zahlungseingang_2', 'Task_zahlungseingang_2_2', 'Task_zahlungseingang_2_2'].map((target) => {
      const req = connectionRequest('bpmn:SequenceFlow', source, target);
      const out = pair.next(req, registry);
      registry.claim(out.id);
      return { ...out, req };
    });
    // before: the flow to _2_2 wanted the id of the flow to _2 (its inner _2 given up) and took _2_2, the next _2_3,
    // each with W_ID_SUFFIXED; now the source gives up more, inside its one word where nothing else is left
    expect(flows.map((flowCase) => flowCase.id)).toEqual([
      'Flow_Task_zahlungseingangsbestaetigungen_Task_zahlungseingang_2',
      'Flow_Task_zahlungseingangsbestaetigunge_Task_zahlungseingang_2_2',
      'Flow_Task_zahlungseingangsbestaetigun_Task_zahlungseingang_2_2_2',
    ]);
    expect(flows.map((flowCase) => flowCase.id === flowCase.base)).toEqual([true, true, false]);
    for (const flowCase of flows) expect(pair.derivedBases(flowCase.req).some((derivedBase) => flowCase.id === derivedBase || (flowCase.id.startsWith(derivedBase) && /^_\d+$/.test(flowCase.id.slice(derivedBase.length)))), flowCase.id).toBe(true);
    // a target x_2_2 behind a long source: _2 follows the base (before: the base was ..._und_Task_x_2_2, whose cut for
    // _2 gave the base back, so the flows took _2_3, _2_4)
    const ids = new IdRegistry();
    const given: string[] = [];
    for (let index = 0; index < 3; index++) {
      const { id } = pair.next(connectionRequest('bpmn:SequenceFlow', source, 'Task_x_2_2'), ids);
      ids.claim(id);
      given.push(id);
    }
    expect(given).toEqual(['Flow_Task_zahlungseingangsbestaetigungen_pruefen_Task_x_2_2', 'Flow_Task_zahlungseingangsbestaetigungen_pruefen_Task_x_2_2_2', 'Flow_Task_zahlungseingangsbestaetigungen_pruefen_Task_x_2_2_3']);
    // only numbers before a number tail stay: a number a cut leaves at the end of an end without one still goes (as before)
    expect(pair.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Task_synchronisieren_10_of_und_protokollieren_bestellungen_eingegangen', 'Task_lieferantenbestellungsuebersicht_x'))).toBe('Flow_Task_synchronisieren_Task_lieferantenbestellungsuebersicht');
    expect(pair.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Task_versenden_versenden_2_10_auftrag', 'Task_kunde_und_the_of_pruefen_rechnung_eingegangen'))).toBe('Flow_Task_versenden_versenden_2_10_Task_kunde_und_the_of_pruefen');
    // an element body that the 64-character cap ends on a number skips the suffix its cut gives back: a shorter cut would
    // read as another name's id (never <prefix>_auftrag_2 for the second Auftrag 2 2, which pushed Auftrag 2 to _2_4,
    // nor <prefix>_step_kunde_2 for the second Step Kunde Kunde 2 freigeben)
    const task = kindByName('task')!;
    const long = 'orderFulfilmentProcessTaskWithAVeryLongPrefixNameForTestingXYZ';
    const repeated = async (prefix: string, names: string[]): Promise<string[]> => {
      const style = IdStyle.infer((await Doc.fromXml(definitionsXml(['check_order', 'ship_order', 'bill_order'].map((taskName) => `<bpmn:task id="${prefix}_${taskName}" name="${taskName.replace('_', ' ')}" />`).join('\n')))).definitions);
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
    // camel bodies, hashed flows: named flows with camelCase sources
    const xml = definitionsXml(`
    <bpmn:startEvent id="Event_go" name="Go"><bpmn:outgoing>Flow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_checkOrder" name="Check order"><bpmn:incoming>Flow_0a1b2c3</bpmn:incoming><bpmn:outgoing>Flow_1x2y3z4</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_shipOrder" name="Ship order"><bpmn:incoming>Flow_1x2y3z4</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_0a1b2c3" sourceRef="Event_go" targetRef="Activity_checkOrder" />
    <bpmn:sequenceFlow id="Flow_1x2y3z4" sourceRef="Activity_checkOrder" targetRef="Activity_shipOrder" />`);
    const style = IdStyle.infer((await Doc.fromXml(xml)).definitions);
    const flow = (sourceLabel: string, targetLabel: string): string => style.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    expect(flow('URL PDF versenden', 'Ship')).toBe('Flow_urlPDFVersendenToShip');
    // the ends begin alike: the source gives up its first word, and the rest reads as above (not urlpdfVersenden)
    // (the target's 40 characters end before the filler word: before ...PruefenUnd)
    expect(flow('Lieferantenbestellungen URL PDF versenden', 'Lieferantenbestellungen prüfen und abschließen')).toBe('Flow_urlPDFVersendenToLieferantenbestellungenPruefen');
    // also where camelSlug cut the name at 40 characters, so that the end is a run of its middle words
    expect(flow('Lieferantenbestellungen URL PDF versenden und archivieren', 'Lieferantenbestellungen prüfen und abschließen')).toBe('Flow_urlPDFVersendenToLieferantenbestellungenPruefen');
  });

  it('#31: a very long file prefix gives way to the bpmn-cli prefix rather than pass 64 characters', async () => {
    const prefix = 'orderFulfilmentProcessTaskWithAVeryLongPrefixNameForTestin';
    const xml = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="${prefix}_checkOrder" name="Check order"><bpmn:incoming>flow_goToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="${prefix}_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="flow_goToCheckOrder" sourceRef="startEvent_go" targetRef="${prefix}_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="${prefix}_checkOrder" targetRef="${prefix}_shipOrder" />`);
    // 0.6: ${prefix}_auftrag (66 characters) and ${prefix}_2
    const applied = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Auftrag', after: `${prefix}_shipOrder`, as: '$a' }, { op: 'add', kind: 'task', name: 'Auftrag', after: '$a', as: '$b' }], { layout: false });
    expect(applied.result.aliases).toMatchObject({ $a: 'activity_auftrag', $b: 'activity_auftrag_2' });
    for (const id of ids(applied.xml)) if (!id.startsWith(`${prefix}_`)) expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
    // an id that names an anchor's kind stays within 64 too (a prefix of 50 characters)
    const style = IdStyle.infer((await Doc.fromXml(xml.replaceAll(prefix, prefix.slice(0, 50)))).definitions);
    const registry = new IdRegistry();
    const task = kindByName('task')!;
    for (let index = 0; index < 3; index++) {
      const { id } = style.next(kindRequest(task, { context: 'On 2', anchorKind: 'ServiceTask' }), registry);
      registry.claim(id);
      expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
    }
    // a flow prefix (and a scope) that leaves the ends fewer than 16 characters gives way to a named flow with Flow_, in
    // every flow form (before: stemTo <prefix>_To, both ends empty; a scopedTo Flow_<scope>_To of 65 characters)
    const flowPrefix = 'sequenceFlowOfTheKundenauftragsabwicklungUndLieferantenbestellu';
    const tasks = ['check_stock', 'ship_goods', 'bill_customer'];
    const forms: Array<[string, (source: string, target: string) => string, (word: string) => string]> = [
      ['stemTo', (source, target) => `${source}To${target.charAt(0).toUpperCase()}${target.slice(1)}`, (word) => word.replace(/_(\w)/g, (_m, letter: string) => letter.toUpperCase())],
      ['stemSnake', (source, target) => `${source}_to_${target}`, (word) => word],
      ['idPair', (source, target) => `Task_${source}_Task_${target}`, (word) => word],
      ['idSnake', (source, target) => `Task_${source}_to_Task_${target}`, (word) => word],
    ];
    for (const prefixLength of [48, 56, 63]) {
      for (const [form, flowBody, body] of forms) {
        const cutPrefix = flowPrefix.slice(0, prefixLength);
        const xmlOf = (prefix: string): string =>
          definitionsXml(
            tasks.map((word) => `<bpmn:task id="Task_${body(word)}" name="${word.replace('_', ' ')}" />`).join('\n') +
              `<bpmn:sequenceFlow id="${prefix}_${flowBody(body(tasks[0]!), body(tasks[1]!))}" sourceRef="Task_${body(tasks[0]!)}" targetRef="Task_${body(tasks[1]!)}" />` +
              `<bpmn:sequenceFlow id="${prefix}_${flowBody(body(tasks[1]!), body(tasks[2]!))}" sourceRef="Task_${body(tasks[1]!)}" targetRef="Task_${body(tasks[2]!)}" />`,
          );
        const long = IdStyle.infer((await Doc.fromXml(xmlOf(cutPrefix))).definitions);
        expect(long.info().sequenceFlow, `${form} ${prefixLength}`).toEqual({ form, prefix: cutPrefix });
        const req = connectionRequest('bpmn:SequenceFlow', `Task_${body('validate_order_lines')}`, `Task_${body('receive_incoming_payment')}`);
        const id = long.derivedBase(req);
        expect(id, `${form} ${prefixLength}`).toMatch(/^Flow_(validate|Validate)/);
        expect(id.length).toBeLessThanOrEqual(MAX_ID);
        // short ends fit beside a prefix of 48 characters at whole words: the prefix stays (before: Flow_ for every flow)
        const short = long.derivedBase(connectionRequest('bpmn:SequenceFlow', `Task_${body('pack_it')}`, `Task_${body('ship_it')}`));
        // (idPair / idSnake: the ends' own prefixes leave their words no room)
        const kept: Record<string, string> = { stemTo: `${cutPrefix}_packItToShipIt`, stemSnake: `${cutPrefix}_pack_to_ship_it` };
        expect(short, `${form} ${prefixLength}`).toBe((prefixLength === 48 && kept[form]) || (form === 'stemTo' ? 'Flow_packItToShipIt' : 'Flow_pack_it_to_ship_it'));
      }
    }
    const scope = 'KundenauftragsabwicklungUndLieferantenbestellungsprozessX';
    const scopedTask = (word: string): string => `task_${scope}_${word}`;
    const scoped = definitionsXml(`
    <bpmn:task id="${scopedTask('Validate')}" name="Validate" />
    <bpmn:task id="${scopedTask('Reserve')}" name="Reserve" />
    <bpmn:task id="${scopedTask('Ship')}" name="Ship" />
    <bpmn:sequenceFlow id="Flow_${scope}_ValidateToReserve" sourceRef="${scopedTask('Validate')}" targetRef="${scopedTask('Reserve')}" />
    <bpmn:sequenceFlow id="Flow_${scope}_ReserveToShip" sourceRef="${scopedTask('Reserve')}" targetRef="${scopedTask('Ship')}" />`);
    const scopedApplied = await applyToXml(scoped, [{ op: 'connect', source: scopedTask('Validate'), target: scopedTask('Ship') }, { op: 'connect', source: scopedTask('Validate'), target: scopedTask('Ship') }], { layout: false });
    // named by the end words in the case of the file's bodies (Pascal_Snake: <scope>_Validate)
    expect(flowIds(scopedApplied.xml).filter((id) => !id.includes(scope))).toEqual(['Flow_Validate_To_Ship', 'Flow_Validate_To_Ship_2']);
  });

  it('a body keeps a letter in a small room; a file prefix over 52 characters stays where the body\'s first word with a letter fits whole beside it', async () => {
    // a room that ends inside a leading number: the cut starts at the first word with a letter (before: 10202422024)
    expect(cutAt('10202422024Rechnung', 11)).toBe('Rechnung');
    expect(cutAt('10202422024Rechnung', 6)).toBe('Rechnu');
    expect(cutAt('2024_100_rechnung_pruefen', 9)).toBe('rechnung');
    // a cut that keeps a letter is unchanged
    expect(cutAt('10202422024Rechnung', 12)).toBe('10202422024R');
    const task = kindByName('task')!;
    const names = ['10202422024 Rechnung', '2024 100 Rechnung', '2024 100 Rechnung', 'Auftrag', 'Auftrag', 'Gh'];
    const idsUnder = async (prefix: string): Promise<string[]> => {
      const style = IdStyle.infer((await Doc.fromXml(definitionsXml(['checkOrder', 'shipOrder', 'billOrder'].map((taskName) => `<bpmn:task id="${prefix}_${taskName}" name="${taskName}" />`).join('\n')))).definitions);
      const registry = new IdRegistry();
      return names.map((name) => {
        const { id } = style.next(kindRequest(task, { name }), registry);
        registry.claim(id);
        expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
        return id.startsWith(prefix) ? `<prefix>${id.slice(prefix.length)}` : id;
      });
    };
    const long = 'orderFulfilmentProcessTaskWithAVeryLongPrefixNameForTestingXYZ';
    // 52 characters (before: <prefix>_10202422024, no letter); a camelCase body that lost its number begins in lower case
    expect(await idsUnder(long.slice(0, 52))).toEqual(['<prefix>_rechnung', '<prefix>_2024100Rech', '<prefix>_2024100Re_2', '<prefix>_auftrag', '<prefix>_auftrag_2', '<prefix>_gh']);
    // 53 (before: <prefix>_1020242202, <prefix>_2024100Rec, <prefix>_2024100R_2)
    expect(await idsUnder(long.slice(0, 53))).toEqual(['activity_10202422024Rechnung', 'activity_2024100Rechnung', 'activity_2024100Rechnung_2', '<prefix>_auftrag', '<prefix>_auftrag_2', '<prefix>_gh']);
    // 55 (before: <prefix>_202410_2 without a letter, <prefix>_auftra_2): the suffix leaves Auftrag no room beside the prefix
    expect(await idsUnder(long.slice(0, 55))).toEqual(['activity_10202422024Rechnung', 'activity_2024100Rechnung', 'activity_2024100Rechnung_2', '<prefix>_auftrag', 'activity_auftrag_2', '<prefix>_gh']);
    // 56 and more (before: activity_ for every id): the file's prefix where the id fits (Gh, 59 characters)
    expect(await idsUnder(long.slice(0, 56))).toEqual(['activity_10202422024Rechnung', 'activity_2024100Rechnung', 'activity_2024100Rechnung_2', '<prefix>_auftrag', 'activity_auftrag_2', '<prefix>_gh']);
    expect(await idsUnder(long.slice(0, 62))).toEqual(['activity_10202422024Rechnung', 'activity_2024100Rechnung', 'activity_2024100Rechnung_2', 'activity_auftrag', 'activity_auftrag_2', 'activity_gh']);
    // a filler word is no first word to keep the prefix for (not <prefix>_the)
    const style = IdStyle.infer((await Doc.fromXml(definitionsXml(['checkOrder', 'shipOrder'].map((taskName) => `<bpmn:task id="${long.slice(0, 56)}_${taskName}" name="${taskName}" />`).join('\n')))).definitions);
    expect(style.derivedBase(kindRequest(task, { name: 'The archive' }))).toBe('activity_theArchive');
    // nor is the context word of an unnamed element: its id names the anchor (not <prefix>_after, <prefix>_after_2, ...
    // with W_ID_SUFFIXED, from 56 characters on; before the bpmn-cli prefix also <prefix>_after at 54 and 55)
    const unnamed = async (prefixLength: number): Promise<{ ids: string[]; suffixed: number }> => {
      const cutPrefix = long.slice(0, prefixLength);
      const xml = definitionsXml(['checkOrder', 'shipOrder', 'billOrder'].map((taskName) => `<bpmn:task id="${cutPrefix}_${taskName}" name="${taskName}" />`).join('\n'));
      const applied = await applyToXml(xml, ['checkOrder', 'shipOrder', 'billOrder'].map((taskName) => ({ op: 'add', kind: 'task', after: `${cutPrefix}_${taskName}` })), { layout: false });
      const ids = applied.result.created.filter((created) => created.kind === 'task').map((created) => (created.id.startsWith(cutPrefix) ? `<prefix>${created.id.slice(cutPrefix.length)}` : created.id));
      return { ids, suffixed: applied.result.warnings.added.filter((warning) => warning.code === 'W_ID_SUFFIXED').length };
    };
    for (const prefixLength of [55, 56, 58]) expect(await unnamed(prefixLength), String(prefixLength)).toEqual({ ids: ['activity_afterCheckOrder', 'activity_afterShipOrder', 'activity_afterBillOrder'], suffixed: 0 });
    // where the anchor's first word fits, the prefix stays, per id
    expect(await unnamed(54)).toEqual({ ids: ['activity_afterCheckOrder', '<prefix>_afterShip', '<prefix>_afterBill'], suffixed: 0 });
    expect(await unnamed(53)).toEqual({ ids: ['<prefix>_afterCheck', '<prefix>_afterShip', '<prefix>_afterBill'], suffixed: 0 });
  });

  /** A style learned from a file whose flows are `Flow_<sourceId><join><targetId>` (idPair `_`, idSnake `_to_`). */
  async function idFlows(join: string): Promise<IdStyle> {
    const pairs = [['Task_a1', 'Task_a2'], ['Task_a2', 'Task_a3'], ['Task_a3', 'Task_a4']] as const;
    const tasks = ['Task_a1', 'Task_a2', 'Task_a3', 'Task_a4'].map((id) => `<bpmn:task id="${id}" />`).join('\n');
    const flows = pairs.map(([source, target]) => `<bpmn:sequenceFlow id="Flow_${source}${join}${target}" sourceRef="${source}" targetRef="${target}" />`).join('\n');
    return IdStyle.infer((await Doc.fromXml(definitionsXml(`${tasks}\n${flows}`))).definitions);
  }

  it('#31: a cut keeps a Join and number tail and the first word before a number, the source gives up a word on a tie, a leading separator stays', async () => {
    const flow = (source: string, target: string, labels: { sourceLabel?: string; targetLabel?: string } = {}): string => IdStyle.DEFAULT.derivedBase(connectionRequest('bpmn:SequenceFlow', source, target, labels));
    // ends that begin alike: the join of a split and its number stay whole, the word before them goes
    expect(flow('Gateway_LieferantenbestellungenPruefenJoin_2', 'Activity_LieferantenbestellungenArchivierenSofort')).toBe('Flow_LieferantenbestellungenJoin2ToLieferantenbestellungenSofort');
    // the Join is no word with a letter the end could keep instead of its last one: never a bare Join (before this fix:
    // Flow_JoinToLieferantenbestellungenBuchenUndAnDie, Flow_2JoinToWarenwirtschaftssystemabgleich)
    const joined = await applyToXml((await newXml({ processName: 'J' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_J', as: '$s' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellungen prüfen', after: '$s', as: '$t' },
      { op: 'split', after: '$t', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }], joinAs: '$j' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellungen buchen lassen und melden', after: '$j' },
    ]);
    // (the target's 40 characters end before the filler word: LieferantenbestellungenBuchenLassen, before ...LassenUnd)
    expect(flowIds(joined.xml)).toContain('Flow_LieferantenbestellungenJoinToLieferantenbestellungenLassen');
    expect(flow('Activity_A', 'Activity_B', { sourceLabel: '2 Lieferantenbestellungen Join', targetLabel: 'Warenwirtschaftssystemabgleich' })).toBe('Flow_2LieferantenbestellungenJoinToWarenwirtschaftssystemabgleic');
    // an end never shrinks to a number: its first word stays, the other end gives up its own
    expect(flow('Activity_A', 'Activity_B', { sourceLabel: 'Lieferantenbestellungsabwicklung 10', targetLabel: 'Lieferantenbestellungsabwicklung ok' })).toBe('Flow_Lieferantenbestellungsabwicklung10ToOk');
    // ends of 29 characters each, one word too long: the source gives it up
    expect(flow('Activity_A', 'Activity_B', { sourceLabel: 'Eingangsrechnung pruefen lassen', targetLabel: 'Lieferschein scannen und ablegen' })).toBe('Flow_EingangsrechnungPruefenToLieferscheinScannenUndAblegen');
    // an end whose words begin with a separator (Task__eingangsrechnung...) keeps it when it gives up a later word
    const style = await idFlows('_');
    expect(style.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Task_a1', 'Task_a2'))).toBe('Flow_Task_a1_Task_a2');
    expect(style.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Task__eingangsrechnung_pruefen_lassen', 'Task__lieferschein_scannen_ablegen'))).toBe('Flow_Task__eingangsrechnung_pruefen_Task__lieferschein_scannen');
  });

  it('a cut never ends on a filler word (und, an, die): the ends of a flow and the 40 characters of a name give it up too, never the first word', async () => {
    const flow = (sourceLabel: string, targetLabel: string): string => IdStyle.DEFAULT.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Activity_A', 'Activity_B', { sourceLabel, targetLabel }));
    // before: Flow_LieferungVersendenUndToRechnungEingegangenUndZahlungPruefen
    expect(flow('Lieferung versenden und Kunde informieren', 'Rechnung eingegangen und Zahlung prüfen')).toBe('Flow_LieferungVersendenUndKundeToRechnungEingegangenUndZahlung');
    // before: Flow_LieferungAnKundenToRechnungAnBuchhaltungWeiterleitenUnd
    expect(flow('Lieferung an Kunden versenden', 'Rechnung an Buchhaltung weiterleiten und prüfen')).toBe('Flow_LieferungAnKundenToRechnungAnBuchhaltungWeiterleiten');
    // a name that ends on one is the author's: an end that is not cut keeps it
    expect(flow('Ware prüfen und', 'Lieferantenbestellungsübersicht aktualisieren oder abschließen')).toBe('Flow_WarePruefenUndToLieferantenbestellungsuebersicht');
    // idPair (before: Flow_Task_lieferung_versenden_und_Task_rechnung_eingegangen_und): of the cuts that fit, the most words
    const pair = await idFlows('_');
    expect(pair.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Task_lieferung_versenden_und_pruefen', 'Task_rechnung_eingegangen_und_abgleichen'))).toBe('Flow_Task_lieferung_Task_rechnung_eingegangen_und_abgleichen');
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
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Filler', as: '$s' },
      { op: 'add', kind: 'task', name: 'Lieferantenbestellung versenden und Zahlungseingang prüfen', after: '$s', as: '$t' },
    ], { layout: false });
    expect(applied.result.aliases).toMatchObject({ $t: 'Activity_LieferantenbestellungVersenden' });
    expect(flowIds(applied.xml)).toEqual(['Flow_GoToLieferantenbestellungVersenden']);
  });

  it("#31: a flow named by its ends' ids keeps each id's prefix, the words after it share the room", async () => {
    const pair = await idFlows('_');
    // other prefixes, words that begin alike (the unnamed elements after one anchor): each end keeps its last word
    expect(pair.derivedBase(connectionRequest('bpmn:SequenceFlow', 'Gateway_after_check_order_and_invoice', 'Task_after_check_order_and_invoice_gateway'))).toBe('Flow_Gateway_after_check_invoice_Task_after_check_order_gateway');
    // random ends behind Task_, Gateway_ and Event_ (a third begin alike): every id within 64 characters, the uncut one
    // where it fits, else each end behind its own prefix with whole words of the ids, and the same id every time
    const vocabulary = ['auftrag', 'pruefen', 'lieferung', 'synchronisieren', 'bestellungen', 'rechnung', 'freigeben', 'kunde', 'protokollieren', 'eingegangen', 'versenden', 'und', 'an', 'archivieren', '2', '10'];
    const prefixes = ['Task', 'Gateway', 'Event'];
    let seed = 31;
    const pick = (bound: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % bound;
    };
    const name = (head?: string): string => {
      const words = [head ?? vocabulary[pick(vocabulary.length - 2)]!];
      for (let remaining = pick(6); remaining > 0; remaining--) words.push(vocabulary[pick(vocabulary.length)]!);
      return snakeSlug(words.join(' '));
    };
    for (const [join, style] of [['_', pair], ['_to_', await idFlows('_to_')]] as const) {
      expect(style.info().sequenceFlow.form).toBe(join === '_' ? 'idPair' : 'idSnake');
      for (let index = 0; index < 1000; index++) {
        const [sp, tp] = [prefixes[pick(3)]!, prefixes[pick(3)]!];
        const sourceName = name();
        const [source, target] = [`${sp}_${sourceName}`, `${tp}_${pick(3) === 0 ? name(sourceName.split('_')[0]) : name()}`];
        const id = style.derivedBase(connectionRequest('bpmn:SequenceFlow', source, target));
        const uncut = `Flow_${source}${join}${target}`;
        expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
        if (uncut.length <= MAX_ID) expect(id).toBe(uncut);
        else {
          const match = new RegExp(`^Flow_${sp}_([a-z0-9_]+)${join}${tp}_([a-z0-9_]+)$`).exec(id);
          expect(match, id).not.toBeNull();
          const known = new Set([...idWords(source), ...idWords(target)].map((word) => word.replace(/^_/, '')));
          for (const word of idWords(`${match![1]}_${match![2]}`)) expect(known, `${word} in ${id}`).toContain(word.replace(/^_/, ''));
        }
        expect(style.derivedBase(connectionRequest('bpmn:SequenceFlow', source, target))).toBe(id);
      }
    }
  });

  it('#31: flows the cap cut still vote for their form: a file of idPair flows keeps it, and every splice renames its flow', async () => {
    const nodes = [
      ['startEvent', 'Event_Start', 'Start'],
      ['task', 'Activity_CheckOrder', 'Check order'],
      ['task', 'Activity_ShipOrder', 'Ship order'],
      ['endEvent', 'Event_Done', 'Done'],
    ] as const;
    const flow = (index: number): string => `Flow_${nodes[index]![1]}_${nodes[index + 1]![1]}`;
    let xml = definitionsXml(
      nodes.map(([tag, id, name], index) => `<bpmn:${tag} id="${id}" name="${name}">${index ? `<bpmn:incoming>${flow(index - 1)}</bpmn:incoming>` : ''}${index < 3 ? `<bpmn:outgoing>${flow(index)}</bpmn:outgoing>` : ''}</bpmn:${tag}>`).join('\n') +
        [0, 1, 2].map((index) => `<bpmn:sequenceFlow id="${flow(index)}" sourceRef="${nodes[index]![1]}" targetRef="${nodes[index + 1]![1]}" />`).join('\n'),
    );
    const checkPayments = 'Activity_ZahlungseingaengePruefenUndAbgleichen';
    const steps: Array<[string, string]> = [
      ['Zahlungseingänge prüfen und abgleichen', 'Activity_ShipOrder'],
      ...['Lieferantenbestellungen archivieren', 'Rechnung buchen', 'Lieferschein drucken', 'Kundenstammdaten aktualisieren', 'Bestellung stornieren', 'Mahnung versenden'].map((name): [string, string] => [name, checkPayments]),
    ];
    for (const [name, after] of steps) {
      // before: the 7th splice found the style flipped to named (5 of 9 flows cut), renamed nothing and named its flow
      // Flow_MahnungVersendenToBestellungStornieren
      expect((await Doc.fromXml(xml)).idStyle.info().sequenceFlow, name).toEqual({ form: 'idPair', prefix: 'Flow' });
      const applied = await applyToXml(xml, [{ op: 'add', kind: 'task', name, after }], { layout: false });
      expect(Object.keys(applied.result.renamed ?? {}), name).toHaveLength(1);
      xml = applied.xml;
    }
    expect(flowIds(xml)).toEqual(expect.arrayContaining(['Flow_Activity_ZahlungseingaengePruefen_Activity_MahnungVersenden', 'Flow_Activity_MahnungVersenden_Activity_BestellungStornieren']));
    for (const id of flowIds(xml)) expect(id.length, id).toBeLessThanOrEqual(MAX_ID);
    // a camelCase file whose flows read as stemTo (the cut ones now too) still follows the `named` flows bpmn-cli gave it
    // before: a flow to a join is named by the join's label (CheckOrderJoin), not by its id stem
    const camel = definitionsXml(`
    <bpmn:task id="Activity_checkOrder" name="Check order"><bpmn:outgoing>Flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_shipOrder" name="Ship order"><bpmn:incoming>Flow_checkOrderToShipOrder</bpmn:incoming><bpmn:outgoing>Flow_shipOrderToBillOrder</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_billOrder" name="Bill order"><bpmn:incoming>Flow_shipOrderToBillOrder</bpmn:incoming><bpmn:outgoing>Flow_billOrderToCheckOrderJoin</bpmn:outgoing></bpmn:task>
    <bpmn:parallelGateway id="Gateway_afterCheckOrderJoin"><bpmn:incoming>Flow_billOrderToCheckOrderJoin</bpmn:incoming></bpmn:parallelGateway>
    <bpmn:sequenceFlow id="Flow_checkOrderToShipOrder" sourceRef="Activity_checkOrder" targetRef="Activity_shipOrder" />
    <bpmn:sequenceFlow id="Flow_shipOrderToBillOrder" sourceRef="Activity_shipOrder" targetRef="Activity_billOrder" />
    <bpmn:sequenceFlow id="Flow_billOrderToCheckOrderJoin" sourceRef="Activity_billOrder" targetRef="Gateway_afterCheckOrderJoin" />`);
    expect((await Doc.fromXml(camel)).idStyle.info().sequenceFlow).toEqual({ form: 'stemTo', prefix: 'Flow' });
    const spliced = await applyToXml(camel, [{ op: 'add', kind: 'task', name: 'Archive order', flow: 'Flow_billOrderToCheckOrderJoin' }], { layout: false });
    expect(spliced.result.renamed).toEqual({ Flow_billOrderToCheckOrderJoin: 'Flow_billOrderToArchiveOrder' });
  });

  it('#31: flows 0.6 named still follow their ends where the file now reads as another form, also as 0.6 cut them', async () => {
    /** a chain of tasks ([id, name]) joined by the given flows */
    const chainXml = (tasks: Array<[string, string]>, flows: string[]): string =>
      definitionsXml(
        tasks.map(([id, name], index) => `<bpmn:task id="${id}" name="${name}">${index ? `<bpmn:incoming>${flows[index - 1]}</bpmn:incoming>` : ''}${index < flows.length ? `<bpmn:outgoing>${flows[index]}</bpmn:outgoing>` : ''}</bpmn:task>`).join('\n') +
          flows.map((id, index) => `<bpmn:sequenceFlow id="${id}" sourceRef="${tasks[index]![0]}" targetRef="${tasks[index + 1]![0]}" />`).join('\n'),
      );
    // an idPair file 0.6 read as `named` once it had cut three of its flows, and gave two named flows; the cut ones vote
    // for idPair again (before: Flow_PackOrderToArchiveOrder kept its id on the flow to Activity_WeighParcel)
    const idPair = chainXml(
      [
        ['Activity_CheckOrder', 'Check order'],
        ['Activity_ShipOrder', 'Ship order'],
        ['Activity_BillOrder', 'Bill order'],
        ['Activity_ZahlungseingangsbestaetigungenPruefen', 'Zahlungseingangsbestaetigungen pruefen'],
        ['Activity_Lieferantenbestellungsuebersicht', 'Lieferantenbestellungsuebersicht erstellen'],
        ['Activity_KundenstammdatenaktualisierungAnstossen', 'Kundenstammdatenaktualisierung anstossen'],
        ['Activity_PackOrder', 'Pack order'],
        ['Activity_ArchiveOrder', 'Archive order'],
      ],
      ['Flow_Activity_CheckOrder_Activity_ShipOrder', 'Flow_Activity_ShipOrder_Activity_BillOrder', 'Flow_Activity_BillOrder_ActivityPruefen', 'Flow_Activity_ZahlungseingangsbestaetigungenPruefen_Activity', 'Flow_Activity_ActivityAnstossen', 'Flow_KundenstammdatenaktualisierungAnstossenToPackOrder', 'Flow_PackOrderToArchiveOrder'],
    );
    expect((await Doc.fromXml(idPair)).idStyle.info().sequenceFlow).toEqual({ form: 'idPair', prefix: 'Flow' });
    const pack = await applyToXml(idPair, [{ op: 'add', kind: 'task', name: 'Weigh parcel', after: 'Activity_PackOrder' }], { layout: false });
    expect(pack.result.renamed).toEqual({ Flow_PackOrderToArchiveOrder: 'Flow_Activity_PackOrder_Activity_WeighParcel' });
    const before = await applyToXml(idPair, [{ op: 'add', kind: 'task', name: 'Weigh parcel', flow: 'Flow_KundenstammdatenaktualisierungAnstossenToPackOrder' }], { layout: false });
    expect(Object.keys(before.result.renamed ?? {})).toEqual(['Flow_KundenstammdatenaktualisierungAnstossenToPackOrder']);
    // an idSnake file with a flow 0.6 named (Flow_pay_to_done)
    const idSnake = chainXml(
      [['Task_check', 'Check'], ['Task_ship', 'Ship'], ['Task_bill', 'Bill'], ['Task_pay', 'Pay'], ['Task_done', 'Done']],
      ['Flow_Task_check_to_Task_ship', 'Flow_Task_ship_to_Task_bill', 'Flow_Task_bill_to_Task_pay', 'Flow_pay_to_done'],
    );
    expect((await Doc.fromXml(idSnake)).idStyle.info().sequenceFlow).toEqual({ form: 'idSnake', prefix: 'Flow' });
    const log = await applyToXml(idSnake, [{ op: 'add', kind: 'task', name: 'Log', flow: 'Flow_pay_to_done' }], { layout: false });
    expect(log.result.renamed).toEqual({ Flow_pay_to_done: 'Flow_Task_pay_to_Task_log' });
    // a camelCase file that reads as stemTo, with flows 0.6 named and cut at 61 characters to an end with a suffix
    // (before: both kept their ids)
    const stem = chainXml(
      [
        ['Activity_checkOrder', 'Check order'],
        ['Activity_shipOrder', 'Ship order'],
        ['Activity_billOrder', 'Bill order'],
        ['Activity_lieferantenbestellungsuebersicht', 'Lieferantenbestellungsuebersicht erstellen'],
        ['Activity_lieferantenbestellungsuebersicht_2', 'Lieferantenbestellungsuebersicht erstellen'],
        ['Activity_kundenstammdatenaktualisierungAnstossen', 'Kundenstammdatenaktualisierung anstossen'],
      ],
      ['Flow_checkOrderToShipOrder', 'Flow_shipOrderToBillOrder', 'Flow_billOrderToLieferantenbestellungsuebersicht', 'Flow_lieferantenbestellungsueberToLieferantenbestellungsuebe2', 'Flow_lieferantenbestellungsuebe2ToKundenstammdatenaktualisier'],
    );
    expect((await Doc.fromXml(stem)).idStyle.info().sequenceFlow).toEqual({ form: 'stemTo', prefix: 'Flow' });
    const weigh = await applyToXml(
      stem,
      [
        { op: 'add', kind: 'task', name: 'Weigh parcel', after: 'Activity_lieferantenbestellungsuebersicht' },
        { op: 'add', kind: 'task', name: 'Scan', after: 'Activity_lieferantenbestellungsuebersicht_2' },
      ],
      { layout: false },
    );
    expect(weigh.result.renamed).toEqual({
      Flow_lieferantenbestellungsueberToLieferantenbestellungsuebe2: 'Flow_lieferantenbestellungsuebersichtToWeighParcel',
      Flow_lieferantenbestellungsuebe2ToKundenstammdatenaktualisier: 'Flow_lieferantenbestellungsuebersicht_2ToScan',
    });
    // an id an author wrote in the `named` form follows too: nothing tells it from one bpmn-cli wrote (ID_CONVENTIONS.renames)
    const handWritten = definitionsXml(`
    <bpmn:startEvent id="start_event_order_received" name="Order received"><bpmn:outgoing>flow_eventOrderReceivedToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="serviceTask_checkOrder" name="Check order"><bpmn:incoming>flow_eventOrderReceivedToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="serviceTask_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming><bpmn:outgoing>flow_shipOrderToOrderShipped</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_orderShipped" name="Order shipped"><bpmn:incoming>flow_shipOrderToOrderShipped</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_eventOrderReceivedToCheckOrder" sourceRef="start_event_order_received" targetRef="serviceTask_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="serviceTask_checkOrder" targetRef="serviceTask_shipOrder" />
    <bpmn:sequenceFlow id="flow_shipOrderToOrderShipped" sourceRef="serviceTask_shipOrder" targetRef="endEvent_orderShipped" />`);
    expect((await Doc.fromXml(handWritten)).idStyle.info().sequenceFlow).toEqual({ form: 'stemTo', prefix: 'flow' });
    const gate = await applyToXml(handWritten, [{ op: 'add', kind: 'serviceTask', name: 'Check gate', after: 'start_event_order_received' }], { layout: false });
    expect(gate.result.renamed).toEqual({ flow_eventOrderReceivedToCheckOrder: 'flow_event_order_receivedToCheckGate' });
    expect(ID_CONVENTIONS.renames).toMatch(/or the one any other flow prefix or form the file's flows use gives it, also the named Flow_<Source>To<Target> id in the file's case, which earlier versions gave its flows, whoever wrote it/);
  });

  it('#31: a long head stays where the ends fit beside it at whole words, Flow_ elsewhere; a flow 0.6 named with it still follows its ends', async () => {
    // a scope of 41 characters leaves the ends fewer than 16: new flows keep it where the end words fit beside it (before:
    // Flow_Validate_To_Pack for every new flow), else Flow_<Source>_To_<Target>; a flow with the scope still names its ends
    // (before #31: the 65-character flow below kept its id on the flow to Pack)
    const scope = 'KundenauftragsabwicklungLieferantenpflege';
    const task = (word: string): string => `serviceTask_${scope}_${word}`;
    const xml = definitionsXml(`
    <bpmn:serviceTask id="${task('Validate')}" name="Validate"><bpmn:outgoing>Flow_${scope}_ValidateToShipping</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${task('Shipping')}" name="Shipping"><bpmn:incoming>Flow_${scope}_ValidateToShipping</bpmn:incoming><bpmn:outgoing>Flow_${scope}_ShippingToInvoicing</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${task('Invoicing')}" name="Invoicing"><bpmn:incoming>Flow_${scope}_ShippingToInvoicing</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_${scope}_ValidateToShipping" sourceRef="${task('Validate')}" targetRef="${task('Shipping')}" />
    <bpmn:sequenceFlow id="Flow_${scope}_ShippingToInvoicing" sourceRef="${task('Shipping')}" targetRef="${task('Invoicing')}" />`);
    expect((await Doc.fromXml(xml)).idStyle.info().sequenceFlow).toEqual({ form: 'scopedTo', prefix: 'Flow', scope });
    const applied = await applyToXml(xml, [{ op: 'add', kind: 'serviceTask', name: 'Pack', after: task('Validate') }], { layout: false });
    expect(applied.result.renamed).toEqual({ [`Flow_${scope}_ValidateToShipping`]: `Flow_${scope}_ValidateToPack` });
    expect(flowIds(applied.xml)).toContain(`Flow_${scope}_PackToShipping`);
    // end words that do not fit beside the scope: a named flow with Flow_, by its end words
    const long = await applyToXml(applied.xml, [
      { op: 'add', kind: 'serviceTask', id: task('Warenwirtschaftssystemabgleich'), name: 'Warenwirtschaftssystemabgleich', in: 'Process_1' },
      { op: 'connect', source: task('Validate'), target: task('Warenwirtschaftssystemabgleich') },
    ], { layout: false });
    expect(flowIds(long.xml)).toContain('Flow_Validate_To_Warenwirtschaftssystemabgleich');
    // both follow their ends
    const spliced = await applyToXml(long.xml, [
      { op: 'add', kind: 'serviceTask', name: 'Weigh', flow: `Flow_${scope}_PackToShipping` },
      { op: 'add', kind: 'serviceTask', name: 'Check', flow: 'Flow_Validate_To_Warenwirtschaftssystemabgleich' },
    ], { layout: false });
    expect(spliced.result.renamed).toEqual({ [`Flow_${scope}_PackToShipping`]: `Flow_${scope}_PackToWeigh`, Flow_Validate_To_Warenwirtschaftssystemabgleich: `Flow_${scope}_ValidateToCheck` });
    // the conventions view names the fallback
    const view = conventionsView(await Doc.fromXml(xml), undefined).rows.find((row) => row.kinds.includes('sequenceFlow'));
    expect(view).toMatchObject({ pattern: `Flow_${scope}_{SourceWord}To{TargetWord}`, note: 'Flow_ where the ends do not fit' });
    // a suffix that leaves the end words no room beside a 48-character scope: the named flow's `_2`, not the scoped glued 2
    const wide = `${scope}Abcdefg`;
    const style = IdStyle.infer((await Doc.fromXml(xml.replaceAll(scope, wide))).definitions);
    const registry = new IdRegistry();
    const given = [0, 1, 2].map(() => {
      const { id } = style.next(connectionRequest('bpmn:SequenceFlow', `serviceTask_${wide}_Pack`, `serviceTask_${wide}_Ship`), registry);
      registry.claim(id);
      return id;
    });
    expect(given).toEqual([`Flow_${wide}_PackToShip`, 'Flow_Pack_To_Ship_2', 'Flow_Pack_To_Ship_3']);
    expect(given[0]).toHaveLength(MAX_ID);
    // a base that ends in a digit, whose No2 leaves the end words no room beside the 41-character scope: the whole id
    // takes the named flow's form with its _2 (before: Flow_<scope>_ValidateToStep1_2, a form no file reads back)
    const steps = await applyToXml(xml, [
      { op: 'add', kind: 'serviceTask', id: task('Step1_Check'), name: 'Step 1 check', in: 'Process_1' },
      { op: 'add', kind: 'serviceTask', id: task('Step1_Ship'), name: 'Step 1 ship', in: 'Process_1' },
      { op: 'connect', source: task('Validate'), target: task('Step1_Check') },
      { op: 'connect', source: task('Validate'), target: task('Step1_Ship') },
    ], { layout: false });
    expect(flowIds(steps.xml).filter((id) => id.includes('Step1'))).toEqual([`Flow_${scope}_ValidateToStep1`, 'Flow_Validate_To_Step1_2']);
    // the same in a stemTo file with a 46-character prefix (before: <prefix>_stepToRechnung9_2)
    const lp = 'sequenceFlowOfTheKundenauftragsabwicklungUndLi';
    const stem = definitionsXml(
      ['checkOrder', 'shipOrder', 'billOrder', 'step', 'rechnung9'].map((id) => `<bpmn:task id="task_${id}" name="${id}" />`).join('\n') +
        `<bpmn:sequenceFlow id="${lp}_checkOrderToShipOrder" sourceRef="task_checkOrder" targetRef="task_shipOrder" />` +
        `<bpmn:sequenceFlow id="${lp}_shipOrderToBillOrder" sourceRef="task_shipOrder" targetRef="task_billOrder" />`,
    );
    const stemmed = await applyToXml(stem, [0, 1, 2].map(() => ({ op: 'connect', source: 'task_step', target: 'task_rechnung9' })), { layout: false });
    expect(flowIds(stemmed.xml).filter((id) => id.includes('Rechnung9'))).toEqual([`${lp}_stepToRechnung9`, 'Flow_stepToRechnung9_2', 'Flow_stepToRechnung9_3']);
  });

  it('#31: a suffix that cuts an anchor-qualified id again keeps the anchor kind', async () => {
    // a task prefix of 26 characters: the form that names the gateway has 64, its _2 is cut again
    const prefix = 'orderFulfilmentProcessTask';
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
      { layout: false },
    );
    // without the anchor's kind the _2 would read like the gateway (..._afterLieferungPruefenAbcdefghi_2)
    expect(applied.result.aliases).toMatchObject({ $a: `${prefix}_afterLieferungPruefenAbcdefghiGateway`, $b: `${prefix}_afterLieferungPruefenGateway_2` });
    expect(applied.result.aliases!['$a']).toHaveLength(MAX_ID);
    for (const id of ids(applied.xml)) expect(id.length).toBeLessThanOrEqual(MAX_ID);
    for (const id of flowIds(applied.xml)) expect(sameEnds(id), id).toBe(false);
  });

  it('#31: ends of any length are cut fast: only the forms that can fit are listed', async () => {
    const xml = definitionsXml(`
    <bpmn:task id="Task_check_order" name="Check order" />
    <bpmn:task id="Task_ship_order" name="Ship order" />
    <bpmn:task id="Task_bill_order" name="Bill order" />
    <bpmn:sequenceFlow id="Flow_check_order_to_ship_order" sourceRef="Task_check_order" targetRef="Task_ship_order" />
    <bpmn:sequenceFlow id="Flow_ship_order_to_bill_order" sourceRef="Task_ship_order" targetRef="Task_bill_order" />`);
    const style = IdStyle.infer((await Doc.fromXml(xml)).definitions);
    expect(style.info().sequenceFlow.form).toBe('stemSnake');
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

  it('#31: a flow 0.6 cut inside a word still follows its ends', async () => {
    const syncTask = 'Activity_ConsignationsSynchronisieren';
    const logTask = 'Activity_ConsignationsProtokollieren';
    const old = 'Flow_ConsignationSynchronisierenToConsignationsProtokollieren';
    const doc = await Doc.fromXml(
      definitionsXml(`
    <bpmn:serviceTask id="${syncTask}" name="Consignations synchronisieren"><bpmn:outgoing>${old}</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${logTask}" name="Consignations protokollieren"><bpmn:incoming>${old}</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="${old}" sourceRef="${syncTask}" targetRef="${logTask}" />`),
    );
    runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Consignations prüfen', after: syncTask }]);
    expect(flowBetween(doc, syncTask, 'Activity_ConsignationsPruefen')).toBe('Flow_ConsignationsSynchronisierenToConsignationsPruefen');
    // a suffix of 4 characters made 0.6 cut its base of 61 again (`_100`)
    const [syncSource, arrivedTarget] = ['Activity_ProtokollierenSynchronisieren', 'Activity_ProtokollierenEingegangen'];
    const hundredth = 'Flow_ProtokollierenSynchronisierenToProtokollieren_100';
    const doc2 = await Doc.fromXml(
      definitionsXml(`
    <bpmn:serviceTask id="${syncSource}" name="Protokollieren synchronisieren"><bpmn:outgoing>${hundredth}</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="${arrivedTarget}" name="Protokollieren eingegangen"><bpmn:incoming>${hundredth}</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="${hundredth}" sourceRef="${syncSource}" targetRef="${arrivedTarget}" />`),
    );
    runOps(doc2, [{ op: 'add', kind: 'serviceTask', name: 'Protokollieren prüfen', after: syncSource }]);
    expect(flowBetween(doc2, syncSource, 'Activity_ProtokollierenPruefen')).toBe('Flow_ProtokollierenSynchronisierenToProtokollierenPruefen');
    // 0.6 cut an end that begins with a separator and whose first word did not fit to nothing (cutAt with `legacy`)
    expect(cutAt('_lieferantenbestellungsuebersichtenpruefung', 26, true)).toBe('');
    expect(cutAt('_lieferantenbestellungsuebersichtenpruefung', 26)).toBe('_lieferantenbestellungsueb');
    const [reviewTask, reconcileTask] = ['Task__lieferantenbestellungsuebersichtenpruefung', 'Task__zahlungseingangsbestaetigungenabgleichung'];
    const separated = 'Flow__to__zahlungseingangsbestaetigungenabgleichung';
    const doc3 = await Doc.fromXml(
      definitionsXml(`
    <bpmn:task id="Task_check_order" name="Check order"><bpmn:outgoing>Flow_check_order_to_ship_order</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_ship_order" name="Ship order"><bpmn:incoming>Flow_check_order_to_ship_order</bpmn:incoming><bpmn:outgoing>Flow_ship_order_to_bill_order</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_bill_order" name="Bill order"><bpmn:incoming>Flow_ship_order_to_bill_order</bpmn:incoming></bpmn:task>
    <bpmn:task id="${reviewTask}"><bpmn:outgoing>${separated}</bpmn:outgoing></bpmn:task>
    <bpmn:task id="${reconcileTask}"><bpmn:incoming>${separated}</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_check_order_to_ship_order" sourceRef="Task_check_order" targetRef="Task_ship_order" />
    <bpmn:sequenceFlow id="Flow_ship_order_to_bill_order" sourceRef="Task_ship_order" targetRef="Task_bill_order" />
    <bpmn:sequenceFlow id="${separated}" sourceRef="${reviewTask}" targetRef="${reconcileTask}" />`),
    );
    expect(doc3.idStyle.info().sequenceFlow.form).toBe('stemSnake');
    const cs = runOps(doc3, [{ op: 'add', kind: 'task', name: 'Scan', after: reviewTask }]);
    expect(cs.renames).toEqual([expect.objectContaining({ from: separated, to: 'Flow__lieferantenbestellungsuebersichtenpruefung_to_scan' })]);
  });

  it('#31: a collision suffix fits into 64 characters: the ends are cut again at whole words, and the flow follows its ends', async () => {
    const applied = await applyToXml((await newXml({ processName: 'Sync' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Sync', as: '$s' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Deliveriesabcd synchronisieren', after: '$s', as: '$g' },
      { op: 'add', kind: 'serviceTask', name: 'Deliveriesabcd protokollieren', after: '$g', as: '$t' },
      { op: 'connect', source: '$g', target: '$t', as: '$f' },
    ]);
    const suffixed = applied.result.aliases!['$f']!;
    expect(suffixed).toBe('Flow_SynchronisierenToDeliveriesabcdProtokollieren_2');
    expect(applied.result.warnings.added.find((warning) => warning.code === 'W_ID_SUFFIXED')?.message).toBe(`Id Flow_DeliveriesabcdSynchronisierenToDeliveriesabcdProtokollieren is already taken; using ${suffixed}`);
    const r2 = await applyToXml(applied.xml, [{ op: 'add', kind: 'task', name: 'Pruefen', flow: suffixed }]);
    expect(r2.result.renamed).toEqual({ [suffixed]: 'Flow_DeliveriesabcdSynchronisierenToPruefen' });
    // every suffix up to _101 stays within 64, and each suffixed id is recognised as named after its ends
    const req = connectionRequest('bpmn:SequenceFlow', 'Gateway_DeliveriesabcdSynchronisieren', 'Activity_DeliveriesabcdProtokollieren');
    const registry = new IdRegistry();
    const given: string[] = [];
    for (let index = 0; index < 101; index++) {
      const { id } = IdStyle.DEFAULT.next(req, registry);
      registry.claim(id);
      given.push(id);
    }
    expect(given.slice(98)).toEqual(['Flow_SynchronisierenToDeliveriesabcdProtokollieren_99', 'Flow_SynchronisierenToDeliveriesabcdProtokollieren_100', 'Flow_SynchronisierenToDeliveriesabcdProtokollieren_101']);
    expect(given.filter((id) => id.length > MAX_ID)).toEqual([]);
    const bases = IdStyle.DEFAULT.derivedBases(req);
    for (const id of given) expect(bases.some((base) => id === base || (id.startsWith(base) && /^_\d+$/.test(id.slice(base.length)))), id).toBe(true);
  });

  it('#31: a stemTo flow keeps its suffix without a separator when the suffix cuts it again', async () => {
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

  it('a cut stemTo flow to an end that ends in a digit takes No before its suffix, still votes for the form and follows its ends', async () => {
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
    // four of the six flows are cut: they vote for stemTo (cutOfForm), and a splice renames the suffixed one
    expect((await Doc.fromXml(applied.xml)).idStyle.info().sequenceFlow).toEqual({ form: 'stemTo', prefix: 'flow' });
    const r2 = await applyToXml(applied.xml, [{ op: 'add', kind: 'task', name: 'Pruefen', flow: `${base}No3` }], { layout: false });
    expect(r2.result.renamed).toEqual({ [`${base}No3`]: 'flow_lieferantenbestellungSynchronisierenToPruefen' });
  });

  it('#31: element ids of 62 to 64 characters are not cut; the --if-absent hint and a data object get the same cap', async () => {
    const typed = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToCheckOrder</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="userTask_checkOrder" name="Check order"><bpmn:incoming>flow_goToCheckOrder</bpmn:incoming><bpmn:outgoing>flow_checkOrderToShipOrder</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="serviceTask_shipOrder" name="Ship order"><bpmn:incoming>flow_checkOrderToShipOrder</bpmn:incoming><bpmn:outgoing>flow_shipOrderToDone</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_shipOrderToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_goToCheckOrder" sourceRef="startEvent_go" targetRef="userTask_checkOrder" />
    <bpmn:sequenceFlow id="flow_checkOrderToShipOrder" sourceRef="userTask_checkOrder" targetRef="serviceTask_shipOrder" />
    <bpmn:sequenceFlow id="flow_shipOrderToDone" sourceRef="serviceTask_shipOrder" targetRef="endEvent_done" />`);
    const event = { op: 'add', kind: 'intermediateThrowEvent', name: 'Lieferung vollständig eingegangen Abcdefgh' } as const;
    const full = 'intermediateThrowEvent_lieferungVollstaendigEingegangenAbcdefgh';
    expect(full).toHaveLength(63);
    // 0.6: intermediateThrowEvent_lieferungVollstaendigEingegangen; a second one takes a suffix, cut again at whole words
    const applied = await applyToXml(typed, [{ ...event, after: 'serviceTask_shipOrder', as: '$e' }, { ...event, after: '$e', as: '$e2' }], { layout: false });
    expect(applied.result.aliases).toMatchObject({ $e: full, $e2: 'intermediateThrowEvent_lieferungVollstaendigEingegangen_2' });
    // the id --if-absent asks for is the one add generates
    const doc = await Doc.fromXml(typed);
    let hint: string | undefined;
    try {
      runOps(doc, [{ ...event, after: 'serviceTask_shipOrder', ifAbsent: true }]);
    } catch (error) {
      hint = (error as { details?: { hint?: string } }).details?.hint;
    }
    expect(hint).toContain(`--id ${full} `);
    // a data object whose id says what it is fits into 62 characters (0.6 cut the word Object and took _2)
    const prefix = 'processDataArtefactItem';
    const withData = typed.replace(
      '<bpmn:sequenceFlow id="flow_goToCheckOrder"',
      `<bpmn:dataObjectReference id="${prefix}_order" name="Order" dataObjectRef="${prefix}_orderObject" />
    <bpmn:dataObject id="${prefix}_orderObject" />
    <bpmn:dataObjectReference id="${prefix}_article" name="Article" dataObjectRef="${prefix}_articleObject" />
    <bpmn:dataObject id="${prefix}_articleObject" />
    <bpmn:sequenceFlow id="flow_goToCheckOrder"`,
    );
    const withDataApplied = await applyToXml(withData, [{ op: 'add', kind: 'dataObjectReference', name: 'Lieferung vollständig eingegangen', in: 'Process_1', as: '$d' }], { layout: false });
    expect(withDataApplied.result.aliases).toEqual({ $d: `${prefix}_lieferungVollstaendigEingegangen` });
    expect(withDataApplied.xml).toContain(`dataObjectRef="${prefix}_lieferungVollstaendigEingegangenObject"`);
    expect(`${prefix}_lieferungVollstaendigEingegangenObject`).toHaveLength(62);
    expect(withDataApplied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
  });

  it('a data object or store whose reference has a long body keeps its Object / Store word after the body: no _2, no W_ID_SUFFIXED', async () => {
    // references and backing elements under one prefix (snake bodies): the name's 40 characters had no room for the word
    const prefix = 'processDataArtefactItem';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
<bpmn:dataStore id="${prefix}_archive_store" name="Archive" /><bpmn:dataStore id="${prefix}_ledger_store" name="Ledger" />
<bpmn:process id="Process_1" isExecutable="true">
    <bpmn:dataObjectReference id="${prefix}_order" name="Order" dataObjectRef="${prefix}_order_object" />
    <bpmn:dataObject id="${prefix}_order_object" />
    <bpmn:dataObjectReference id="${prefix}_article" name="Article" dataObjectRef="${prefix}_article_object" />
    <bpmn:dataObject id="${prefix}_article_object" />
    <bpmn:dataStoreReference id="${prefix}_archive" name="Archive" dataStoreRef="${prefix}_archive_store" />
    <bpmn:dataStoreReference id="${prefix}_ledger" name="Ledger" dataStoreRef="${prefix}_ledger_store" />
</bpmn:process></bpmn:definitions>`;
    const cases: Array<[string, string, string, string]> = [
      // before: ..._lieferung_vollstaendig_eingegangen_2 (W_ID_SUFFIXED), from a body of 34 characters on
      ['dataObjectReference', 'Lieferung vollständig eingegangen', 'lieferung_vollstaendig_eingegangen', 'lieferung_vollstaendig_object'],
      ['dataObjectReference', 'Lieferantenbestellungen vollständig', 'lieferantenbestellungen_vollstaendig', 'lieferantenbestellungen_object'],
      ['dataStoreReference', 'Lieferantenbestellungen vollständig', 'lieferantenbestellungen_vollstaendig', 'lieferantenbestellungen_store'],
      // a short name: the word as before
      ['dataObjectReference', 'Rechnung', 'rechnung', 'rechnung_object'],
      ['dataStoreReference', 'Belege', 'belege', 'belege_store'],
    ];
    for (const [kind, name, ref, backing] of cases) {
      const applied = await applyToXml(xml, [{ op: 'add', kind, name, in: 'Process_1', as: '$d' }], { layout: false });
      expect(applied.result.aliases).toEqual({ $d: `${prefix}_${ref}` });
      expect(applied.xml).toMatch(new RegExp(`id="${prefix}_${ref}"[^>]*data(Object|Store)Ref="${prefix}_${backing}"`));
      expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    }
    // a name that ends on a filler word: the cut of `<name> Object` drops both, so the word goes after the body (before:
    // ..._zahlungseingangsbestaetigung_variante without its word, and the next reference named without the filler word
    // took ..._variante_2 with W_ID_SUFFIXED)
    for (const [first, second, ref, backing] of [
      ['Zahlungseingangsbestätigung Variante A', 'Zahlungseingangsbestätigung Variante', 'zahlungseingangsbestaetigung_variante', 'zahlungseingangsbestaetigung_object'],
      ['Lieferung vollständig eingegangen und', 'Lieferung vollständig eingegangen', 'lieferung_vollstaendig_eingegangen', 'lieferung_vollstaendig_object'],
    ]) {
      const applied = await applyToXml(xml, [{ op: 'add', kind: 'dataObjectReference', name: first, in: 'Process_1', as: '$a' }, { op: 'add', kind: 'dataObjectReference', name: second, in: 'Process_1', as: '$b' }], { layout: false });
      expect(applied.result.aliases?.['$b']).toBe(`${prefix}_${ref}`);
      expect(applied.xml).toMatch(new RegExp(`id="${applied.result.aliases?.['$a']}"[^>]*dataObjectRef="${prefix}_${backing}"`));
      // the two backing objects are a real collision of one id
      expect(applied.xml).toMatch(new RegExp(`id="${prefix}_${ref}"[^>]*dataObjectRef="${prefix}_${backing}_2"`));
      expect(applied.result.warnings.added.filter((warning) => warning.code === 'W_ID_SUFFIXED').map((warning) => warning.message)).toEqual([`Id ${prefix}_${backing} is already taken; using ${prefix}_${backing}_2`]);
    }
    // bare ids: the same (before: lieferantenbestellungenVollstaendig_2)
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x"><bpmn:process id="Process_1" isExecutable="true">
<bpmn:startEvent id="start" name="Start"/><bpmn:task id="checkInvoice" name="Check invoice"/><bpmn:task id="book" name="Book"/><bpmn:endEvent id="done" name="Done"/>
</bpmn:process></bpmn:definitions>`;
    const bareApplied = await applyToXml(bare, [{ op: 'add', kind: 'dataObjectReference', name: 'Lieferantenbestellungen vollständig abgeglichen', in: 'Process_1', as: '$d' }], { layout: false });
    expect(bareApplied.result.aliases).toEqual({ $d: 'lieferantenbestellungenVollstaendig' });
    expect(bareApplied.xml).toContain('dataObjectRef="lieferantenbestellungenVollstaendigObject"');
    expect(bareApplied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
  });

  it('#31: the join of a split stays within 64 characters, a suffixed one too', async () => {
    const join = IdStyle.DEFAULT.joinId('Gateway_ConsignationsSynchronisierenUndLieferscheinePruefenAbc');
    expect(join).toBe('Gateway_ConsignationsSynchronisierenUndLieferscheinePruefen_join');
    expect(join).toHaveLength(MAX_ID);
    // a gateway id of 59 characters: its join has 64, a taken one keeps _join before the suffix
    const gateway = 'Gateway_ConsignationsSynchronisierenUndLieferscheinePruefen';
    const applied = await applyToXml((await newXml({ processName: 'Join' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Join', as: '$s' },
      { op: 'add', kind: 'task', id: join, name: 'Taken', after: '$s', as: '$t' },
      { op: 'split', after: '$t', id: gateway, branches: [{ nodes: [{ kind: 'task', name: 'A' }] }, { nodes: [{ kind: 'task', name: 'B' }] }], joinAs: '$j' },
    ]);
    expect(applied.result.aliases!['$j']).toBe('Gateway_ConsignationsSynchronisierenUndLieferscheine_join_2');
    expect(ids(applied.xml).filter((id) => id.length > MAX_ID)).toEqual([]);
  });

  it('transliterates beyond German: Nordic letters spelled out, other accents dropped', async () => {
    expect(transliterate('Øre Åse Æble')).toBe('Oere Aase Aeble');
    expect(transliterate('ØRE')).toBe('OERE');
    expect(transliterate('Œuvre Łódź Þing')).toBe('Oeuvre Lodz Thing');
    const base = await newXml({ processName: 'Nordic' });
    const applied = await applyToXml(base.xml, [{ op: 'add', kind: 'task', name: 'Ünïcödé Çàfé Øre', in: 'Process_Nordic', as: '$t' }]);
    expect(applied.result.aliases?.['$t']).toBe('Activity_UenicoedeCafeOere');
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

describe('the warnings delta', () => {
  it("counts the platform profile's findings the file already had", async () => {
    const base = await newXml({ processName: 'Pf', target: 'camunda8' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Pf', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Charge', after: '$s', as: '$c' },
      { op: 'add', kind: 'serviceTask', name: 'Ship', after: '$c', as: '$h' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$h' },
    ]);
    expect((await validateXml(built.xml)).platform?.counts.deploy).toBe(2);
    const applied = await applyToXml(built.xml, [{ op: 'set', id: 'Event_Done', values: { name: 'Finished' } }]);
    expect(applied.result.warnings.added).toEqual([]);
    expect(applied.result.warnings.preexistingCount).toBe(2);
    expect(renderSummary(mutationSummary(applied.result))).toContain('warnings: 0 added, 0 resolved, 2 already in the file');
  });

  it('counts what `bpmn validate` lists: a missing start once, as the platform finding', async () => {
    const base = await newXml({ processName: 'Empty', target: 'camunda8' });
    const xml = (await applyToXml(base.xml, [{ op: 'add', kind: 'serviceTask', name: 'Charge', in: 'Process_Empty' }])).xml;
    const listed = (await validateXml(xml)).warnings.map((warning) => warning.code);
    expect(listed).toEqual(expect.arrayContaining(['W_C8_DEPLOY_START_EVENT', 'W_C8_DEPLOY_IMPLEMENTATION']));
    expect(listed).not.toContain('W_NO_START');
    const applied = await applyToXml(xml, [{ op: 'set', id: 'Process_Empty', values: { name: 'Still empty' } }]);
    expect(applied.result.warnings.added).toEqual([]);
    expect(applied.result.warnings.preexistingCount).toBe(listed.length);
  });

  /** T1, T2, T3 all named "Check" between Go and Done. */
  async function threeChecks(): Promise<string> {
    const base = await newXml({ processName: 'Dn' });
    return (
      await applyToXml(base.xml, [
        { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Dn', as: '$s' },
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
    const more = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Check', id: 'T4', after: 'Event_Go' }]);
    expect(more.result.warnings.added.map((warning) => warning.code)).toContain('W_DUPLICATE_NAME');
    expect(more.result.warnings.resolved.map((warning) => warning.code)).toEqual([]);
  });

  it('a bridge that takes the id of the flow it replaces lists every id once: the old flow removed, the taken id changed', async () => {
    const xml = await threeChecks();
    const applied = await applyToXml(xml, [{ op: 'remove', ids: ['T3'] }]);
    expect(flowIds(applied.xml)).toEqual(expect.arrayContaining(['Flow_CheckToDone']));
    expect(flowIds(applied.xml)).not.toContain('Flow_CheckToCheck_2');
    const summary = mutationSummary(applied.result);
    expect(summary.removed).toEqual(['Flow_CheckToCheck_2', 'T3']);
    expect(summary.changed).toEqual(['Flow_CheckToDone']);
    expect(summary.renamed).toBeUndefined();
    const text = renderMutation(applied.result);
    expect(text).toContain('changed sequenceFlow Flow_CheckToDone - T2 -> Event_Done (bridged T3)\n');
    expect(text).toContain('removed sequenceFlow Flow_CheckToCheck_2 - T2 -> T3');
    // the same over two ops of a batch: the flow from T1 that T2's bridge kept takes the id of T3's outgoing flow
    const two = mutationSummary((await applyToXml(xml, [{ op: 'remove', ids: ['T2'] }, { op: 'remove', ids: ['T3'] }])).result);
    expect([...two.removed].sort()).toEqual(['Flow_CheckToCheck', 'Flow_CheckToCheck_2', 'T2', 'T3']);
    expect(two.changed).toEqual(['Flow_CheckToDone']);
    expect(two.renamed).toBeUndefined();
  });

  it('a batch reports the warnings of its final state: lanes added before the participant that wraps the process', async () => {
    const base = await newXml({ processName: 'Demo' });
    const started = await applyToXml(base.xml, [{ op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Demo' }]);
    const applied = await applyToXml(started.xml, [
      { op: 'add', kind: 'lane', name: 'Sales', in: 'Process_Demo', members: ['Event_Start'] },
      { op: 'add', kind: 'participant', name: 'Seller', process: 'Process_Demo' },
    ]);
    expect(applied.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LANES_WITHOUT_POOL');
    // without the participant it still holds
    const lanesOnly = await applyToXml(started.xml, [{ op: 'add', kind: 'lane', name: 'Sales', in: 'Process_Demo', members: ['Event_Start'] }]);
    expect(lanesOnly.result.warnings.added.map((warning) => warning.code)).toContain('W_LANES_WITHOUT_POOL');
  });

  it('a batch drops an implicit join a later op of it resolved', async () => {
    const base = await newXml({ processName: 'Join' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Join', as: '$s' },
      { op: 'split', after: '$s', kind: 'parallelGateway', join: false, branches: [{ nodes: [{ kind: 'task', name: 'Left' }] }, { nodes: [{ kind: 'task', name: 'Right' }] }] },
      { op: 'add', kind: 'endEvent', name: 'Done', after: 'Activity_Left' },
    ]);
    const join = [
      { op: 'connect', source: 'Activity_Right', target: 'Event_Done', as: '$right' },
      { op: 'add', kind: 'parallelGateway', id: 'Gateway_Sync', flow: 'Flow_LeftToDone' },
      { op: 'set', id: '$right', values: { target: 'Gateway_Sync' } },
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
    const applied = await applyToXml(base.xml, [{ op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Order' }]);
    expect(applied.result.warnings.resolved.map((warning) => warning.code)).toEqual(['W_C8_DEPLOY_START_EVENT']);
    expect(shown).toEqual(expect.arrayContaining(applied.result.warnings.resolved.map((warning) => warning.code)));
  });
});
