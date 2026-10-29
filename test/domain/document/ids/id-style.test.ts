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
  for (let flowIndex = 0; flowIndex + 1 < nodes.length; flowIndex++) {
    body.push(`<bpmn:sequenceFlow id="${flowIds[flowIndex]}" sourceRef="${nodes[flowIndex]![1]}" targetRef="${nodes[flowIndex + 1]![1]}" />`);
  }
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
    for (const id of [...spliceEdit.ids, ...unnamedEdit.ids]) {
      expect(id).not.toMatch(NOT_SPEAKING);
    }
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
    for (const id of right.ids) {
      expect(left.doc.ids.has(id)).toBe(false);
    }
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
