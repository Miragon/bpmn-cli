/**
 * Edits follow the file: generated ids take the id style of the file they
 * are written into (src/idstyle.ts), flows get collision-resistant ids, names
 * are transliterated the German way. All fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { hash7 } from '../src/ids.js';
import { IdStyle } from '../src/idstyle.js';
import { runOps } from '../src/ops/index.js';
import type { Op } from '../src/ops/types.js';
import { guideText, kindsJson } from '../src/guide.js';
import { mutateDoc } from '../src/pipeline.js';
import { definitionsXml, flowBetween, HASHED } from './helpers.js';

/** A chain of flow nodes `[tag, id, name?]` connected by flows with the given ids (incoming / outgoing kept). */
function chain(nodes: Array<[string, string, string?]>, flowIds: string[]): string {
  const body = nodes.map(([tag, id, name], i) => {
    const links = [...(i > 0 ? [`<bpmn:incoming>${flowIds[i - 1]}</bpmn:incoming>`] : []), ...(i + 1 < nodes.length ? [`<bpmn:outgoing>${flowIds[i]}</bpmn:outgoing>`] : [])];
    return `<bpmn:${tag} id="${id}"${name ? ` name="${name}"` : ''}>${links.join('')}</bpmn:${tag}>`;
  });
  for (let i = 0; i + 1 < nodes.length; i++) body.push(`<bpmn:sequenceFlow id="${flowIds[i]}" sourceRef="${nodes[i]![1]}" targetRef="${nodes[i + 1]![1]}" />`);
  return definitionsXml(body.join('\n'));
}

