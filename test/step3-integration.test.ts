/**
 * Step 3 round 1: the four packages together (views, speaking ids and batch
 * aliases, layout ergonomics, the Camunda 8 profile). Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml, showXml } from '../src/api.js';
import { CliError } from '../src/errors.js';
import { mutationSummary, renderSummary } from '../src/report.js';

/** The bounds of an element's shape. */
function bounds(xml: string, id: string): { x: number; y: number; width: number; height: number } {
  const m = new RegExp(`bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"`).exec(xml);
  if (!m) throw new Error(`no shape for ${id}`);
  return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
}

function overlap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function rejection(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

/** One batch that names everything it creates by alias and formats the drawing through aliases. */
const ORDER_BATCH: unknown[] = [
  { op: 'add', kind: 'participant', name: 'Order handling', as: '$org' },
  { op: 'add', kind: 'participant', name: 'Customer', blackBox: true, as: '$customer' },
  { op: 'add', kind: 'start', name: 'Order received', in: '$org', as: '$start' },
  { op: 'add', kind: 'userTask', name: 'Check order', after: '$start', as: '$check' },
  {
    op: 'split',
    after: '$check',
    name: 'Order ok?',
    as: '$ok',
    joinAs: '$join',
    branches: [
      { flowName: 'yes', condition: '${ok}', nodes: [{ kind: 'serviceTask', name: 'Ship order', as: '$ship' }] },
      { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Clarify order', as: '$clarify', flowAs: '$no' }, { kind: 'task', name: 'Wait', as: '$wait' }] },
    ],
  },
  { op: 'add', kind: 'end', name: 'Order handled', after: '$join', as: '$end' },
  { op: 'connect', source: '$ship', target: '$customer', as: '$msg' },
  // selectors and frames by alias: the happy path through the "no" branch, the pool order, compact of one pool
  { op: 'color', path: ['$start', '$end'], via: ['$no'], color: 'green' },
  { op: 'order', id: 'Collaboration_OrderHandling', pools: ['$customer', '$org'] },
  { op: 'compact', ids: ['$org'] },
];

async function orderModel(): Promise<string> {
  const base = await newXml({ processName: 'Order handling' });
  return (await applyToXml(base.xml, ORDER_BATCH)).xml;
}

describe('apply batches: aliases, speaking ids and the format selectors together', () => {
  it('every alias names a speaking id; selectors, pool order and compact take aliases', async () => {
    const base = await newXml({ processName: 'Order handling' });
    const r = await applyToXml(base.xml, ORDER_BATCH);
    expect(r.result.aliases).toEqual({
      $org: 'Participant_OrderHandling',
      $customer: 'Participant_Customer',
      $start: 'Event_OrderReceived',
      $check: 'Activity_CheckOrder',
      $ok: 'Gateway_OrderOk',
      $ship: 'Activity_ShipOrder',
      $no: 'Flow_OrderOkToClarifyOrder',
      $clarify: 'Activity_ClarifyOrder',
      $wait: 'Activity_Wait',
      $join: 'Gateway_OrderOk_join',
      $end: 'Event_OrderHandled',
      $msg: 'Flow_ShipOrderToCustomer',
    });
    const color = r.result.layout.format?.find((f) => f.op === 'color');
    // the path through the "no" branch, flows included; the "yes" branch is not on it
    expect(color?.colored).toEqual(expect.arrayContaining(['Event_OrderReceived', 'Flow_OrderOkToClarifyOrder', 'Activity_ClarifyOrder', 'Activity_Wait', 'Event_OrderHandled']));
    expect(color?.colored).not.toContain('Activity_ShipOrder');
    expect(r.result.changed.map((c) => c.id)).toContain('Collaboration_OrderHandling');
    const layout = await showXml(r.xml, { layout: true });
    expect(layout.indexOf('participant Participant_Customer')).toBeLessThan(layout.indexOf('participant Participant_OrderHandling'));
    expect(r.result.layout.format?.map((f) => f.op)).toEqual(['color', 'order', 'compact']);
  });

  it('an unknown alias in a selector is refused before anything runs', async () => {
    const base = await newXml({ processName: 'Order handling' });
    const err = await rejection(applyToXml(base.xml, [...ORDER_BATCH.slice(0, 3), { op: 'color', path: ['$start', '$ende'], color: 'red' }]));
    expect(err.code).toBe('E_UNKNOWN_ALIAS');
    expect(err.message).toContain('"path[1]": alias $ende is not defined');
    const branch = await rejection(applyToXml(base.xml, [{ op: 'place', branch: '$no', below: 'Activity_X' }]));
    expect(branch.code).toBe('E_UNKNOWN_ALIAS');
  });

  it('a flow renamed after its new ends is followed by its alias into a format op', async () => {
    const xml = await orderModel();
    // the splice renames Flow_OrderOkToClarifyOrder (its id named its old ends); flowAs is that flow
    const r = await applyToXml(xml, [
      { op: 'add', kind: 'task', name: 'Log reason', flow: 'Flow_OrderOkToClarifyOrder', as: '$log', flowAs: '$in' },
      { op: 'color', ids: ['$in', '$log'], color: 'red' },
    ]);
    expect(r.result.aliases).toEqual({ $log: 'Activity_LogReason', $in: 'Flow_OrderOkToLogReason' });
    expect(r.result.layout.format?.[0]?.colored).toEqual(['Flow_OrderOkToLogReason', 'Activity_LogReason']);
    // the old id names the new one
    const err = await rejection(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Log reason', flow: 'Flow_OrderOkToClarifyOrder' }, { op: 'color', ids: ['Flow_OrderOkToClarifyOrder'], color: 'red' }]));
    expect(err.code).toBe('E_NOT_FOUND');
    expect(err.details.candidates?.[0]).toBe('Flow_OrderOkToLogReason');
    expect(err.message).toBe('No element with id "Flow_OrderOkToClarifyOrder": an op before this one renamed it to Flow_OrderOkToLogReason (its id named its old ends)');
    expect(err.details.op).toBe(1);
  });
});

describe('--summary: aliases and format ops', () => {
  it('lists the aliases and one line per format op (text and JSON)', async () => {
    const xml = await orderModel();
    const r = await applyToXml(xml, [
      { op: 'add', kind: 'task', name: 'Archive', after: 'Event_OrderReceived', as: '$archive' },
      { op: 'place', ids: ['Activity_Wait'], below: 'Activity_ShipOrder' },
      { op: 'color', ids: ['$archive'], color: 'blue' },
    ]);
    const summary = mutationSummary(r.result);
    expect(summary.aliases).toEqual({ $archive: 'Activity_Archive' });
    expect(summary.format?.map((f) => f.op)).toEqual(['place', 'color']);
    const text = renderSummary(summary);
    expect(text).toMatch(/^aliases: \$archive = Activity_Archive$/m);
    expect(text).toMatch(/^format color #2: colored Activity_Archive$/m);
    expect(text).toMatch(/^format place #1: /m);
  });

  it('names the old id of a flow the change renamed after its new ends (text and JSON)', async () => {
    const xml = await orderModel();
    const r = await applyToXml(xml, [
      { op: 'add', kind: 'task', name: 'Log reason', flow: 'Flow_OrderOkToClarifyOrder' },
      { op: 'add', kind: 'task', name: 'Notify', after: 'Activity_LogReason' },
    ]);
    // Flow_OrderOkToClarifyOrder -> Flow_OrderOkToLogReason (splice); Flow_LogReasonToClarifyOrder (new) -> Flow_LogReasonToNotify (second splice)
    expect(r.result.renamed).toEqual({ Flow_OrderOkToClarifyOrder: 'Flow_OrderOkToLogReason' });
    const summary = mutationSummary(r.result);
    expect(summary.renamed).toEqual({ Flow_OrderOkToClarifyOrder: 'Flow_OrderOkToLogReason' });
    expect(renderSummary(summary)).toMatch(/^renamed: Flow_OrderOkToClarifyOrder -> Flow_OrderOkToLogReason$/m);
    const chain = await applyToXml(xml, [
      { op: 'add', kind: 'task', name: 'Log reason', flow: 'Flow_OrderOkToClarifyOrder' },
      { op: 'add', kind: 'task', name: 'Prepare', before: 'Activity_LogReason' },
    ]);
    expect(chain.result.renamed).toEqual({ Flow_OrderOkToClarifyOrder: 'Flow_OrderOkToPrepare' });
  });

  it('a format-only change is not "no changes": the line says what moved, or why nothing did', async () => {
    const xml = await orderModel();
    const r = await applyToXml(xml, [{ op: 'compact' }]);
    const text = renderSummary(mutationSummary(r.result));
    expect(text).not.toMatch(/^no changes$/m);
    expect(text).toMatch(/^format compact #0: /m);
  });
});

/** A Camunda 8 file as Camunda Modeler writes it: hashed ids. */
const C8_MODELER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_0x1y2z3" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0">
  <bpmn:process id="Process_0a1b2c3" name="Stock" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Ordered">
      <bpmn:outgoing>Flow_0k3x9qa</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="Event_1q2w3e4" name="Stock ready">
      <bpmn:incoming>Flow_0k3x9qa</bpmn:incoming>
      <bpmn:outgoing>Flow_1m2n3b4</bpmn:outgoing>
      <bpmn:timerEventDefinition id="TimerEventDefinition_0z9y8x7">
        <bpmn:timeDuration>P1D</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="Event_0p9o8i7" name="Shipped">
      <bpmn:incoming>Flow_1m2n3b4</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_0k3x9qa" sourceRef="StartEvent_1" targetRef="Event_1q2w3e4" />
    <bpmn:sequenceFlow id="Flow_1m2n3b4" sourceRef="Event_1q2w3e4" targetRef="Event_0p9o8i7" />
    <bpmn:task id="ConditionalEventDefinition_StockReadyAgain" name="Taken" />
  </bpmn:process>
</bpmn:definitions>
`;

describe('Camunda 8 with speaking ids and the reading views', () => {
  it('a new event definition gets a speaking id in the file\'s style, never the hash of its event', async () => {
    const r = await applyToXml(C8_MODELER, [{ op: 'retype', id: 'Event_1q2w3e4', kind: 'intermediateCatchEvent:conditional', when: '= stock > 0' }], { layout: false });
    expect(r.xml).toContain('<bpmn:conditionalEventDefinition id="ConditionalEventDefinition_StockReady">');
    expect(r.xml).not.toContain('ConditionalEventDefinition_1q2w3e4');
  });

  it('a taken definition id gets _2 and W_ID_SUFFIXED like every generated id', async () => {
    const r = await applyToXml(
      C8_MODELER,
      [
        { op: 'add', kind: 'intermediateCatchEvent:conditional', name: 'Stock ready again', after: 'Event_1q2w3e4', when: '= stock > 10', id: 'Event_StockReadyAgain' },
      ],
      { layout: false },
    );
    expect(r.xml).toContain('<bpmn:conditionalEventDefinition id="ConditionalEventDefinition_StockReadyAgain_2">');
    const w = r.result.warnings.added.find((x) => x.code === 'W_ID_SUFFIXED');
    expect(w?.element).toBe('ConditionalEventDefinition_StockReadyAgain_2');
  });

  it('show --around and show <id> --context print each zeebe setting once', async () => {
    const base = await newXml({ processName: 'Order', target: 'camunda8' });
    const r = await applyToXml(base.xml, [
      { op: 'add', kind: 'start', name: 'Received', as: '$start' },
      { op: 'add', kind: 'serviceTask', name: 'Charge', after: '$start', as: '$charge' },
      { op: 'add', kind: 'userTask', name: 'Review', after: '$charge', as: '$review' },
      { op: 'add', kind: 'end', name: 'Done', after: '$review' },
      { op: 'ext', id: '$charge', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'charge-card', retries: '3' } },
      { op: 'ext', id: '$review', action: 'add', type: 'zeebe:assignmentDefinition', attrs: { candidateGroups: 'sales' } },
    ]);
    const around = await showXml(r.xml, { around: 'Activity_Charge' });
    expect(around).toContain('serviceTask Activity_Charge "Charge" [zeebe:taskDefinition type=charge-card retries=3]');
    expect(around).toContain('userTask Activity_Review "Review" [zeebe:userTask, zeebe:assignmentDefinition candidateGroups=sales]');
    expect(around).not.toContain('job=');
    const context = await showXml(r.xml, { id: 'Activity_Review', context: true });
    expect(context).toMatch(/^userTask Activity_Review "Review"$/m);
    expect(context).toContain('implementation: zeebe:userTask, zeebe:assignmentDefinition candidateGroups=sales');
    // the full show keeps the short facts (it has no extension summary)
    expect(await showXml(r.xml)).toContain('[job=charge-card, ext: zeebe:taskDefinition]');
  });

  it('a missing start the edit fixes is resolved once, as the platform finding', async () => {
    const base = await newXml({ processName: 'Order', target: 'camunda8' });
    const r = await applyToXml(base.xml, [{ op: 'add', kind: 'start', name: 'Received' }]);
    expect(r.result.warnings.resolved.map((w) => w.code)).toEqual(['W_C8_DEPLOY_START_EVENT']);
  });

  it('the Camunda 8 profile reports as a delta: added by the edit, resolved by the fix', async () => {
    const base = await newXml({ processName: 'Order', target: 'camunda8' });
    const one = await applyToXml(base.xml, [
      { op: 'add', kind: 'start', name: 'Received', as: '$start' },
      { op: 'add', kind: 'serviceTask', name: 'Charge', after: '$start' },
      { op: 'add', kind: 'end', name: 'Done', after: 'Activity_Charge' },
    ]);
    expect(one.result.warnings.added.map((w) => w.code)).toContain('W_C8_DEPLOY_IMPLEMENTATION');
    const two = await applyToXml(one.xml, [{ op: 'ext', id: 'Activity_Charge', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'charge-card' } }]);
    expect(two.result.warnings.added).toEqual([]);
    expect(two.result.warnings.resolved.map((w) => w.code)).toContain('W_C8_DEPLOY_IMPLEMENTATION');
    expect(renderSummary(mutationSummary(two.result))).toMatch(/^warnings: 0 added, 1 resolved, 0 already in the file$/m);
  });
});

/**
 * The gate's fuzz campaign on the integrated build (walk controlflow__s04,
 * seed 1491033354, step 10): removing a node closed the strip on its row and
 * pulled an expanded sub-process back over a gateway of the row below (the
 * sub-process reaches into that row). Every package build did the same; the
 * walk only showed up with the integrated ids. Rebuilt with a handful of shapes.
 */
const ROW_CLOSE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_RowClose" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_RowClose" isExecutable="false">
    <bpmn:startEvent id="Event_Start" name="Start" />
    <bpmn:task id="Activity_Label" name="Label" />
    <bpmn:task id="Activity_Ship" name="Ship" />
    <bpmn:subProcess id="Activity_Sub" name="Sub">
      <bpmn:startEvent id="Event_SubStart" />
      <bpmn:endEvent id="Event_SubEnd" />
      <bpmn:sequenceFlow id="Flow_SubStartToSubEnd" sourceRef="Event_SubStart" targetRef="Event_SubEnd" />
    </bpmn:subProcess>
    <bpmn:endEvent id="Event_End" name="End" />
    <bpmn:startEvent id="Event_Start2" name="Start 2" />
    <bpmn:task id="Activity_Check" name="Check" />
    <bpmn:exclusiveGateway id="Gateway_Par" />
    <bpmn:endEvent id="Event_End2" name="End 2" />
    <bpmn:sequenceFlow id="Flow_StartToLabel" sourceRef="Event_Start" targetRef="Activity_Label" />
    <bpmn:sequenceFlow id="Flow_LabelToShip" sourceRef="Activity_Label" targetRef="Activity_Ship" />
    <bpmn:sequenceFlow id="Flow_ShipToSub" sourceRef="Activity_Ship" targetRef="Activity_Sub" />
    <bpmn:sequenceFlow id="Flow_SubToEnd" sourceRef="Activity_Sub" targetRef="Event_End" />
    <bpmn:sequenceFlow id="Flow_Start2ToCheck" sourceRef="Event_Start2" targetRef="Activity_Check" />
    <bpmn:sequenceFlow id="Flow_CheckToPar" sourceRef="Activity_Check" targetRef="Gateway_Par" />
    <bpmn:sequenceFlow id="Flow_ParToEnd2" sourceRef="Gateway_Par" targetRef="Event_End2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_RowClose">
    <bpmndi:BPMNPlane id="BPMNPlane_RowClose" bpmnElement="Process_RowClose">
      <bpmndi:BPMNShape id="Event_Start_di" bpmnElement="Event_Start"><dc:Bounds x="100" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Label_di" bpmnElement="Activity_Label"><dc:Bounds x="200" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Ship_di" bpmnElement="Activity_Ship"><dc:Bounds x="360" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Sub_di" bpmnElement="Activity_Sub" isExpanded="true"><dc:Bounds x="520" y="43" width="300" height="155" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_SubStart_di" bpmnElement="Event_SubStart"><dc:Bounds x="560" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_SubEnd_di" bpmnElement="Event_SubEnd"><dc:Bounds x="740" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_End_di" bpmnElement="Event_End"><dc:Bounds x="880" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Start2_di" bpmnElement="Event_Start2"><dc:Bounds x="100" y="322" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Check_di" bpmnElement="Activity_Check"><dc:Bounds x="250" y="300" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Par_di" bpmnElement="Gateway_Par" isMarkerVisible="true"><dc:Bounds x="385" y="180" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_End2_di" bpmnElement="Event_End2"><dc:Bounds x="520" y="322" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_StartToLabel_di" bpmnElement="Flow_StartToLabel"><di:waypoint x="136" y="120" /><di:waypoint x="200" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_LabelToShip_di" bpmnElement="Flow_LabelToShip"><di:waypoint x="300" y="120" /><di:waypoint x="360" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ShipToSub_di" bpmnElement="Flow_ShipToSub"><di:waypoint x="460" y="120" /><di:waypoint x="520" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_SubToEnd_di" bpmnElement="Flow_SubToEnd"><di:waypoint x="820" y="120" /><di:waypoint x="880" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_SubStartToSubEnd_di" bpmnElement="Flow_SubStartToSubEnd"><di:waypoint x="596" y="120" /><di:waypoint x="740" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Start2ToCheck_di" bpmnElement="Flow_Start2ToCheck"><di:waypoint x="136" y="340" /><di:waypoint x="250" y="340" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_CheckToPar_di" bpmnElement="Flow_CheckToPar"><di:waypoint x="350" y="340" /><di:waypoint x="410" y="340" /><di:waypoint x="410" y="230" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ParToEnd2_di" bpmnElement="Flow_ParToEnd2"><di:waypoint x="435" y="205" /><di:waypoint x="538" y="205" /><di:waypoint x="538" y="322" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

describe('closing the strip of a removed node', () => {
  it('does not pull an expanded sub-process over a shape of another row', async () => {
    const r = await applyToXml(ROW_CLOSE, [{ op: 'remove', ids: ['Activity_Label'] }], { layout: 'incremental' });
    expect(overlap(bounds(r.xml, 'Activity_Sub'), bounds(r.xml, 'Gateway_Par'))).toBe(false);
    expect(bounds(r.xml, 'Gateway_Par')).toEqual(bounds(ROW_CLOSE, 'Gateway_Par'));
  });
});
