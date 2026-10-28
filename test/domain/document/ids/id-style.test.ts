/**
 * New ids follow the conventions of element-id-naming, its defaults where nothing is declared
 * (src/domain/document/ids/IdStyle.ts), and say what they name (never a hash or a running number:
 * names, kind + context, the ends of a flow), names are transliterated the German way. All
 * fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { runOps } from '../../../../src/index.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../../src/index.js';
import { guideText, kindsJson } from '../../../../src/index.js';
import { definitionsXml, flowBetween } from '../../../helpers/helpers.js';

/** A Camunda Modeler hash or a number: what a generated id must never end in. */
const NOT_SPEAKING = /_([01][0-9a-z]{6}|\d+)$/;

/** A chain of flow nodes `[tag, id, name?]` connected by flows with the given ids (incoming / outgoing kept). */
function chain(nodes: Array<[string, string, string?]>, flowIds: string[]): string {
  const body = nodes.map(([tag, id, name], nodeIndex) => {
    const links = [...(nodeIndex > 0 ? [`<bpmn:incoming>${flowIds[nodeIndex - 1]}</bpmn:incoming>`] : []), ...(nodeIndex + 1 < nodes.length ? [`<bpmn:outgoing>${flowIds[nodeIndex]}</bpmn:outgoing>`] : [])];
    return `<bpmn:${tag} id="${id}"${name ? ` name="${name}"` : ''}>${links.join('')}</bpmn:${tag}>`;
  });
  for (let flowIndex = 0; flowIndex + 1 < nodes.length; flowIndex++) body.push(`<bpmn:sequenceFlow id="${flowIds[flowIndex]}" sourceRef="${nodes[flowIndex]![1]}" targetRef="${nodes[flowIndex + 1]![1]}" />`);
  return definitionsXml(body.join('\n'));
}

async function created(xml: string, ops: EditCommand[]): Promise<{ doc: Doc; ids: string[]; warnings: string[] }> {
  const doc = await Doc.fromXml(xml);
  const cs = runOps(doc, ops);
  return { doc, ids: cs.created.map((created) => created.id), warnings: cs.warnings.map((warning) => warning.code) };
}

/** Camunda Modeler: random 7-character ids, `<id>_di` DI. */
const MODELER = chain(
  [
    ['startEvent', 'StartEvent_1', 'Order received'],
    ['userTask', 'Activity_0k3x9qa', 'Check order'],
    ['exclusiveGateway', 'Gateway_1d8vq2p', 'Order ok?'],
    ['serviceTask', 'Activity_1m2n3b4', 'Ship order'],
    ['endEvent', 'Event_0zz81aa', 'Order shipped'],
  ],
  ['Flow_0a1b2c3', 'Flow_1q2w3e4', 'Flow_0p9o8i7', 'Flow_1l2k3j4'],
);

/** The defaults: type-named lowerCamel prefixes with camelCase bodies and `flow_<from>To<To>` flows. */
const CAMEL = chain(
  [
    ['startEvent', 'startEvent_orderReceived', 'Order received'],
    ['serviceTask', 'serviceTask_checkStock', 'Check stock'],
    ['userTask', 'userTask_approveOrder', 'Approve order'],
    ['exclusiveGateway', 'gateway_isApproved', 'Approved?'],
    ['serviceTask', 'serviceTask_shipOrder', 'Ship order'],
    ['endEvent', 'endEvent_orderShipped', 'Order shipped'],
  ],
  ['flow_orderReceivedToCheckStock', 'flow_checkStockToApproveOrder', 'flow_approveOrderToIsApproved', 'flow_isApprovedToShipOrder', 'flow_shipOrderToOrderShipped'],
);

/** Numbered ids with custom prefixes (`Task_1`, `Start_1`, `End_1`, `SF_1`). */
const NUMBERED = chain(
  [
    ['startEvent', 'Start_1', 'Begin'],
    ['task', 'Task_1', 'First'],
    ['task', 'Task_2', 'Second'],
    ['endEvent', 'End_1', 'Finish'],
  ],
  ['SF_1', 'SF_2', 'SF_3'],
);

