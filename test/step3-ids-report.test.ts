/**
 * Step 3, the verifier's id and report findings: flows at unnamed gateways
 * name them by their own speaking ids, no context chains, a length cap,
 * transliteration beyond German, speaking definitions ids of `new`, and the
 * warnings delta (platform findings counted, group warnings, a bridge that
 * takes the removed flow's id, warnings of a batch's final state, `new` with
 * the platform's findings). Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml, validateXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { cutAt, MAX_ID, transliterate } from '../src/ids.js';
import { runOps } from '../src/ops/index.js';
import { mutationSummary, renderMutation, renderSummary } from '../src/report.js';
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

  it('unnamed gateways and tasks in a row: the nearest named anchor once, the kind spelled out, then the anchor named', async () => {
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
  const m = SAME_ENDS.exec(id);
  return !!m && m[1]!.toLowerCase() === m[2]!.toLowerCase();
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
    const r = await applyToXml(xml, ops, { layout: false });
    const before = new Set(ids(xml));
    const fresh = ids(r.xml).filter((id) => !before.has(id));
    return { aliases: r.result.aliases ?? {}, fresh, flows: flowIds(r.xml).filter((id) => !before.has(id)), suffixed: r.result.warnings.added.filter((w) => w.code === 'W_ID_SUFFIXED') };
  };
  const nodes = (fresh: string[], flows: string[]): string[] => fresh.filter((id) => !flows.includes(id));

  it('a task after an unnamed gateway and the next task get bodies of their own: each names its anchor, no suffix', async () => {
    const r = await run(OLD_MODELER, [
      { op: 'add', kind: 'exclusiveGateway', after: 'Task_0k3x9qa', as: '$g' },
      { op: 'add', kind: 'task', after: '$g', as: '$u' },
      { op: 'add', kind: 'task', after: '$u', as: '$v' },
    ]);
    // before: Task_AfterCheck (the gateway's body: SequenceFlow_AfterCheckToAfterCheck) and Task_AfterCheck_2 with W_ID_SUFFIXED
    expect(r.aliases).toMatchObject({ $g: 'ExclusiveGateway_AfterCheck', $u: 'Task_AfterCheckGateway', $v: 'Task_AfterCheckGatewayTask' });
    expect(r.flows).toEqual(expect.arrayContaining(['SequenceFlow_AfterCheckToAfterCheckGateway', 'SequenceFlow_AfterCheckGatewayToAfterCheckGatewayTask']));
    expect(r.suffixed).toEqual([]);
    const bodies = nodes(r.fresh, r.flows).map(body);
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const id of r.flows) expect(sameEnds(id)).toBe(false);
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
    const r = await run(OLD_MODELER, [
      { op: 'add', kind: 'userTask', name: 'Prüfen ob die eingereichten Unterlagen vollständig und fristgerecht vorliegen', after: 'Task_0k3x9qa', as: '$l' },
      { op: 'add', kind: 'exclusiveGateway', after: '$l', as: '$g' },
      { op: 'add', kind: 'task', after: '$g', as: '$u' },
    ]);
    expect(r.aliases['$u']).toMatch(/^Task_After\w+Gateway$/);
    for (const id of r.fresh) expect(id.length).toBeLessThanOrEqual(MAX_ID);
    expect(r.suffixed).toEqual([]);
  });

  it('W_ID_SUFFIXED stays a signal: a repeated name, and two unnamed tasks that only an index could tell apart', async () => {
    // the name of a task already in the file
    const named = await run(OLD_MODELER, [
      { op: 'add', kind: 'task', name: 'Ship', after: 'Task_0k3x9qa' },
      { op: 'add', kind: 'task', name: 'Ship', after: 'Task_1m2n3o4' },
    ]);
    expect(named.fresh).toEqual(expect.arrayContaining(['Task_Ship', 'Task_Ship_2']));
    expect(named.suffixed.map((w) => w.element)).toEqual(['Task_Ship_2']);
    // two unnamed tasks on two branches right after the same unnamed gateway: the second one takes a suffix on the
    // form that names the gateway, never the gateway's own body (SequenceFlow_AfterCheckToAfterCheck)
    const branches = await run(OLD_MODELER, [{ op: 'split', after: 'Task_0k3x9qa', kind: 'parallelGateway', branches: [{ nodes: [{ kind: 'task' }] }, { nodes: [{ kind: 'task' }] }] }]);
    expect(branches.fresh).toEqual(expect.arrayContaining(['Task_AfterCheckGateway', 'Task_AfterCheckGateway_2']));
    expect(branches.suffixed.map((w) => w.element)).toEqual(['Task_AfterCheckGateway_2']);
    for (const id of branches.flows) expect(sameEnds(id)).toBe(false);
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
    const r = await applyToXml(built.xml, [{ op: 'set', id: 'Event_Done', values: { name: 'Finished' } }]);
    expect(r.result.warnings.added).toEqual([]);
    expect(r.result.warnings.preexistingCount).toBe(2);
    expect(renderSummary(mutationSummary(r.result))).toContain('warnings: 0 added, 0 resolved, 2 already in the file');
  });

  it('counts what `bpmn validate` lists: a missing start once, as the platform finding', async () => {
    const base = await newXml({ processName: 'Empty', target: 'camunda8' });
    const xml = (await applyToXml(base.xml, [{ op: 'add', kind: 'serviceTask', name: 'Charge', in: 'Process_Empty' }])).xml;
    const listed = (await validateXml(xml)).warnings.map((w) => w.code);
    expect(listed).toEqual(expect.arrayContaining(['W_C8_DEPLOY_START_EVENT', 'W_C8_DEPLOY_IMPLEMENTATION']));
    expect(listed).not.toContain('W_NO_START');
    const r = await applyToXml(xml, [{ op: 'set', id: 'Process_Empty', values: { name: 'Still empty' } }]);
    expect(r.result.warnings.added).toEqual([]);
    expect(r.result.warnings.preexistingCount).toBe(listed.length);
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
    expect(one.result.warnings.added.map((w) => w.code)).toEqual([]);
    expect(one.result.warnings.resolved.map((w) => w.code)).toEqual([]);
    expect(one.result.warnings.preexistingCount).toBe(1);
    const both = await applyToXml(xml, [{ op: 'remove', ids: ['T2'] }, { op: 'remove', ids: ['T3'] }]);
    expect(both.result.warnings.resolved.map((w) => w.code)).toEqual(['W_DUPLICATE_NAME']);
    const first = await applyToXml(xml, [{ op: 'remove', ids: ['T1'] }]);
    expect(first.result.warnings.added.map((w) => w.code)).toEqual([]);
    expect(first.result.warnings.resolved.map((w) => w.code)).toEqual([]);
    const more = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Check', id: 'T4', after: 'Event_Go' }]);
    expect(more.result.warnings.added.map((w) => w.code)).toContain('W_DUPLICATE_NAME');
    expect(more.result.warnings.resolved.map((w) => w.code)).toEqual([]);
  });

  it('a bridge that takes the id of the flow it replaces lists every id once: the old flow removed, the taken id changed', async () => {
    const xml = await threeChecks();
    const r = await applyToXml(xml, [{ op: 'remove', ids: ['T3'] }]);
    expect(flowIds(r.xml)).toEqual(expect.arrayContaining(['Flow_CheckToDone']));
    expect(flowIds(r.xml)).not.toContain('Flow_CheckToCheck_2');
    const s = mutationSummary(r.result);
    expect(s.removed).toEqual(['Flow_CheckToCheck_2', 'T3']);
    expect(s.changed).toEqual(['Flow_CheckToDone']);
    expect(s.renamed).toBeUndefined();
    const text = renderMutation(r.result);
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
    const r = await applyToXml(started.xml, [
      { op: 'add', kind: 'lane', name: 'Sales', in: 'Process_Demo', members: ['Event_Start'] },
      { op: 'add', kind: 'participant', name: 'Seller', process: 'Process_Demo' },
    ]);
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_LANES_WITHOUT_POOL');
    // without the participant it still holds
    const lanesOnly = await applyToXml(started.xml, [{ op: 'add', kind: 'lane', name: 'Sales', in: 'Process_Demo', members: ['Event_Start'] }]);
    expect(lanesOnly.result.warnings.added.map((w) => w.code)).toContain('W_LANES_WITHOUT_POOL');
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
    expect((await applyToXml(built.xml, join.slice(0, 1))).result.warnings.added.map((w) => w.code)).toContain('W_IMPLICIT_JOIN');
    const r = await applyToXml(built.xml, join);
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_IMPLICIT_JOIN');
  });

  it('new reports the platform findings an edit would, and the next edit resolves what new showed', async () => {
    const base = await newXml({ processName: 'Order', target: 'camunda8' });
    const shown = base.result.warnings.added.map((w) => w.code);
    expect(shown).toContain('W_C8_DEPLOY_START_EVENT');
    expect(shown).not.toContain('W_NO_START');
    const r = await applyToXml(base.xml, [{ op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Order' }]);
    expect(r.result.warnings.resolved.map((w) => w.code)).toEqual(['W_C8_DEPLOY_START_EVENT']);
    expect(shown).toEqual(expect.arrayContaining(r.result.warnings.resolved.map((w) => w.code)));
  });
});
