/**
 * Edits follow the file: generated ids take the id style of the file they
 * are written into (src/domain/document/ids/IdStyle.ts) and say what they name (never a hash or
 * a running number: names, kind + context, the ends of a flow), names are
 * transliterated the German way. All fixtures are synthetic.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../../src/api.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { IdStyle } from '../../../../src/domain/document/ids/IdStyle.js';
import { runOps } from '../../../../src/index.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../../src/index.js';
import { guideText, kindsJson } from '../../../../src/index.js';
import { definitionsXml, flowBetween } from '../../../helpers/helpers.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

/** Type-named lowerCamel prefixes with camelCase bodies and `flow_<from>To<To>` flows. */
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

/** design-iq style: `Task_snake_case`, `Flow_<from>_<to>` with the full ids. */
const SNAKE = chain(
  [
    ['startEvent', 'Event_order_received', 'Order received'],
    ['userTask', 'Task_check_risk', 'Check risk'],
    ['exclusiveGateway', 'Gateway_risk_ok', 'Risk ok?'],
    ['serviceTask', 'Task_approve_order', 'Approve order'],
    ['endEvent', 'Event_order_done', 'Order done'],
  ],
  ['Flow_Event_order_received_Task_check_risk', 'Flow_Task_check_risk_Gateway_risk_ok', 'Flow_Gateway_risk_ok_Task_approve_order', 'Flow_Task_approve_order_Event_order_done'],
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

describe('id style inference (edits follow the file)', () => {
  it('learns nothing from a file without conventions: the bpmn-cli default', async () => {
    const style = IdStyle.infer((await Doc.fromXml(definitionsXml('<bpmn:task id="T" name="Lonely" />'))).definitions).info();
    expect(style).toEqual({ body: 'pascal', sequenceFlow: { form: 'named', prefix: 'Flow' }, messageFlow: { form: 'named', prefix: 'Flow' } });
  });

  it('a Camunda Modeler file gets speaking ids with the modeler prefixes; flows name their ends', async () => {
    const ops: EditCommand[] = [{ op: 'add', kind: 'userTask', name: 'Pack order', after: 'Activity_0k3x9qa' }];
    const spliceEdit = await created(MODELER, ops);
    // hashes show no case: pascal bodies, the file's prefixes and flow prefix
    expect(IdStyle.infer((await Doc.fromXml(MODELER)).definitions).info()).toEqual({ body: 'pascal', sequenceFlow: { form: 'named', prefix: 'Flow' }, messageFlow: { form: 'named', prefix: 'Flow' } });
    // `--after` splices: the anchor's (hashed) flow keeps its id and now ends at the new node, a new flow runs on to the
    // old target, named after the ends (the gateway by its name: its id says nothing)
    expect(spliceEdit.ids).toEqual(['Activity_PackOrder', 'Flow_PackOrderToOrderOk']);
    expect(flowBetween(spliceEdit.doc, 'Activity_0k3x9qa', 'Activity_PackOrder')).toBe('Flow_1q2w3e4');
    // the same edit on the same file gives the same ids
    expect((await created(MODELER, ops)).ids).toEqual(spliceEdit.ids);
    // unnamed elements: a word for the kind and the context (Timer On <host>, After <anchor>)
    const unnamedEdit = await created(MODELER, [
      { op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_0k3x9qa', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', after: 'Event_TimerOnCheckOrder' },
      { op: 'add', kind: 'parallelGateway', after: 'Activity_1m2n3b4' },
    ]);
    // a flow names an unnamed end by its own id's speaking part (its kind and place), never by a bare kind word
    expect(unnamedEdit.ids).toEqual(['Event_TimerOnCheckOrder', 'Event_EndAfterTimerOnCheckOrder', 'Flow_TimerOnCheckOrderToEndAfterTimerOnCheckOrder', 'Gateway_AfterShipOrder', 'Flow_AfterShipOrderToOrderShipped']);
    for (const id of [...spliceEdit.ids, ...unnamedEdit.ids]) expect(id).not.toMatch(NOT_SPEAKING);
  });

  it('type-named camelCase files: serviceTask_checkStock, flow_checkStockToApproveOrder', async () => {
    const { ids, doc } = await created(CAMEL, [
      { op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' },
      { op: 'add', kind: 'sendTask', name: 'Notify customer', after: 'serviceTask_shipOrder' },
      { op: 'add', kind: 'parallelGateway', in: 'Process_1' },
    ]);
    expect(ids.slice(0, 2)).toEqual(['userTask_packGoods', 'flow_packGoodsToApproveOrder']);
    // sendTask is new to the file: its type names the prefix like the other kinds' types do
    expect(ids.slice(2, 4)).toEqual(['sendTask_notifyCustomer', 'flow_notifyCustomerToOrderShipped']);
    // an unnamed gateway: the file's gateway prefix, a word for the kind (no placement context: --in the process)
    expect(ids[4]).toBe('gateway_parallel');
    // the spliced flow named its old ends in the file's form: it is renamed after its new ones (and reported so)
    expect(flowBetween(doc, 'serviceTask_checkStock', 'userTask_packGoods')).toBe('flow_checkStockToPackGoods');
  });

  it('snake_case files with flows named after their ends: Task_pack_goods, Flow_<from>_<to>', async () => {
    const { ids } = await created(SNAKE, [
      { op: 'add', kind: 'serviceTask', name: 'Pack goods', after: 'Task_check_risk' },
      { op: 'add', kind: 'endEvent', name: 'Order rejected', after: 'Gateway_risk_ok' },
    ]);
    expect(ids).toEqual(['Task_pack_goods', 'Flow_Task_pack_goods_Gateway_risk_ok', 'Event_order_rejected', 'Flow_Gateway_risk_ok_Event_order_rejected']);
  });

  it('#31: a flow between two long ids keeps both prefixes and cuts whole words after them, and still follows its ends', async () => {
    const { doc, ids } = await created(SNAKE, [
      { op: 'add', kind: 'userTask', name: 'Lieferantenbestellungen prüfen', after: 'Task_check_risk' },
      { op: 'add', kind: 'userTask', name: 'Zahlungseingänge abgleichen und Rechnung archivieren', after: 'Task_lieferantenbestellungen_pruefen' },
    ]);
    // the name's 40 characters end before a filler word (before: Task_zahlungseingaenge_abgleichen_und)
    expect(ids).toContain('Task_zahlungseingaenge_abgleichen');
    // 0.6: Flow_Task_pruefen_Task_zahlungseingaenge_abgleichen_und
    const cut = 'Flow_Task_lieferantenbestellungen_pruefen_Task_zahlungseingaenge';
    expect(flowBetween(doc, 'Task_lieferantenbestellungen_pruefen', 'Task_zahlungseingaenge_abgleichen')).toBe(cut);
    const cs = runOps(doc, [{ op: 'add', kind: 'userTask', name: 'Beleg scannen', after: 'Task_lieferantenbestellungen_pruefen' }]);
    expect(cs.renames).toEqual([expect.objectContaining({ from: cut, to: 'Flow_Task_lieferantenbestellungen_pruefen_Task_beleg_scannen' })]);
  });

  it('numbered files keep their prefixes, but the bodies speak (no running numbers)', async () => {
    const { ids } = await created(NUMBERED, [
      { op: 'add', kind: 'task', name: 'Third', after: 'Task_2' },
      { op: 'add', kind: 'endEvent', name: 'Abort', in: 'Process_1' },
    ]);
    expect(ids).toEqual(['Task_Third', 'SF_ThirdToFinish', 'End_Abort']);
  });

  it('old modeler files: type-named prefixes and SequenceFlow_ flows, speaking bodies', async () => {
    const { ids } = await created(OLD_MODELER, [
      { op: 'add', kind: 'task', name: 'Archive', after: 'Task_0cde345' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', in: 'Process_1' },
    ]);
    expect(ids).toEqual(['Task_Archive', 'SequenceFlow_ArchiveToDone', 'ExclusiveGateway_Ok']);
  });

  it('custom prefixes per kind (Start_, End_), the family prefix (Task_) for a new task kind', async () => {
    const xml = chain(
      [
        ['startEvent', 'Start_Received', 'Received'],
        ['userTask', 'Task_Check', 'Check'],
        ['serviceTask', 'Task_Book', 'Book'],
        ['endEvent', 'End_Done', 'Done'],
        ['endEvent', 'End_Failed', 'Failed'],
      ],
      ['Flow_a', 'Flow_b', 'Flow_c', 'Flow_d'],
    );
    const { ids } = await created(xml, [
      { op: 'add', kind: 'sendTask', name: 'Notify', in: 'Process_1' },
      { op: 'add', kind: 'endEvent', name: 'Cancelled', in: 'Process_1' },
      { op: 'add', kind: 'boundaryEvent:timer', name: 'Late', on: 'Task_Check' },
    ]);
    expect(ids).toEqual(['Task_Notify', 'End_Cancelled', 'Event_Late']);
  });

  it('Task_ on a plain task is the family prefix, not evidence for type-named prefixes', async () => {
    // type-named file with a plain Task_ task: a new user task is userTask_
    const typed = chain(
      [
        ['startEvent', 'startEvent_go', 'Go'],
        ['serviceTask', 'serviceTask_load', 'Load'],
        ['task', 'Task_check', 'Check'],
        ['serviceTask', 'serviceTask_store', 'Store'],
        ['endEvent', 'endEvent_done', 'Done'],
      ],
      ['f1', 'f2', 'f3', 'f4'],
    );
    expect((await created(typed, [{ op: 'add', kind: 'userTask', name: 'Approve', in: 'Process_1' }])).ids).toEqual(['userTask_approve']);
    // Task_ for every task, custom event prefixes: a new user task is Task_
    const plain = chain(
      [
        ['startEvent', 'Start_go', 'Go'],
        ['task', 'Task_load', 'Load'],
        ['task', 'Task_check', 'Check'],
        ['endEvent', 'End_done', 'Done'],
      ],
      ['f1', 'f2', 'f3'],
    );
    expect((await created(plain, [{ op: 'add', kind: 'userTask', name: 'Approve', in: 'Process_1' }])).ids).toEqual(['Task_approve']);
  });

  it('the body style comes from the flow nodes when they show one (pools and lanes often keep other ids)', async () => {
    const xml = definitionsXml(
      [
        '<bpmn:laneSet id="LaneSet_0aa1111"><bpmn:lane id="Lane_Sales" name="Sales" /><bpmn:lane id="Lane_BackOffice" name="Back office" /><bpmn:lane id="Lane_Shipping" name="Shipping" /></bpmn:laneSet>',
        '<bpmn:task id="Task_7" name="Load" />',
        '<bpmn:task id="Task_8" name="Store" />',
      ].join('\n'),
    );
    expect((await created(xml, [{ op: 'add', kind: 'task', name: 'Check', in: 'Process_1' }])).ids).toEqual(['Task_Check']);
  });

  it('warns W_ID_SUFFIXED and names the --if-absent id in the file style', async () => {
    const doc = await Doc.fromXml(CAMEL);
    const cs = runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Check stock', in: 'Process_1' }]);
    expect(cs.created[0]!.id).toBe('serviceTask_checkStock_2');
    expect(cs.warnings.map((warning) => warning.message)).toEqual(['Id serviceTask_checkStock is already taken; using serviceTask_checkStock_2']);
    let hint = '';
    try {
      runOps(doc, [{ op: 'add', kind: 'userTask', name: 'Pack goods', in: 'Process_1', ifAbsent: true }]);
    } catch (err) {
      hint = String((err as { details?: { hint?: string } }).details?.hint);
    }
    expect(hint).toContain('--id userTask_packGoods');
  });

  it('a split joins at a gateway named in the file style (camel: <id>Join; else <id>_join)', async () => {
    const split: EditCommand = { op: 'split', after: 'userTask_approveOrder', kind: 'parallel', name: 'Fan out', branches: [{ nodes: [{ kind: 'task', name: 'Left' }] }, { nodes: [{ kind: 'task', name: 'Right' }] }] };
    expect((await created(CAMEL, [split])).ids).toContain('gateway_fanOutJoin');
    const modeler = await created(MODELER, [{ ...split, after: 'Activity_0k3x9qa' } as EditCommand]);
    expect(modeler.ids.filter((id) => id.startsWith('Gateway_'))).toEqual(['Gateway_FanOut', 'Gateway_FanOut_join']);
    // an unnamed split gateway: After <anchor>
    const unnamed = await created(MODELER, [{ ...split, name: undefined, after: 'Activity_0k3x9qa' } as EditCommand]);
    expect(unnamed.ids.filter((id) => id.startsWith('Gateway_'))).toEqual(['Gateway_AfterCheckOrder', 'Gateway_AfterCheckOrder_join']);
    // the gateways' flows name them by their ids' speaking parts: the split AfterCheckOrder, its join CheckOrderJoin
    expect(unnamed.ids).toEqual(expect.arrayContaining(['Flow_AfterCheckOrderToLeft', 'Flow_LeftToCheckOrderJoin', 'Flow_CheckOrderJoinToOrderOk']));
  });
});

describe('id style inference: ids without prefix, numbers without separator, scoped flow names', () => {
  /** Hand-written ids: camelCase without prefix, flows numbered without separator. */
  const BARE = chain(
    [
      ['startEvent', 'orderReceived', 'Order received'],
      ['task', 'checkOrder', 'Check order'],
      ['task', 'packGoods', 'Pack goods'],
      ['task', 'shipOrder', 'Ship order'],
      ['endEvent', 'orderShipped', 'Order shipped'],
    ],
    ['flow1', 'flow2', 'flow3', 'flow4'],
  );

  it('a file whose ids have no prefix gets bare camelCase ids; flows keep the glued prefix (flow12 -> flowReviewOrderToPackGoods)', async () => {
    const { ids } = await created(BARE, [{ op: 'add', kind: 'task', name: 'Review order', after: 'checkOrder' }]);
    expect(ids).toEqual(['reviewOrder', 'flowReviewOrderToPackGoods']);
    // another kind of the family (no own evidence) follows the family; a second one with the same name gets a suffix
    const more = await created(BARE, [
      { op: 'add', kind: 'userTask', name: 'Review order', after: 'checkOrder' },
      { op: 'add', kind: 'userTask', name: 'Review order', after: 'packGoods' },
    ]);
    expect(more.ids).toEqual(['reviewOrder', 'flowReviewOrderToPackGoods', 'reviewOrder_2', 'flowReviewOrder2ToShipOrder']);
    expect(more.warnings).toEqual(['W_ID_SUFFIXED']);
  });

  it("#31: bpmn-cli's own suffixed flows do not vote for a prefix: the file keeps flowAToB, a splice follows them, every id within 64", async () => {
    const { doc } = await created(BARE, [
      { op: 'add', kind: 'task', name: 'Vertragsunterlagenarchivierung an', after: 'shipOrder', as: '$a' },
      { op: 'add', kind: 'task', name: 'Kundenstammdatenaktualisierung café', after: '$a', as: '$b' },
      ...[1, 2, 3, 4].map((): EditCommand => ({ op: 'connect', source: '$a', target: '$b' })),
    ]);
    const suffixed = 'flowVertragsunterlagenarchivieToKundenstammdatenaktualisierung_5';
    expect(doc.ids.has(suffixed)).toBe(true);
    // flowVertragsunterlagenarchivieToKundenstammdatenaktualisierung_2 is no prefix and a number (0.6 learned it: ..._ToKundenstammdatena, 82 characters)
    const again = await Doc.fromXml(await doc.toXml());
    expect(again.ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'flow', sep: '' });
    const cs = runOps(again, [{ op: 'add', kind: 'task', name: 'Zwischenschritt', flow: suffixed }]);
    expect(cs.renames).toEqual([expect.objectContaining({ from: suffixed, to: 'flowVertragsunterlagenarchivierungAnToZwischenschritt' })]);
    expect([...again.ids.values()].filter((id) => id.length > 64)).toEqual([]);
  });

  it("#31: bpmn-cli's own suffixed flows still count for a flow12 file's form, as in 0.6: the file keeps flowAToB as long", async () => {
    const tasks = ['Check', 'Ship', 'Bill', 'Archive', 'Pay', 'Log', 'Send'].map((taskName): [string, string, string] => ['task', `Activity_${taskName}`, taskName]);
    const glued = chain(tasks, ['flow1', 'flow2', 'flow3', 'flowArchiveToPay', 'flowPayToLog', 'flowLogToSend']);
    const { doc } = await created(glued, [
      { op: 'connect', source: 'Activity_Pay', target: 'Activity_Log' },
      { op: 'add', kind: 'task', name: 'Done', after: 'Activity_Send' },
    ]);
    expect(doc.ids.has('flowPayToLog_2') && doc.ids.has('flowSendToDone')).toBe(true);
    // three flow12 ids, four glued flows and one with a suffix (before: the suffixed one did not count, the file read as
    // Flow_, and the splice kept flowLogToSend on the flow to Audit)
    const again = await Doc.fromXml(await doc.toXml());
    expect(again.ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'flow', sep: '' });
    const cs = runOps(again, [{ op: 'add', kind: 'task', name: 'Audit', flow: 'flowLogToSend' }]);
    expect(cs.renames).toEqual([expect.objectContaining({ from: 'flowLogToSend', to: 'flowLogToAudit' })]);
    expect(cs.created.map((created) => created.id)).toEqual(['Activity_Audit', 'flowAuditToSend']);
    // and after three more commands: the glued flows without a suffix vote for flow12's prefix too (before: three flow12
    // ids and the suffixed flow against eight of them, the file read as Flow_ and the splice kept flowLogToAudit)
    let xml = await again.toXml();
    for (const [name, after] of [['File', 'Activity_Done'], ['Close', 'Activity_File'], ['Report', 'Activity_Close']]) {
      const next = await Doc.fromXml(xml);
      runOps(next, [{ op: 'add', kind: 'task', name, after }]);
      xml = await next.toXml();
    }
    const later = await Doc.fromXml(xml);
    expect(later.ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'flow', sep: '' });
    const spliced = runOps(later, [{ op: 'add', kind: 'task', name: 'Weigh', flow: 'flowLogToAudit' }]);
    expect(spliced.renames).toEqual([expect.objectContaining({ from: 'flowLogToAudit', to: 'flowLogToWeigh' })]);
    expect(spliced.created.map((created) => created.id)).toEqual(['Activity_Weigh', 'flowWeighToAudit']);
  });

  it('an unnamed element in such a file still gets a prefix (its kind and context need one)', async () => {
    const { ids } = await created(BARE, [{ op: 'add', kind: 'exclusiveGateway', after: 'packGoods' }]);
    expect(ids).toEqual(['Gateway_AfterPackGoods', 'flowAfterPackGoodsToShipOrder']);
  });

  it('single lower-case words read as camelCase (not snake_case, which would read as a prefix); a PascalCase file stays PascalCase', async () => {
    const lower = chain(
      [
        ['startEvent', 'start', 'Start'],
        ['serviceTask', 'prepare', 'Prepare'],
        ['serviceTask', 'branch1', 'Branch 1'],
        ['parallelGateway', 'join'],
        ['endEvent', 'end', 'End'],
      ],
      ['f0', 'f1', 'f2', 'f3'],
    );
    expect((await created(lower, [{ op: 'add', kind: 'serviceTask', name: 'Check stock', after: 'prepare' }])).ids).toEqual(['checkStock', 'fCheckStockToBranch1']);
    const pascal = chain(
      [
        ['startEvent', 'OrderReceived', 'Order received'],
        ['task', 'CheckOrder', 'Check order'],
        ['task', 'ShipOrder', 'Ship order'],
        ['endEvent', 'OrderShipped', 'Order shipped'],
      ],
      ['Flow_1', 'Flow_2', 'Flow_3'],
    );
    expect((await created(pascal, [{ op: 'add', kind: 'task', name: 'Review order', after: 'CheckOrder' }])).ids).toEqual(['ReviewOrder', 'Flow_ReviewOrderToShipOrder']);
    // a kind of another family without own evidence: the file's flow nodes have no prefixes, so neither does it
    expect((await created(pascal, [{ op: 'add', kind: 'exclusiveGateway', name: 'Order ok?', after: 'CheckOrder' }])).ids).toEqual(['OrderOk', 'Flow_OrderOkToShipOrder']);
  });

  it('a kind without prefix next to prefixed kinds: only that kind goes bare', async () => {
    const mixed = chain(
      [
        ['startEvent', 'StartEvent_1'],
        ['userTask', 'first', 'First'],
        ['userTask', 'second', 'Second'],
        ['endEvent', 'Event_16m42dv'],
      ],
      ['Flow_03y1k7c', 'Flow_02qw1n8', 'Flow_01kyget'],
    );
    const { ids } = await created(mixed, [{ op: 'add', kind: 'userTask', name: 'Review order', after: 'first' }]);
    expect(ids).toEqual(['reviewOrder', 'Flow_ReviewOrderToSecond']);
    // the events are prefixed (Event_16m42dv): a new event keeps a prefix
    expect((await created(mixed, [{ op: 'add', kind: 'boundaryEvent:timer', name: 'Timeout', on: 'first', timer: 'PT1H' }])).ids).toEqual(['Event_Timeout']);
  });

  it('flows named Flow_<scope>_<A>To<B>: the scope of the ends and the first word of each end', async () => {
    const scoped = chain(
      [
        ['startEvent', 'startEvent_KotOrder', 'Order placed'],
        ['serviceTask', 'serviceTask_KotO_ValidatePayment', 'Validate payment'],
        ['serviceTask', 'serviceTask_KotO_ReserveInventory', 'Reserve inventory'],
        ['userTask', 'userTask_KotO_ConfirmShipment', 'Confirm shipment'],
        ['endEvent', 'endEvent_KotOrder', 'Order done'],
      ],
      ['Flow_KotO_StartToValidate', 'Flow_KotO_ValidateToReserve', 'Flow_KotO_ReserveToConfirm', 'Flow_KotO_ConfirmToEnd'],
    );
    const doc = await Doc.fromXml(scoped);
    expect(doc.ownIdStyle.info().sequenceFlow).toEqual({ form: 'scopedTo', prefix: 'Flow', scope: 'KotO' });
    const reviewEdit = await created(scoped, [{ op: 'add', kind: 'userTask', id: 'userTask_KotO_ReviewOrder', name: 'Review order', after: 'serviceTask_KotO_ReserveInventory' }]);
    expect(reviewEdit.ids).toEqual(['userTask_KotO_ReviewOrder', 'Flow_KotO_ReviewToConfirm']);
    // an end event as the target, a start event as the source; a second flow of the same words gets a number
    const ends = await created(scoped, [
      { op: 'add', kind: 'endEvent', id: 'endEvent_KotO_Failed', name: 'Failed', in: 'Process_1' },
      { op: 'connect', source: 'serviceTask_KotO_ValidatePayment', target: 'endEvent_KotO_Failed' },
      { op: 'connect', source: 'startEvent_KotOrder', target: 'userTask_KotO_ConfirmShipment' },
      { op: 'connect', source: 'startEvent_KotOrder', target: 'userTask_KotO_ConfirmShipment' },
    ]);
    expect(ends.ids).toEqual(['endEvent_KotO_Failed', 'Flow_KotO_ValidateToEnd', 'Flow_KotO_StartToConfirm', 'Flow_KotO_StartToConfirm2']);
  });

  it('#31: long end words share the room like any flow\'s ends, and a number is no end word', async () => {
    const scoped = chain(
      [
        ['startEvent', 'startEvent_KotOrder', 'Order placed'],
        ['serviceTask', 'serviceTask_KotO_ValidatePayment', 'Validate payment'],
        ['serviceTask', 'serviceTask_KotO_ReserveInventory', 'Reserve inventory'],
        ['endEvent', 'endEvent_KotOrder', 'Order done'],
      ],
      ['Flow_KotO_StartToValidate', 'Flow_KotO_ValidateToReserve', 'Flow_KotO_ReserveToEnd'],
    );
    const { doc } = await created(scoped, [
      { op: 'add', kind: 'serviceTask', id: 'serviceTask_KotO_Warenwirtschaftssystemabgleich', name: 'Warenwirtschaftssystemabgleich', after: 'serviceTask_KotO_ValidatePayment' },
      { op: 'add', kind: 'serviceTask', id: 'serviceTask_KotO_Kundenstammdatenaktualisierung', name: 'Kundenstammdatenaktualisierung', after: 'serviceTask_KotO_Warenwirtschaftssystemabgleich' },
      { op: 'add', kind: 'serviceTask', id: 'serviceTask_KotO_4AugenPruefen', name: '4 Augen prüfen', after: 'serviceTask_KotO_ReserveInventory' },
      { op: 'connect', source: 'serviceTask_KotO_Warenwirtschaftssystemabgleich', target: 'serviceTask_KotO_Kundenstammdatenaktualisierung' },
    ]);
    // 0.6: Flow_KotO_WarenwirtschaftssystemabgleichTo, the target gone; then ...To2, which the form no longer reads
    expect(flowBetween(doc, 'serviceTask_KotO_Warenwirtschaftssystemabgleich', 'serviceTask_KotO_Kundenstammdatenaktualisierung')).toBe('Flow_KotO_WarenwirtschaftssystemToKundenstammdatenaktualisierung');
    expect(doc.ids.has('Flow_KotO_WarenwirtschaftssysteToKundenstammdatenaktualisierung2')).toBe(true);
    // 0.6: Flow_KotO_ReserveTo4 (a second one: ...To42)
    expect(flowBetween(doc, 'serviceTask_KotO_ReserveInventory', 'serviceTask_KotO_4AugenPruefen')).toBe('Flow_KotO_ReserveToAugen');
    expect(IdStyle.infer(doc.definitions).info().sequenceFlow).toEqual({ form: 'scopedTo', prefix: 'Flow', scope: 'KotO' });
  });

  it('a glued suffix after an end that ends in a digit takes the word No (stemTo, scopedTo); such flows and 0.6\'s glued ones follow their ends', async () => {
    // before: flow_checkStockToSendPdf102 (a flow to Send PDF 102?), flow_checkStockToSend_22
    const { doc, ids } = await created(CAMEL, [
      { op: 'add', kind: 'serviceTask', id: 'serviceTask_sendPdf10', name: 'Send PDF 10', in: 'Process_1' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_sendPdf10' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_sendPdf10' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_sendPdf10' },
      { op: 'add', kind: 'serviceTask', id: 'serviceTask_send_2', name: 'Send', in: 'Process_1' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_send_2' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'serviceTask_send_2' },
      { op: 'connect', source: 'serviceTask_checkStock', target: 'userTask_approveOrder' },
    ]);
    expect(ids).toEqual([
      'serviceTask_sendPdf10',
      'flow_checkStockToSendPdf10',
      'flow_checkStockToSendPdf10No2',
      'flow_checkStockToSendPdf10No3',
      'serviceTask_send_2',
      'flow_checkStockToSend_2',
      'flow_checkStockToSend_2No2',
      // an end that ends in a letter keeps the glued 2
      'flow_checkStockToApproveOrder2',
    ]);
    // they vote for the file's form, and a splice renames them after their new ends
    expect(IdStyle.infer(doc.definitions).info().sequenceFlow).toEqual({ form: 'stemTo', prefix: 'flow' });
    const spliced = runOps(doc, [{ op: 'add', kind: 'serviceTask', id: 'serviceTask_pack', name: 'Pack', flow: 'flow_checkStockToSendPdf10No2' }]);
    expect(spliced.renames).toEqual([expect.objectContaining({ from: 'flow_checkStockToSendPdf10No2', to: 'flow_checkStockToPack' })]);
    // a scoped flow whose end word ends in a digit
    const scoped = chain(
      [
        ['serviceTask', 'serviceTask_KotO_ValidatePayment', 'Validate payment'],
        ['serviceTask', 'serviceTask_KotO_ReserveInventory', 'Reserve inventory'],
        ['serviceTask', 'serviceTask_KotO_Pdf10Senden', 'PDF 10 senden'],
      ],
      ['Flow_KotO_ValidateToReserve', 'Flow_KotO_ReserveToPdf10'],
    );
    const connectEdit = await created(scoped, [{ op: 'connect', source: 'serviceTask_KotO_ReserveInventory', target: 'serviceTask_KotO_Pdf10Senden' }]);
    expect(connectEdit.ids).toEqual(['Flow_KotO_ReserveToPdf10No2']);
    // 0.6 glued the number to the digit: its flows still follow their ends
    const old = chain(
      [
        ['startEvent', 'startEvent_orderReceived', 'Order received'],
        ['serviceTask', 'serviceTask_checkStock', 'Check stock'],
        ['serviceTask', 'serviceTask_sendPdf10', 'Send PDF 10'],
      ],
      ['flow_orderReceivedToCheckStock', 'flow_checkStockToSendPdf102'],
    );
    const followed = runOps(await Doc.fromXml(old), [{ op: 'add', kind: 'serviceTask', id: 'serviceTask_pack', name: 'Pack', flow: 'flow_checkStockToSendPdf102' }]);
    expect(followed.renames).toEqual([expect.objectContaining({ from: 'flow_checkStockToSendPdf102', to: 'flow_checkStockToPack' })]);
  });

  it('the scoped form is not read into other forms', async () => {
    for (const xml of [CAMEL, SNAKE, MODELER]) expect((await Doc.fromXml(xml)).ownIdStyle.info().sequenceFlow.form).not.toBe('scopedTo');
  });
});

describe('a file\'s flow form stays put, and flows named after their ends follow under every prefix the file uses', () => {
  /** Tasks A..F, flows `[id, source, target]` in this order. */
  const tasks = (flows: Array<[string, string, string]>): string =>
    definitionsXml(
      [
        ...['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => {
          const id = `Activity_${letter}`;
          const links = [...flows.filter((flow) => flow[2] === id).map((flow) => `<bpmn:incoming>${flow[0]}</bpmn:incoming>`), ...flows.filter((flow) => flow[1] === id).map((flow) => `<bpmn:outgoing>${flow[0]}</bpmn:outgoing>`)];
          return `<bpmn:task id="${id}" name="${letter}">${links.join('')}</bpmn:task>`;
        }),
        ...flows.map(([id, source, target]) => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`),
      ].join('\n'),
    );

  it("bpmn-cli's own glued flows vote for the file's glued prefix: six adds to an f1 file keep fAToB, and each splice renames", async () => {
    let xml = readFileSync(join(HERE, 'fixtures', 'incremental', 'polish-rename.bpmn'), 'utf8');
    let prev = 'A';
    const renames: Array<Record<string, string>> = [];
    for (const name of ['Pack', 'Weigh', 'Label', 'Notify', 'Bill', 'Archive']) {
      const result = await applyToXml(xml, [{ op: 'add', kind: 'task', name, after: prev, as: '$t' }], { layout: false });
      renames.push(result.result.renamed ?? {});
      prev = result.result.aliases!.$t!;
      xml = result.xml;
    }
    // before: four f flows of nine after the fifth add, the file read as Flow_; the sixth kept fBillTo... on Archive -> C
    // and named the new flow Flow_ArchiveToShipTheGoodsToTheCustomer
    expect(renames.at(-1)).toEqual({ fBillToShipTheGoodsToTheCustomer: 'fBillToArchive' });
    expect([...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((match) => match[1])).toEqual(['f1', 'f2', 'fPackToWeigh', 'fWeighToLabel', 'fLabelToNotify', 'fNotifyToBill', 'fBillToArchive', 'fArchiveToShipTheGoodsToTheCustomer', 'f3', 'f4']);
    expect((await Doc.fromXml(xml)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'f', sep: '' });
  });

  it.each([
    ['snake_case', ['task_pack_goods', 'task_check_order', 'task_ship_goods'], ['fweigh_parcel_to_label_parcel', 'flabel_parcel_to_notify_customer', 'fnotify_customer_to_bill_customer', 'fbill_customer_to_archive_order', 'farchive_order_to_close_case', 'fclose_case_to_event'], { farchive_order_to_event: 'farchive_order_to_close_case' }],
    ['Pascal_Snake', ['Task_Pack_Goods', 'Task_Check_Order', 'Task_Ship_Goods'], ['fWeigh_Parcel_To_Label_Parcel', 'fLabel_Parcel_To_Notify_Customer', 'fNotify_Customer_To_Bill_Customer', 'fBill_Customer_To_Archive_Order', 'fArchive_Order_To_Close_Case', 'fClose_Case_To_Event'], { fArchive_Order_To_Event: 'fArchive_Order_To_Close_Case' }],
  ])("in a %s body too: bpmn-cli's glued flows (with `_`) vote for f, six adds keep it (eight with ids kept)", async (_body, [firstId, secondId, thirdId], glued, last) => {
    const ends: Array<[string, string, string]> = [['f1', 'start_event', firstId!], ['f2', firstId!, secondId!], ['f3', secondId!, thirdId!], ['f4', thirdId!, 'end_event']];
    const links = (id: string): string => [...ends.filter((flow) => flow[2] === id).map((flow) => `<bpmn:incoming>${flow[0]}</bpmn:incoming>`), ...ends.filter((flow) => flow[1] === id).map((flow) => `<bpmn:outgoing>${flow[0]}</bpmn:outgoing>`)].join('');
    const start = definitionsXml(
      [
        `<bpmn:startEvent id="start_event">${links('start_event')}</bpmn:startEvent>`,
        ...[firstId!, secondId!, thirdId!].map((id, taskIndex) => `<bpmn:task id="${id}" name="${['Pack goods', 'Check order', 'Ship goods'][taskIndex]}">${links(id)}</bpmn:task>`),
        `<bpmn:endEvent id="end_event">${links('end_event')}</bpmn:endEvent>`,
        ...ends.map(([id, source, target]) => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`),
      ].join('\n'),
    );
    /** Adds the tasks one by one, each after the one before; the last command's renames and the file. */
    const walk = async (names: string[], keepFlowIds: boolean): Promise<{ renamed: Record<string, string>; xml: string }> => {
      let xml = start;
      let prev = thirdId!;
      let renamed: Record<string, string> = {};
      for (const name of names) {
        const result = await applyToXml(xml, [{ op: 'add', kind: 'task', name, after: prev, as: '$t' }], { layout: false, keepFlowIds });
        renamed = result.result.renamed ?? {};
        prev = result.result.aliases!.$t!;
        xml = result.xml;
      }
      return { renamed, xml };
    };
    const names = ['Weigh parcel', 'Label parcel', 'Notify customer', 'Bill customer', 'Archive order', 'Close case'];
    const { renamed, xml } = await walk(names, false);
    // before: `fweigh_parcel_to_...` read as the prefix fweigh and voted nothing; after the fifth add the file read as
    // Flow_, and the sixth renamed the file's own glued flow to Flow_archive_order_to_close_case
    expect(renamed).toEqual(last);
    expect([...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((match) => match[1])).toEqual(['f1', 'f2', 'f3', 'f4', ...glued]);
    expect((await Doc.fromXml(xml)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'f', sep: '' });
    // with ids kept the spliced flows keep `..._to_event` on their new targets: they still name their source after f
    const kept = await walk([...names, 'File case', 'Audit case'], true);
    expect((await Doc.fromXml(kept.xml)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'f', sep: '' });
  });

  it('a glued flow votes only for a glued numbered prefix it starts with; a flow of a plain glued name, or of another prefix, does not', async () => {
    const style = async (flows: string[]) => (await Doc.fromXml(tasks(flows.map((id, flowIndex) => [id, `Activity_${'ABCDEF'[flowIndex]}`, `Activity_${'ABCDEF'[flowIndex + 1]}`])))).ownIdStyle.info().sequenceFlow;
    expect(await style(['f1', 'fBToC', 'fCToD', 'fDToE'])).toEqual({ form: 'named', prefix: 'f', sep: '' });
    // `flowBToC` starts with flow, not with f followed by an upper-case letter; F12 glues no words (F_BToC)
    expect(await style(['f1', 'f2', 'flowCToD', 'flowDToE', 'flowEToF'])).toEqual({ form: 'named', prefix: 'Flow' });
    expect(await style(['F1', 'FBToC', 'FCToD', 'FDToE'])).toEqual({ form: 'named', prefix: 'Flow' });
    // with `_`: where it is the id bpmn-cli gives its ends after f in snake_case / Pascal_Snake; `flow_c_to_d` is not
    // (it would be fc_to_d), it counts for the prefix flow
    expect(await style(['f1', 'fb_to_c', 'fc_to_d', 'fd_to_e'])).toEqual({ form: 'named', prefix: 'f', sep: '' });
    expect(await style(['f1', 'fB_To_C', 'fC_To_D', 'fD_To_E'])).toEqual({ form: 'named', prefix: 'f', sep: '' });
    expect(await style(['f1', 'f2', 'flow_c_to_d', 'flow_d_to_e', 'flow_e_to_f'])).toEqual({ form: 'named', prefix: 'flow' });
  });

  it('a tie between flow prefixes goes to the one the flows use most, then alphabetically, never by declaration order', async () => {
    const fFlows: Array<[string, string, string]> = [['F1', 'Activity_A', 'Activity_B'], ['F2', 'Activity_B', 'Activity_C']];
    const gFlows: Array<[string, string, string]> = [['G1', 'Activity_C', 'Activity_D'], ['G2', 'Activity_D', 'Activity_E']];
    const underscoredFlows: Array<[string, string, string]> = [['F_EToF', 'Activity_E', 'Activity_F']];
    for (const flows of [[...fFlows, ...gFlows, ...underscoredFlows], [...gFlows, ...fFlows, ...underscoredFlows], [...underscoredFlows, ...gFlows, ...fFlows]]) {
      const xml = tasks(flows);
      expect((await Doc.fromXml(xml)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'F', sep: '' });
      // before: with G1, G2 declared first G won, F_EToF kept its id on E -> Log, and the new flow was G_LogToF
      const cs = runOps(await Doc.fromXml(xml), [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_E' }]);
      expect(cs.renames).toEqual([expect.objectContaining({ from: 'F_EToF', to: 'F_EToLog' })]);
      expect(cs.created.map((created) => created.id)).toEqual(['Activity_Log', 'F_LogToF']);
    }
    // nothing tells them apart: the alphabetically first
    const tied = [...gFlows, ...fFlows];
    expect((await Doc.fromXml(tasks(tied))).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'F', sep: '' });
    // two Camunda Modeler versions: SequenceFlow_ and Flow_ hashes, tied; SequenceFlow_ names one more flow
    const hashes = tasks([['Flow_0aaaaaa', 'Activity_A', 'Activity_B'], ['Flow_1bbbbbb', 'Activity_B', 'Activity_C'], ['SequenceFlow_0cccccc', 'Activity_C', 'Activity_D'], ['SequenceFlow_1dddddd', 'Activity_D', 'Activity_E'], ['SequenceFlow_EToF', 'Activity_E', 'Activity_F']]);
    expect((await Doc.fromXml(hashes)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'SequenceFlow' });
    // a glued prefix counts its flows too: f1, f2 against sf_1, sf_2 is a tie, f the alphabetically first (before: sf
    // whenever it was declared first)
    const chainOf = (ids: string[]): string => tasks(ids.map((id, flowIndex) => [id, `Activity_${'ABCDEF'[flowIndex]}`, `Activity_${'ABCDEF'[flowIndex + 1]}`]));
    for (const ids of [['f1', 'f2', 'sf_1', 'sf_2'], ['sf_1', 'sf_2', 'f1', 'f2']]) expect((await Doc.fromXml(chainOf(ids))).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'f', sep: '' });
    // a tie between two forms under one prefix goes to the one that names the ends (before: hashes declared first, named)
    for (const ids of [['Flow_0aaaaaa', 'Flow_1bbbbbb', 'Flow_Activity_C_Activity_D', 'Flow_Activity_D_Activity_E'], ['Flow_Activity_A_Activity_B', 'Flow_Activity_B_Activity_C', 'Flow_0cccccc', 'Flow_1dddddd']]) {
      expect((await Doc.fromXml(chainOf(ids))).ownIdStyle.info().sequenceFlow).toEqual({ form: 'idPair', prefix: 'Flow' });
    }
  });

  it('a tie between the scopes of one prefix and form keeps the first one counted, as before (such a file does not change)', async () => {
    const xml = readFileSync(join(HERE, 'fixtures', 'mixed-styles', 'scope-tie.bpmn'), 'utf8');
    expect((await Doc.fromXml(xml)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'scopedTo', prefix: 'Flow', scope: 'Ord' });
    const result = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Pack', after: 'Activity_Check' }], { layout: false });
    expect(result.result.renamed).toEqual({ Flow_Ord_CheckToShip: 'Flow_Ord_CheckToPack' });
    expect(result.result.created.map((created) => created.id)).toEqual(['Activity_Pack', 'Flow_Ord_PackToShip']);
    // a flow under the other scope still names its ends: it follows them into the scope new flows there take (before:
    // Flow_Bil_InvoiceToBook stayed on Invoice -> Weigh)
    const split = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Weigh', flow: 'Flow_Bil_InvoiceToBook' }], { layout: false });
    expect(split.result.renamed).toEqual({ Flow_Bil_InvoiceToBook: 'Flow_Ord_InvoiceToWeigh' });
    expect(split.result.created.map((created) => created.id)).toEqual(['Activity_Weigh', 'Flow_Ord_WeighToBook']);
    const flows = [...xml.matchAll(/ {4}<bpmn:sequenceFlow [^\n]*\n/g)].map((match) => match[0]);
    const billingFirst = xml.replace(flows.join(''), [...flows.slice(2), ...flows.slice(0, 2)].join(''));
    expect((await Doc.fromXml(billingFirst)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'scopedTo', prefix: 'Flow', scope: 'Bil' });
  });

  it('a flow named after its ends under a prefix that lost the vote still follows them (renamed; with ids kept W_FLOW_ID_STALE)', async () => {
    // SequenceFlow_ hashes outvote Flow_ ones: Flow_EToF (bpmn-cli's, from before) still names its ends
    const xml = tasks([['SequenceFlow_0aaaaaa', 'Activity_A', 'Activity_B'], ['SequenceFlow_1bbbbbb', 'Activity_B', 'Activity_C'], ['SequenceFlow_0cccccc', 'Activity_C', 'Activity_D'], ['Flow_1dddddd', 'Activity_D', 'Activity_E'], ['Flow_EToF', 'Activity_E', 'Activity_F']]);
    expect((await Doc.fromXml(xml)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'SequenceFlow' });
    const cs = runOps(await Doc.fromXml(xml), [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_E' }]);
    expect(cs.renames).toEqual([expect.objectContaining({ from: 'Flow_EToF', to: 'SequenceFlow_EToLog' })]);
    const keep = await Doc.fromXml(xml);
    keep.followFlowEnds = false;
    const kept = runOps(keep, [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_E' }]);
    expect(kept.warnings.filter((warning) => warning.code === 'W_FLOW_ID_STALE').map((warning) => warning.element)).toEqual(['Flow_EToF']);
    // and a flow of another form the file's flows show (idPair under SF_, outvoted by named Flow_ flows)
    const forms = tasks([['Flow_AToB', 'Activity_A', 'Activity_B'], ['Flow_BToC', 'Activity_B', 'Activity_C'], ['Flow_CToD', 'Activity_C', 'Activity_D'], ['SF_Activity_D_Activity_E', 'Activity_D', 'Activity_E'], ['SF_Activity_E_Activity_F', 'Activity_E', 'Activity_F']]);
    expect((await Doc.fromXml(forms)).ownIdStyle.info().sequenceFlow).toEqual({ form: 'named', prefix: 'Flow' });
    const moved = runOps(await Doc.fromXml(forms), [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_E' }]);
    expect(moved.renames).toEqual([expect.objectContaining({ from: 'SF_Activity_E_Activity_F', to: 'Flow_EToLog' })]);
  });
});

describe('flow ids kept (keepFlowIds): a stale id is recognised in every flow form', () => {
  /** Flow_<scope>_<A>To<B> flows. */
  const SCOPED = chain(
    [
      ['startEvent', 'startEvent_KotOrder', 'Order placed'],
      ['serviceTask', 'serviceTask_KotO_ValidatePayment', 'Validate payment'],
      ['serviceTask', 'serviceTask_KotO_ReserveInventory', 'Reserve inventory'],
      ['userTask', 'userTask_KotO_ConfirmShipment', 'Confirm shipment'],
      ['endEvent', 'endEvent_KotOrder', 'Order done'],
    ],
    ['Flow_KotO_StartToValidate', 'Flow_KotO_ValidateToReserve', 'Flow_KotO_ReserveToConfirm', 'Flow_KotO_ConfirmToEnd'],
  );
  /** The default named form, a second flow between the same pair with a collision suffix. */
  const SUFFIXED = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"><bpmn:incoming>Flow_StartToOk</bpmn:incoming><bpmn:outgoing>Flow_OkToBook</bpmn:outgoing><bpmn:outgoing>Flow_OkToBook_2</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_Book" name="Book"><bpmn:incoming>Flow_OkToBook</bpmn:incoming><bpmn:incoming>Flow_OkToBook_2</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_StartToOk" sourceRef="Event_Start" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_OkToBook" sourceRef="Gateway_Ok" targetRef="Activity_Book" />
    <bpmn:sequenceFlow id="Flow_OkToBook_2" sourceRef="Gateway_Ok" targetRef="Activity_Book" />`);

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

  it('the suggestion is the id the default rename gives, in the file\'s form (named, stemTo, idPair, scopedTo, a suffixed id)', async () => {
    const cases: Array<[string, EditCommand, string]> = [
      [CAMEL, { op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' }, 'flow_checkStockToApproveOrder -> flow_checkStockToPackGoods'],
      [SNAKE, { op: 'add', kind: 'serviceTask', name: 'Pack goods', after: 'Task_check_risk' }, 'Flow_Task_check_risk_Gateway_risk_ok -> Flow_Task_check_risk_Task_pack_goods'],
      [SCOPED, { op: 'add', kind: 'userTask', id: 'userTask_KotO_ReviewOrder', name: 'Review order', after: 'serviceTask_KotO_ReserveInventory' }, 'Flow_KotO_ReserveToConfirm -> Flow_KotO_ReserveToReview'],
      [SUFFIXED, { op: 'add', kind: 'task', name: 'Review', flow: 'Flow_OkToBook_2' }, 'Flow_OkToBook_2 -> Flow_OkToReview'],
    ];
    for (const [xml, op, line] of cases) {
      const { renamed, stale } = await bothModes(xml, [op]);
      expect(renamed, line).toEqual([line]);
      expect(stale, line).toEqual([line]);
    }
  });

  it('an end `set id=` renamed earlier in the batch still names its flows in every flow form (the id it had: stemTo, idPair, scopedTo)', async () => {
    const cases: Array<[string, EditCommand[], string]> = [
      [CAMEL, [{ op: 'set', id: 'serviceTask_checkStock', values: { id: 'serviceTask_verifyStock' } }, { op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_verifyStock' }], 'flow_checkStockToApproveOrder -> flow_verifyStockToPackGoods'],
      [SNAKE, [{ op: 'set', id: 'Task_check_risk', values: { id: 'Task_assess_risk' } }, { op: 'add', kind: 'serviceTask', name: 'Pack goods', after: 'Task_assess_risk' }], 'Flow_Task_check_risk_Gateway_risk_ok -> Flow_Task_assess_risk_Task_pack_goods'],
      [SCOPED, [{ op: 'set', id: 'userTask_KotO_ConfirmShipment', values: { id: 'userTask_KotO_ApproveShipment' } }, { op: 'add', kind: 'userTask', id: 'userTask_KotO_ReviewOrder', name: 'Review order', before: 'userTask_KotO_ApproveShipment' }], 'Flow_KotO_ReserveToConfirm -> Flow_KotO_ReserveToReview'],
    ];
    for (const [xml, ops, line] of cases) {
      const { renamed, stale } = await bothModes(xml, ops);
      expect(renamed, line).toEqual([line]);
      expect(stale, line).toEqual([line]);
    }
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

  it('flow ids that do not name their ends neither follow nor go stale (hashes, numbers)', async () => {
    for (const [xml, anchor] of [[MODELER, 'Activity_0k3x9qa'], [NUMBERED, 'Task_1'], [OLD_MODELER, 'Task_1bcd234']] as const) {
      expect(await bothModes(xml, [{ op: 'add', kind: 'task', name: 'Pack', after: anchor }])).toEqual({ renamed: [], stale: [] });
    }
  });

  it('two flows that end up between the same ends get the id and the _2 of the default rename, so every hint can be followed', async () => {
    const joined = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"><bpmn:incoming>Flow_StartToOk</bpmn:incoming><bpmn:outgoing>Flow_OkToA</bpmn:outgoing><bpmn:outgoing>Flow_OkToB</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_A" name="A"><bpmn:incoming>Flow_OkToA</bpmn:incoming><bpmn:outgoing>Flow_AToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_B" name="B"><bpmn:incoming>Flow_OkToB</bpmn:incoming><bpmn:outgoing>Flow_BToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_Join" name="Join"><bpmn:incoming>Flow_AToJoin</bpmn:incoming><bpmn:incoming>Flow_BToJoin</bpmn:incoming></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="Flow_StartToOk" sourceRef="Event_Start" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_OkToA" sourceRef="Gateway_Ok" targetRef="Activity_A" />
    <bpmn:sequenceFlow id="Flow_OkToB" sourceRef="Gateway_Ok" targetRef="Activity_B" />
    <bpmn:sequenceFlow id="Flow_AToJoin" sourceRef="Activity_A" targetRef="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_BToJoin" sourceRef="Activity_B" targetRef="Gateway_Join" />`);
    const expected = ['Flow_OkToA -> Flow_OkToJoin', 'Flow_OkToB -> Flow_OkToJoin_2'];
    for (const ops of [[{ op: 'remove', ids: ['Activity_A', 'Activity_B'] }], [{ op: 'remove', ids: ['Activity_A'] }, { op: 'remove', ids: ['Activity_B'] }]] as EditCommand[][]) {
      expect(await bothModes(joined, ops), JSON.stringify(ops)).toEqual({ renamed: expected, stale: expected });
    }
    const doc = await Doc.fromXml(joined);
    doc.followFlowEnds = false;
    runOps(doc, [{ op: 'remove', ids: ['Activity_A', 'Activity_B'] }]);
    runOps(doc, expected.map((line) => ({ op: 'set', id: line.split(' -> ')[0]!, values: { id: line.split(' -> ')[1]! } })));
    expect(flowBetween(doc, 'Gateway_Ok', 'Gateway_Join')).toMatch(/^Flow_OkToJoin(_2)?$/);
  });

  it('the id style is the file\'s as read, also when the first op removes flows it is learned from', async () => {
    const xml = chain(
      [['startEvent', 'Start', 'Start'], ['task', 'Check', 'Check'], ['task', 'Book', 'Book'], ['endEvent', 'Done', 'Done']],
      ['F_StartToCheck', 'F_CheckToBook', 'F_BookToDone'],
    );
    for (const ops of [[{ op: 'remove', ids: ['Start', 'Book'] }], [{ op: 'remove', ids: ['F_StartToCheck'] }, { op: 'remove', ids: ['Book'] }]] as EditCommand[][]) {
      expect(await bothModes(xml, ops), JSON.stringify(ops)).toEqual({ renamed: ['F_CheckToBook -> F_CheckToDone'], stale: ['F_CheckToBook -> F_CheckToDone'] });
    }
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
    const left = await created(base, [{ op: 'add', kind: 'task', name: 'Check address', after: 'Activity_A' }, { op: 'add', kind: 'parallelGateway', after: 'Activity_CheckAddress' }]);
    const right = await created(base, [{ op: 'add', kind: 'task', name: 'Archive', after: 'Activity_B' }, { op: 'add', kind: 'parallelGateway', after: 'Activity_Archive' }]);
    expect(left.ids.filter((id) => right.ids.includes(id))).toEqual([]);
    // the merged file has no duplicate id: every new id of the right branch is free on the left
    for (const id of right.ids) expect(left.doc.ids.has(id)).toBe(false);
    // the flow that CheckAddress -> B got when it was created names its new ends once the gateway is spliced in;
    // the result lists every id as it is at the end of the batch
    expect(left.ids).toEqual(['Activity_CheckAddress', 'Flow_CheckAddressToAfterCheckAddress', 'Gateway_AfterCheckAddress', 'Flow_AfterCheckAddressToB']);
    expect(flowBetween(left.doc, 'Activity_CheckAddress', 'Gateway_AfterCheckAddress')).toBe('Flow_CheckAddressToAfterCheckAddress');
  });

  it('new files name their flows after their ends', async () => {
    const doc = Doc.create({ processName: 'P' });
    const cs = runOps(doc, [
      { op: 'add', kind: 'startEvent', name: 'S' },
      { op: 'add', kind: 'task', name: 'T', after: 'Event_S' },
    ]);
    expect(cs.created.map((created) => created.id)).toEqual(['Event_S', 'Activity_T', 'Flow_SToT']);
  });

  it('files that number their flows get speaking flows with their prefix (Flow_12 -> Flow_BToEnd)', async () => {
    const xml = chain(
      [
        ['startEvent', 'Event_Start', 'Start'],
        ['task', 'Activity_A', 'A'],
        ['endEvent', 'Event_End', 'End'],
      ],
      ['Flow_11', 'Flow_12'],
    );
    const result = await created(xml, [{ op: 'add', kind: 'task', name: 'B', after: 'Activity_A' }]);
    expect(result.ids).toEqual(['Activity_B', 'Flow_BToEnd']);
    // a numbered flow says nothing about its ends: it keeps its id when a splice changes them
    expect(flowBetween(result.doc, 'Activity_A', 'Activity_B')).toBe('Flow_12');
  });
});

describe('German names', () => {
  it('transliterates umlauts as ae / oe / ue / ss in every style', async () => {
    const doc = Doc.create({ processName: 'Prüfung' });
    expect(doc.processes()[0]!.get('id')).toBe('Process_Pruefung');
    const cs = runOps(doc, [{ op: 'add', kind: 'task', name: 'Größe prüfen' }]);
    expect(cs.created[0]!.id).toBe('Activity_GroessePruefen');
    const camel = runOps(await Doc.fromXml(CAMEL), [{ op: 'add', kind: 'userTask', name: 'Änderung übernehmen', in: 'Process_1' }]);
    expect(camel.created[0]!.id).toBe('userTask_aenderungUebernehmen');
    const snake = runOps(await Doc.fromXml(SNAKE), [{ op: 'add', kind: 'userTask', name: 'Straße ändern', in: 'Process_1' }]);
    expect(snake.created[0]!.id).toBe('Task_strasse_aendern');
  });

  it('E_NOT_FOUND suggests the id for another spelling of an umlaut', async () => {
    const doc = Doc.create({ processName: 'P' });
    runOps(doc, [{ op: 'add', kind: 'task', name: 'Prüfung' }]);
    for (const query of ['Activity_Prufung', 'Activity_Prüfung']) {
      let candidates: string[] = [];
      try {
        doc.require(query);
      } catch (err) {
        candidates = (err as { details: { candidates: string[] } }).details.candidates;
      }
      expect(candidates).toContain('Activity_Pruefung');
    }
  });
});

describe('documentation', () => {
  it('bpmn kinds --json describes the id conventions', () => {
    const ids = kindsJson()['ids'] as { bodies: Record<string, string>; flowForms: Record<string, string>; length: string };
    expect(Object.keys(ids.bodies).sort()).toEqual(['camel', 'pascal', 'pascalSnake', 'snake']);
    expect(ids.length).toMatch(/^at most 64 characters, a collision suffix included; a name gives at most 40 characters of words \(a single longer word is cut at 40\), and an id within 64 is not cut again; a longer one loses whole words/);
    expect(Object.keys(ids.flowForms).sort()).toEqual(['idPair', 'idSnake', 'named', 'scopedTo', 'stemSnake', 'stemTo']);
    expect(guideText()).toContain('Ids speak and follow the file');
    expect(JSON.stringify(kindsJson()['ids'])).not.toMatch(/hash of|base-36/);
  });
});

describe('ids through the pipeline', () => {
  it('a write reports the generated ids of the file style', async () => {
    const doc = await Doc.fromXml(CAMEL);
    const result = await mutateDoc(doc, [{ op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' }], { dryRun: true, layout: false });
    expect(result.changes.created.map((created) => created.id)).toEqual(['userTask_packGoods', 'flow_packGoodsToApproveOrder']);
    expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_packGoodsToApproveOrder" sourceRef="userTask_packGoods" targetRef="userTask_approveOrder" />');
  });
});