async function created(xml: string, ops: Op[]): Promise<{ doc: Doc; ids: string[]; warnings: string[] }> {
  const doc = await Doc.fromXml(xml);
  const cs = runOps(doc, ops);
  return { doc, ids: cs.created.map((c) => c.id), warnings: cs.warnings.map((w) => w.code) };
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
    expect(style).toEqual({ body: 'pascal', unnamed: 'hash', sequenceFlow: { form: 'hash', prefix: 'Flow' }, messageFlow: { form: 'hash', prefix: 'Flow' } });
  });

  it('a Camunda Modeler file gets modeler-like ids: random-looking, but a hash of stable inputs', async () => {
    const ops: Op[] = [{ op: 'add', kind: 'userTask', name: 'Pack order', after: 'Activity_0k3x9qa' }];
    const a = await created(MODELER, ops);
    expect(IdStyle.infer((await Doc.fromXml(MODELER)).definitions).info().body).toBe('hash');
    const [task, flow] = a.ids;
    expect(task).toMatch(HASHED('Activity'));
    expect(flow).toMatch(HASHED('Flow'));
    // `--after` splices: the anchor's flow now ends at the new node, a new flow runs on to the old target
    expect(flow).toBe(`Flow_${hash7(`${task}->Gateway_1d8vq2p`)}`);
    // the same edit on the same file gives the same ids
    expect((await created(MODELER, ops)).ids).toEqual(a.ids);
    // another placement gives other ids
    const b = await created(MODELER, [{ op: 'add', kind: 'userTask', name: 'Pack order', after: 'Activity_1m2n3b4' }]);
    expect(b.ids[0]).not.toBe(task);
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
    // an unnamed gateway: the file's gateway prefix, a hash
    expect(ids[4]).toMatch(HASHED('gateway'));
    // the spliced flow keeps its id (ids of existing elements never change)
    expect(flowBetween(doc, 'serviceTask_checkStock', 'userTask_packGoods')).toBe('flow_checkStockToApproveOrder');
  });

  it('snake_case files with flows named after their ends: Task_pack_goods, Flow_<from>_<to>', async () => {
    const { ids } = await created(SNAKE, [
      { op: 'add', kind: 'serviceTask', name: 'Pack goods', after: 'Task_check_risk' },
      { op: 'add', kind: 'endEvent', name: 'Order rejected', after: 'Gateway_risk_ok' },
    ]);
    expect(ids).toEqual(['Task_pack_goods', 'Flow_Task_pack_goods_Gateway_risk_ok', 'Event_order_rejected', 'Flow_Gateway_risk_ok_Event_order_rejected']);
  });

  it('numbered files continue the numbering of their prefixes', async () => {
    const { ids } = await created(NUMBERED, [
      { op: 'add', kind: 'task', name: 'Third', after: 'Task_2' },
      { op: 'add', kind: 'endEvent', name: 'Abort', in: 'Process_1' },
    ]);
    expect(ids).toEqual(['Task_3', 'SF_4', 'End_2']);
  });

  it('old modeler files: type-named prefixes and SequenceFlow_ hashes', async () => {
    const { ids } = await created(OLD_MODELER, [
      { op: 'add', kind: 'task', name: 'Archive', after: 'Task_0cde345' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', in: 'Process_1' },
    ]);
    expect(ids[0]).toMatch(HASHED('Task'));
    expect(ids[1]).toMatch(HASHED('SequenceFlow'));
    expect(ids[2]).toMatch(HASHED('ExclusiveGateway'));
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
    expect((await created(xml, [{ op: 'add', kind: 'task', name: 'Check', in: 'Process_1' }])).ids).toEqual(['Task_9']);
  });

  it('warns W_ID_SUFFIXED and names the --if-absent id in the file style', async () => {
    const doc = await Doc.fromXml(CAMEL);
    const cs = runOps(doc, [{ op: 'add', kind: 'serviceTask', name: 'Check stock', in: 'Process_1' }]);
    expect(cs.created[0]!.id).toBe('serviceTask_checkStock_2');
    expect(cs.warnings.map((w) => w.message)).toEqual(['Id serviceTask_checkStock is already taken; using serviceTask_checkStock_2']);
    let hint = '';
    try {
      runOps(doc, [{ op: 'add', kind: 'userTask', name: 'Pack goods', in: 'Process_1', ifAbsent: true }]);
    } catch (err) {
      hint = String((err as { details?: { hint?: string } }).details?.hint);
    }
    expect(hint).toContain('--id userTask_packGoods');
  });

  it('a split joins at a gateway named in the file style (camel: <id>Join; hashed files: a hash)', async () => {
    const split: Op = { op: 'split', after: 'userTask_approveOrder', kind: 'parallel', name: 'Fan out', branches: [{ nodes: [{ kind: 'task', name: 'Left' }] }, { nodes: [{ kind: 'task', name: 'Right' }] }] };
    expect((await created(CAMEL, [split])).ids).toContain('gateway_fanOutJoin');
    const modeler = await created(MODELER, [{ ...split, after: 'Activity_0k3x9qa' } as Op]);
    const gateways = modeler.ids.filter((id) => id.startsWith('Gateway_'));
    expect(gateways).toHaveLength(2);
    for (const g of gateways) expect(g).toMatch(HASHED('Gateway'));
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

  it('a file whose ids have no prefix gets bare camelCase ids and the next glued flow number', async () => {
    const { ids } = await created(BARE, [{ op: 'add', kind: 'task', name: 'Review order', after: 'checkOrder' }]);
    expect(ids).toEqual(['reviewOrder', 'flow5']);
    // another kind of the family (no own evidence) follows the family; a second one with the same name gets a suffix
    const more = await created(BARE, [
      { op: 'add', kind: 'userTask', name: 'Review order', after: 'checkOrder' },
      { op: 'add', kind: 'userTask', name: 'Review order', after: 'packGoods' },
    ]);
    expect(more.ids).toEqual(['reviewOrder', 'flow5', 'reviewOrder_2', 'flow6']);
  });

  it('an unnamed element in such a file still gets a prefix (a hash or a number needs one)', async () => {
    const { ids } = await created(BARE, [{ op: 'add', kind: 'exclusiveGateway', after: 'packGoods' }]);
    expect(ids[0]).toMatch(HASHED('Gateway'));
    expect(ids[1]).toBe('flow5');
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
    expect((await created(lower, [{ op: 'add', kind: 'serviceTask', name: 'Check stock', after: 'prepare' }])).ids).toEqual(['checkStock', 'f4']);
    const pascal = chain(
      [
        ['startEvent', 'OrderReceived', 'Order received'],
        ['task', 'CheckOrder', 'Check order'],
        ['task', 'ShipOrder', 'Ship order'],
        ['endEvent', 'OrderShipped', 'Order shipped'],
      ],
      ['Flow_1', 'Flow_2', 'Flow_3'],
    );
    expect((await created(pascal, [{ op: 'add', kind: 'task', name: 'Review order', after: 'CheckOrder' }])).ids).toEqual(['ReviewOrder', 'Flow_4']);
    // a kind of another family without own evidence: the file's flow nodes have no prefixes, so neither does it
    expect((await created(pascal, [{ op: 'add', kind: 'exclusiveGateway', name: 'Order ok?', after: 'CheckOrder' }])).ids).toEqual(['OrderOk', 'Flow_4']);
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
    expect(ids[0]).toBe('reviewOrder');
    expect(ids[1]).toMatch(HASHED('Flow'));
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
    expect(doc.idStyle.info().sequenceFlow).toEqual({ form: 'scopedTo', prefix: 'Flow', scope: 'KotO' });
    const r = await created(scoped, [{ op: 'add', kind: 'userTask', id: 'userTask_KotO_ReviewOrder', name: 'Review order', after: 'serviceTask_KotO_ReserveInventory' }]);
    expect(r.ids).toEqual(['userTask_KotO_ReviewOrder', 'Flow_KotO_ReviewToConfirm']);
    // an end event as the target, a start event as the source; a second flow of the same words gets a number
    const ends = await created(scoped, [
      { op: 'add', kind: 'endEvent', id: 'endEvent_KotO_Failed', name: 'Failed', in: 'Process_1' },
      { op: 'connect', source: 'serviceTask_KotO_ValidatePayment', target: 'endEvent_KotO_Failed' },
      { op: 'connect', source: 'startEvent_KotOrder', target: 'userTask_KotO_ConfirmShipment' },
      { op: 'connect', source: 'startEvent_KotOrder', target: 'userTask_KotO_ConfirmShipment' },
    ]);
    expect(ends.ids).toEqual(['endEvent_KotO_Failed', 'Flow_KotO_ValidateToEnd', 'Flow_KotO_StartToConfirm', 'Flow_KotO_StartToConfirm2']);
  });

  it('the scoped form is not read into other forms', async () => {
    for (const xml of [CAMEL, SNAKE, MODELER]) expect((await Doc.fromXml(xml)).idStyle.info().sequenceFlow.form).not.toBe('scopedTo');
  });
});

describe('collision-resistant flow ids (independent edits on two branches)', () => {
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
  });

  it('new files hash their flows (Flow_<7 chars>) instead of numbering them', async () => {
    const doc = Doc.create({ processName: 'P' });
    const cs = runOps(doc, [
      { op: 'add', kind: 'startEvent', name: 'S' },
      { op: 'add', kind: 'task', name: 'T', after: 'Event_S' },
    ]);
    expect(cs.created.map((c) => c.id)).toEqual(['Event_S', 'Activity_T', `Flow_${hash7('Event_S->Activity_T')}`]);
  });

  it('files numbering their flows keep numbering (Flow_12 style)', async () => {
    const xml = chain(
      [
        ['startEvent', 'Event_Start', 'Start'],
        ['task', 'Activity_A', 'A'],
        ['endEvent', 'Event_End', 'End'],
      ],
      ['Flow_11', 'Flow_12'],
    );
    expect((await created(xml, [{ op: 'add', kind: 'task', name: 'B', after: 'Activity_A' }])).ids).toEqual(['Activity_B', 'Flow_13']);
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
    const ids = kindsJson()['ids'] as { bodies: Record<string, string>; flowForms: Record<string, string> };
    expect(Object.keys(ids.bodies).sort()).toEqual(['camel', 'hash', 'numbered', 'pascal', 'pascalSnake', 'snake']);
    expect(Object.keys(ids.flowForms).sort()).toEqual(['hash', 'idPair', 'idSnake', 'numbered', 'scopedTo', 'stemSnake', 'stemTo']);
    expect(guideText()).toContain('Ids follow the file');
  });
});

describe('ids through the pipeline', () => {
  it('a write reports the generated ids of the file style', async () => {
    const doc = await Doc.fromXml(CAMEL);
    const r = await mutateDoc(doc, [{ op: 'add', kind: 'userTask', name: 'Pack goods', after: 'serviceTask_checkStock' }], { dryRun: true, layout: false });
    expect(r.changes.created.map((c) => c.id)).toEqual(['userTask_packGoods', 'flow_packGoodsToApproveOrder']);
    expect(r.xml).toContain('<bpmn:sequenceFlow id="flow_packGoodsToApproveOrder" sourceRef="userTask_packGoods" targetRef="userTask_approveOrder" />');
  });
});