/** The old Camunda Modeler (bpmn-js before 7): type-named prefixes with random bodies, `SequenceFlow_` flows. */
const OLD_MODELER = chain(
  [
    ['startEvent', 'StartEvent_0abc123', 'Received'],
    ['task', 'Task_1bcd234', 'Check'],
    ['task', 'Task_0cde345', 'Approve'],
    ['endEvent', 'EndEvent_1def456', 'Done'],
  ],
  ['SequenceFlow_0aaa111', 'SequenceFlow_1bbb222', 'SequenceFlow_0ccc333'],
);

describe('new ids follow the defaults of element-id-naming', () => {
  it('a Camunda Modeler file gets speaking ids with the default prefixes; flows name their ends', async () => {
    const ops: EditCommand[] = [{ op: 'add', kind: 'userTask', name: 'Pack order', after: 'Activity_0k3x9qa' }];
    const spliceEdit = await created(MODELER, ops);
    // `--after` splices: the anchor's (hashed) flow keeps its id and now ends at the new node, a new flow runs on to the
    // old target, named after the ends (the gateway by its name: its id says nothing)
    expect(spliceEdit.ids).toEqual(['userTask_packOrder', 'flow_packOrderToOrderOk']);
    expect(flowBetween(spliceEdit.doc, 'Activity_0k3x9qa', 'userTask_packOrder')).toBe('Flow_1q2w3e4');
    // the same edit on the same file gives the same ids
    expect((await created(MODELER, ops)).ids).toEqual(spliceEdit.ids);
    // unnamed elements: a word for the kind and the context (Timer On <host>, After <anchor>)
    const unnamedEdit = await created(MODELER, [
      { op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_0k3x9qa', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', after: 'event_timerOnCheckOrder' },
      { op: 'add', kind: 'parallelGateway', after: 'Activity_1m2n3b4' },
    ]);
    // a flow names an unnamed end by its own id's speaking part (its kind and place), never by a bare kind word
    expect(unnamedEdit.ids).toEqual(['event_timerOnCheckOrder', 'endEvent_afterTimerOnCheckOrder', 'flow_timerOnCheckOrderToAfterTimerOnCheckOrder', 'gateway_afterShipOrder', 'flow_afterShipOrderToOrderShipped']);
    for (const id of [...spliceEdit.ids, ...unnamedEdit.ids]) expect(id).not.toMatch(NOT_SPEAKING);
  });

  it('type-named camelCase ids: serviceTask_checkStock, flow_checkStockToApproveOrder', async () => {
    const { ids, doc } = await created(CAMEL, [
      { op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' },
      { op: 'add', kind: 'sendTask', name: 'Notify customer', after: 'serviceTask_shipOrder' },
      { op: 'add', kind: 'parallelGateway', in: 'Process_1' },
    ]);
    expect(ids.slice(0, 2)).toEqual(['userTask_packGoods', 'flow_packGoodsToApproveOrder']);
    expect(ids.slice(2, 4)).toEqual(['sendTask_notifyCustomer', 'flow_notifyCustomerToOrderShipped']);
    // an unnamed gateway: the gateway prefix, a word for the kind (no placement context: --in the process)
    expect(ids[4]).toBe('gateway_parallel');
    // the spliced flow named its old ends: it is renamed after its new ones (and reported so)
    expect(flowBetween(doc, 'serviceTask_checkStock', 'userTask_packGoods')).toBe('flow_checkStockToPackGoods');
  });

  it('#31: a flow between two long names cuts whole words of each end, and still follows its ends', async () => {
    const { doc, ids } = await created(CAMEL, [
      { op: 'add', kind: 'userTask', name: 'Lieferantenbestellungen prüfen', after: 'serviceTask_checkStock' },
      { op: 'add', kind: 'userTask', name: 'Zahlungseingänge abgleichen und Rechnung archivieren', after: 'userTask_lieferantenbestellungenPruefen' },
    ]);
    // the name gives at most 40 characters of whole words
    expect(ids).toContain('userTask_zahlungseingaengeAbgleichenUndRechnung');
    const cut = 'flow_lieferantenbestellungenPruefenToZahlungseingaengeAbgleichen';
    expect(flowBetween(doc, 'userTask_lieferantenbestellungenPruefen', 'userTask_zahlungseingaengeAbgleichenUndRechnung')).toBe(cut);
    const cs = runOps(doc, [{ op: 'add', kind: 'userTask', name: 'Beleg scannen', after: 'userTask_lieferantenbestellungenPruefen' }]);
    expect(cs.renames).toEqual([expect.objectContaining({ from: cut, to: 'flow_lieferantenbestellungenPruefenToBelegScannen' })]);
  });

  it('warns W_ID_SUFFIXED and names the --if-absent id', async () => {
    const doc = await Doc.fromXml(CAMEL);
    const cs = runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Check stock', in: 'Process_1' }]);
    expect(cs.created[0]!.id).toBe('serviceTask_checkStock2');
    expect(cs.warnings.map((warning) => warning.message)).toEqual(['Id serviceTask_checkStock is already taken; using serviceTask_checkStock2']);
    let hint = '';
    try {
      runOps(doc, [{ op: 'add', kind: 'userTask', name: 'Pack goods', in: 'Process_1', ifAbsent: true }]);
    } catch (err) {
      hint = String((err as { details?: { hint?: string } }).details?.hint);
    }
    expect(hint).toContain('--id userTask_packGoods');
  });

  it('a split joins at <id>Join', async () => {
    const split: EditCommand = { op: 'split', after: 'userTask_approveOrder', kind: 'parallel', name: 'Fan out', branches: [{ nodes: [{ kind: 'task', name: 'Left' }] }, { nodes: [{ kind: 'task', name: 'Right' }] }] };
    expect((await created(CAMEL, [split])).ids).toContain('gateway_fanOutJoin');
    const modeler = await created(MODELER, [{ ...split, after: 'Activity_0k3x9qa' } as EditCommand]);
    expect(modeler.ids.filter((id) => id.startsWith('gateway_'))).toEqual(['gateway_fanOut', 'gateway_fanOutJoin']);
    // an unnamed split gateway: After <anchor>
    const unnamed = await created(MODELER, [{ ...split, name: undefined, after: 'Activity_0k3x9qa' } as EditCommand]);
    expect(unnamed.ids.filter((id) => id.startsWith('gateway_'))).toEqual(['gateway_afterCheckOrder', 'gateway_afterCheckOrderJoin']);
    // the gateways' flows name them by their ids' speaking parts: the split afterCheckOrder, its join checkOrderJoin
    expect(unnamed.ids).toEqual(expect.arrayContaining(['flow_afterCheckOrderToLeft', 'flow_leftToCheckOrderJoin', 'flow_checkOrderJoinToOrderOk']));
  });

  it('a glued suffix after an end that ends in a digit takes the word No; such flows follow their ends', async () => {
    // before: flow_checkStockToSendPdf102 (a flow to Send PDF 102?)
    const { doc, ids } = await created(CAMEL, [
      { op: 'add', kind: 'serviceTask', id: 'serviceTask_sendPdf10', name: 'Send PDF 10', in: 'Process_1' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_sendPdf10' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_sendPdf10' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_sendPdf10' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'userTask_approveOrder' },
    ]);
    expect(ids).toEqual([
      'serviceTask_sendPdf10',
      'flow_checkStockToSendPdf10',
      'flow_checkStockToSendPdf10No2',
      'flow_checkStockToSendPdf10No3',
      // an end that ends in a letter keeps the glued 2
      'flow_checkStockToApproveOrder2',
    ]);
    const spliced = runOps(doc, [{ op: 'add', kind: 'serviceTask', id: 'serviceTask_pack', name: 'Pack', flow: 'flow_checkStockToSendPdf10No2' }]);
    expect(spliced.renames).toEqual([expect.objectContaining({ from: 'flow_checkStockToSendPdf10No2', to: 'flow_checkStockToPack' })]);
  });
});

describe('flow ids kept (keepFlowIds): a stale id is recognised in the current flow form', () => {
  /** A second flow between the same pair with a collision suffix. */
  const SUFFIXED = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gateway_ok" name="Ok?"><bpmn:incoming>flow_startToOk</bpmn:incoming><bpmn:outgoing>flow_okToBook</bpmn:outgoing><bpmn:outgoing>flow_okToBook2</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="task_book" name="Book"><bpmn:incoming>flow_okToBook</bpmn:incoming><bpmn:incoming>flow_okToBook2</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="flow_startToOk" sourceRef="startEvent_start" targetRef="gateway_ok" />
    <bpmn:sequenceFlow id="flow_okToBook" sourceRef="gateway_ok" targetRef="task_book" />
    <bpmn:sequenceFlow id="flow_okToBook2" sourceRef="gateway_ok" targetRef="task_book" />`);

  /** `old -> new` of the renames of the default, and `flow -> suggested id` of the W_FLOW_ID_STALE with ids kept. */
  async function bothModes(xml: string, ops: EditCommand[]): Promise<{ renamed: string[]; stale: string[] }> {
    const follow = await Doc.fromXml(xml);
    const renamed = runOps(follow, ops).renames.map((rename) => `${rename.from} -> ${rename.to}`);
    const keep = await Doc.fromXml(xml);
    keep.followFlowEnds = false;
    const cs = runOps(keep, ops);
    expect(cs.renames).toEqual([]);
    const stale = cs.warnings.filter((warning) => warning.code === 'W_FLOW_ID_STALE').map((warning) => `${warning.element} -> ${/ id=(\S+)`/.exec(warning.hint!)![1]}`);
    return { renamed, stale };
  }

  it('the suggestion is the id the default rename gives (also for a suffixed id)', async () => {
    const cases: Array<[string, EditCommand, string]> = [
      [CAMEL, { op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' }, 'flow_checkStockToApproveOrder -> flow_checkStockToPackGoods'],
      [SUFFIXED, { op: 'add', kind: 'task', name: 'Review', flow: 'flow_okToBook2' }, 'flow_okToBook2 -> flow_okToReview'],
    ];
    for (const [xml, op, line] of cases) {
      const { renamed, stale } = await bothModes(xml, [op]);
      expect(renamed, line).toEqual([line]);
      expect(stale, line).toEqual([line]);
    }
  });

  it('an end `set id=` renamed earlier in the batch still names its flows (the id it had)', async () => {
    const ops: EditCommand[] = [{ op: 'set', id: 'serviceTask_checkStock', values: { id: 'serviceTask_verifyStock' } }, { op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_verifyStock' }];
    const line = 'flow_checkStockToApproveOrder -> flow_verifyStockToPackGoods';
    expect(await bothModes(CAMEL, ops)).toEqual({ renamed: [line], stale: [line] });
  });

  it('a glued suffix with No after a digit still names an end `set` renamed earlier in the batch (flow_approveToStep1No2)', async () => {
    const xml = definitionsXml(`
    <bpmn:startEvent id="startEvent_go" name="Go"><bpmn:outgoing>flow_goToApprove</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="userTask_approve" name="Approve"><bpmn:incoming>flow_goToApprove</bpmn:incoming><bpmn:outgoing>flow_approveToStep1</bpmn:outgoing><bpmn:outgoing>flow_approveToStep1No2</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="serviceTask_step1" name="Step 1"><bpmn:incoming>flow_approveToStep1</bpmn:incoming><bpmn:incoming>flow_approveToStep1No2</bpmn:incoming><bpmn:outgoing>flow_step1ToDone</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_step1ToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_goToApprove" sourceRef="startEvent_go" targetRef="userTask_approve" />
    <bpmn:sequenceFlow id="flow_approveToStep1" sourceRef="userTask_approve" targetRef="serviceTask_step1" />
    <bpmn:sequenceFlow id="flow_approveToStep1No2" sourceRef="userTask_approve" targetRef="serviceTask_step1" />
    <bpmn:sequenceFlow id="flow_step1ToDone" sourceRef="serviceTask_step1" targetRef="endEvent_done" />`);
    const ops: EditCommand[] = [
      { op: 'set', id: 'userTask_approve', values: { id: 'userTask_review', name: 'Review' } },
      { op: 'add', kind: 'task', name: 'Check', flow: 'flow_approveToStep1No2' },
    ];
    expect(await bothModes(xml, ops)).toEqual({ renamed: ['flow_approveToStep1No2 -> flow_reviewToCheck'], stale: ['flow_approveToStep1No2 -> flow_reviewToCheck'] });
  });

  it('flow ids that do not name their ends in the current form neither follow nor go stale (hashes, numbers, older forms)', async () => {
    for (const [xml, anchor] of [[MODELER, 'Activity_0k3x9qa'], [NUMBERED, 'Task_1'], [OLD_MODELER, 'Task_1bcd234']] as const) {
      expect(await bothModes(xml, [{ op: 'add', kind: 'task', name: 'Pack', after: anchor }])).toEqual({ renamed: [], stale: [] });
    }
    // Flow_AToB named its ends in earlier versions: it keeps its id now
    const older = chain(
      [
        ['task', 'Activity_A', 'A'],
        ['task', 'Activity_B', 'B'],
      ],
      ['Flow_AToB'],
    );
    expect(await bothModes(older, [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_A' }])).toEqual({ renamed: [], stale: [] });
  });

  it('two flows that end up between the same ends get the id and the suffix of the default rename, so every hint can be followed', async () => {
    const joined = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gateway_ok" name="Ok?"><bpmn:incoming>flow_startToOk</bpmn:incoming><bpmn:outgoing>flow_okToA</bpmn:outgoing><bpmn:outgoing>flow_okToB</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="task_a" name="A"><bpmn:incoming>flow_okToA</bpmn:incoming><bpmn:outgoing>flow_aToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>flow_okToB</bpmn:incoming><bpmn:outgoing>flow_bToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="gateway_join" name="Join"><bpmn:incoming>flow_aToJoin</bpmn:incoming><bpmn:incoming>flow_bToJoin</bpmn:incoming></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="flow_startToOk" sourceRef="startEvent_start" targetRef="gateway_ok" />
    <bpmn:sequenceFlow id="flow_okToA" sourceRef="gateway_ok" targetRef="task_a" />
    <bpmn:sequenceFlow id="flow_okToB" sourceRef="gateway_ok" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_aToJoin" sourceRef="task_a" targetRef="gateway_join" />
    <bpmn:sequenceFlow id="flow_bToJoin" sourceRef="task_b" targetRef="gateway_join" />`);
    const expected = ['flow_okToA -> flow_okToJoin', 'flow_okToB -> flow_okToJoin2'];
    for (const ops of [[{ op: 'remove', ids: ['task_a', 'task_b'] }], [{ op: 'remove', ids: ['task_a'] }, { op: 'remove', ids: ['task_b'] }]] as EditCommand[][]) {
      expect(await bothModes(joined, ops), JSON.stringify(ops)).toEqual({ renamed: expected, stale: expected });
    }
    const doc = await Doc.fromXml(joined);
    doc.followFlowEnds = false;
    runOps(doc, [{ op: 'remove', ids: ['task_a', 'task_b'] }]);
    runOps(doc, expected.map((line) => ({ op: 'set', id: line.split(' -> ')[0]!, values: { id: line.split(' -> ')[1]! } })));
    expect(flowBetween(doc, 'gateway_ok', 'gateway_join')).toMatch(/^flow_okToJoin2?$/);
  });
});

describe('speaking ids on two branches of a file (independent edits)', () => {
  const base = chain(
    [
      ['startEvent', 'Event_Start', 'Start'],
      ['task', 'Activity_A', 'A'],
      ['task', 'Activity_B', 'B'],
      ['endEvent', 'Event_End', 'End'],
    ],
    ['Flow_0aa0001', 'Flow_0aa0002', 'Flow_0aa0003'],
  );

  it('two edits of one file at different places never share a new id', async () => {
    const left = await created(base, [{ op: 'add', kind: 'task', name: 'Check address', after: 'Activity_A' }, { op: 'add', kind: 'parallelGateway', after: 'task_checkAddress' }]);
    const right = await created(base, [{ op: 'add', kind: 'task', name: 'Archive', after: 'Activity_B' }, { op: 'add', kind: 'parallelGateway', after: 'task_archive' }]);
    expect(left.ids.filter((id) => right.ids.includes(id))).toEqual([]);
    // the merged file has no duplicate id: every new id of the right branch is free on the left
    for (const id of right.ids) expect(left.doc.ids.has(id)).toBe(false);
    // the flow that CheckAddress -> B got when it was created names its new ends once the gateway is spliced in;
    // the result lists every id as it is at the end of the batch
    expect(left.ids).toEqual(['task_checkAddress', 'flow_checkAddressToAfterCheckAddress', 'gateway_afterCheckAddress', 'flow_afterCheckAddressToB']);
    expect(flowBetween(left.doc, 'task_checkAddress', 'gateway_afterCheckAddress')).toBe('flow_checkAddressToAfterCheckAddress');
  });

  it('new files name their flows after their ends', async () => {
    const doc = Doc.create({ processName: 'P' });
    const cs = runOps(doc, [
      { op: 'add', kind: 'startEvent', name: 'S' },
      { op: 'add', kind: 'task', name: 'T', after: 'startEvent_s' },
    ]);
    expect(cs.created.map((created) => created.id)).toEqual(['startEvent_s', 'task_t', 'flow_sToT']);
  });

  it('files that number their flows get speaking flows (Flow_12 -> flow_bToEnd)', async () => {
    const xml = chain(
      [
        ['startEvent', 'Event_Start', 'Start'],
        ['task', 'Activity_A', 'A'],
        ['endEvent', 'Event_End', 'End'],
      ],
      ['Flow_11', 'Flow_12'],
    );
    const result = await created(xml, [{ op: 'add', kind: 'task', name: 'B', after: 'Activity_A' }]);
    expect(result.ids).toEqual(['task_b', 'flow_bToEnd']);
    // a numbered flow says nothing about its ends: it keeps its id when a splice changes them
    expect(flowBetween(result.doc, 'Activity_A', 'task_b')).toBe('Flow_12');
  });
});

describe('German names', () => {
  it('transliterates umlauts as ae / oe / ue / ss', async () => {
    const doc = Doc.create({ processName: 'Prüfung' });
    expect(doc.processes()[0]!.get('id')).toBe('pruefung');
    const cs = runOps(doc, [{ op: 'add', kind: 'task', name: 'Größe prüfen' }]);
    expect(cs.created[0]!.id).toBe('task_groessePruefen');
    const camel = runOps(await Doc.fromXml(CAMEL), [{ op: 'add', kind: 'userTask', name: 'Änderung übernehmen', in: 'Process_1' }]);
    expect(camel.created[0]!.id).toBe('userTask_aenderungUebernehmen');
  });

  it('E_NOT_FOUND suggests the id for another spelling of an umlaut', async () => {
    const doc = Doc.create({ processName: 'P' });
    runOps(doc, [{ op: 'add', kind: 'task', name: 'Prüfung' }]);
    for (const query of ['task_prufung', 'task_prüfung']) {
      let candidates: string[] = [];
      try {
        doc.require(query);
      } catch (err) {
        candidates = (err as { details: { candidates: string[] } }).details.candidates;
      }
      expect(candidates).toContain('task_pruefung');
    }
  });
});

describe('documentation', () => {
  it('bpmn kinds --json describes the id conventions', () => {
    const ids = kindsJson()['ids'] as { bodies: Record<string, string>; length: string };
    expect(Object.keys(ids.bodies).sort()).toEqual(['camel', 'kebab', 'pascal', 'snake']);
    expect(ids.length).toMatch(/^at most 64 characters, a collision suffix included; a name gives at most 40 characters of words \(a single longer word is cut at 40\), and an id within 64 is not cut again; a longer one loses whole words/);
    expect(guideText()).toContain('Ids speak and follow element-id-naming');
    expect(JSON.stringify(kindsJson()['ids'])).not.toMatch(/hash of|base-36/);
  });
});

describe('ids through the pipeline', () => {
  it('a write reports the generated ids', async () => {
    const doc = await Doc.fromXml(CAMEL);
    const result = await mutateDoc(doc, [{ op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' }], { dryRun: true, layout: false });
    expect(result.changes.created.map((created) => created.id)).toEqual(['userTask_packGoods', 'flow_packGoodsToApproveOrder']);
    expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_packGoodsToApproveOrder" sourceRef="userTask_packGoods" targetRef="userTask_approveOrder" />');
  });
});
