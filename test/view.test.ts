import { describe, expect, it } from 'vitest';
import { ChangeSet } from '../src/result.js';
import { renderChanges, renderDetail, renderProblems, renderView } from '../src/format.js';
import { buildView, elementDetail, findElements, labelOf, type ViewNode } from '../src/view.js';
import { BPMN_NS, definitionsXml, docFromXml, linearDoc } from './helpers.js';

/* ------------------------------------------------------------------ */
/* tiny XML builder: nodes + flows with incoming/outgoing maintained   */
/* ------------------------------------------------------------------ */

interface N {
  tag: string;
  id: string;
  attrs?: string;
  inner?: string;
}
interface F {
  id: string;
  from: string;
  to: string;
  attrs?: string;
  inner?: string;
}

function body(nodes: N[], flows: F[] = [], extra = ''): string {
  const inc = new Map<string, string[]>();
  const out = new Map<string, string[]>();
  for (const f of flows) {
    out.set(f.from, [...(out.get(f.from) ?? []), f.id]);
    inc.set(f.to, [...(inc.get(f.to) ?? []), f.id]);
  }
  const nodeXml = nodes.map((n) => {
    const links = [
      ...(inc.get(n.id) ?? []).map((i) => `<bpmn:incoming>${i}</bpmn:incoming>`),
      ...(out.get(n.id) ?? []).map((o) => `<bpmn:outgoing>${o}</bpmn:outgoing>`),
    ].join('');
    return `<bpmn:${n.tag} id="${n.id}" ${n.attrs ?? ''}>${links}${n.inner ?? ''}</bpmn:${n.tag}>`;
  });
  const flowXml = flows.map((f) => `<bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}" ${f.attrs ?? ''}>${f.inner ?? ''}</bpmn:sequenceFlow>`);
  return [...nodeXml, ...flowXml, extra].join('\n');
}

const DI_NS = 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"';

function diagram(root: string, shapes: Array<{ id: string; expanded?: boolean }>): string {
  const shapeXml = shapes
    .map((s) => `<bpmndi:BPMNShape id="Shape_${s.id}" bpmnElement="${s.id}"${s.expanded ? ' isExpanded="true"' : ''}><dc:Bounds x="0" y="0" width="100" height="80" /></bpmndi:BPMNShape>`)
    .join('');
  return `<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${root}">${shapeXml}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;
}

const timer = (value: string) => `<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">${value}</bpmn:timeDuration></bpmn:timerEventDefinition>`;
const condition = (expr: string) => `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${expr}</bpmn:conditionExpression>`;

function ids(nodes: ViewNode[]): string[] {
  return nodes.map((n) => n.id);
}

/* ------------------------------------------------------------------ */
/* buildView + renderView                                               */
/* ------------------------------------------------------------------ */

describe('buildView / renderView', () => {
  it('renders a linear process in flow order with flows inline', async () => {
    const doc = await linearDoc();
    const view = buildView(doc);
    expect(view.processes).toHaveLength(1);
    const p = view.processes[0]!;
    expect(p.id).toBe('Process_1');
    expect(p.executable).toBe(true);
    expect(ids(p.nodes)).toEqual(['Start', 'Task_A', 'End']);
    expect(p.nodes.map((n) => n.kind)).toEqual(['startEvent', 'userTask', 'endEvent']);
    expect(p.nodes[0]!.outgoing).toEqual([{ id: 'F1', target: 'Task_A' }]);
    expect(p.nodes[1]!.incoming).toEqual(['F1']);
    expect(view.problems).toEqual([]);
    expect(renderView(view)).toBe(
      ['process Process_1 executable', '  startEvent Start "Started" -> Task_A (F1)', '  userTask Task_A "Do A" -> End (F2)', '  endEvent End "Done"', 'problems: none'].join('\n'),
    );
  });

  it('is deterministic, contains no coordinates and no undefined keys', async () => {
    const doc = await linearDoc();
    const a = renderView(buildView(doc));
    const b = renderView(buildView(doc));
    expect(a).toBe(b);
    expect(a).not.toMatch(/\b[xy]=\d/);
    expect(JSON.stringify(buildView(doc))).not.toContain('undefined');
  });

  it('does not mutate the model (identical XML before and after)', async () => {
    const doc = await linearDoc();
    const before = await doc.toXml();
    buildView(doc);
    elementDetail(doc, doc.require('Task_A'));
    findElements(doc, 'a');
    const after = await doc.toXml();
    expect(after).toBe(before);
    expect(after).not.toContain('bpmndi:'); // the view never adds DI
  });

  it('follows gateway branches depth-first and shows names, conditions and default', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'exclusiveGateway', id: 'Gw', attrs: 'name="Ok?" default="Flow_no"' },
            { tag: 'task', id: 'Yes', attrs: 'name="Yes path"' },
            { tag: 'task', id: 'No', attrs: 'name="No path"' },
            { tag: 'exclusiveGateway', id: 'Join' },
            { tag: 'endEvent', id: 'End' },
          ],
          [
            { id: 'F0', from: 'Start', to: 'Gw' },
            { id: 'Flow_yes', from: 'Gw', to: 'Yes', attrs: 'name="yes"', inner: condition('${ok}') },
            { id: 'Flow_no', from: 'Gw', to: 'No', attrs: 'name="no"' },
            { id: 'F3', from: 'Yes', to: 'Join' },
            { id: 'F4', from: 'No', to: 'Join' },
            { id: 'F5', from: 'Join', to: 'End' },
          ],
        ),
      ),
    );
    const view = buildView(doc);
    // depth-first: the yes branch runs through to the end before the no branch is listed
    expect(ids(view.processes[0]!.nodes)).toEqual(['Start', 'Gw', 'Yes', 'Join', 'End', 'No']);
    const gw = view.processes[0]!.nodes[1]!;
    expect(gw.outgoing).toEqual([
      { id: 'Flow_yes', target: 'Yes', name: 'yes', condition: '${ok}' },
      { id: 'Flow_no', target: 'No', name: 'no', default: true },
    ]);
    const text = renderView(view);
    expect(text).toContain('  exclusiveGateway Gw "Ok?" -> Yes (Flow_yes "yes" if ${ok}), No (Flow_no "no" default)');
    expect(view.problems).toEqual([]);
  });

  it('lists unreachable nodes last and flags them', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'task', id: 'Old', attrs: 'name="Old step"' },
            { tag: 'startEvent', id: 'Start' },
            { tag: 'task', id: 'A' },
            { tag: 'endEvent', id: 'End' },
            { tag: 'task', id: 'Loop1' },
            { tag: 'task', id: 'Loop2' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'A' },
            { id: 'F2', from: 'A', to: 'End' },
            { id: 'L1', from: 'Loop1', to: 'Loop2' },
            { id: 'L2', from: 'Loop2', to: 'Loop1' },
          ],
        ),
      ),
    );
    const view = buildView(doc);
    const nodes = view.processes[0]!.nodes;
    expect(ids(nodes)).toEqual(['Start', 'A', 'End', 'Old', 'Loop1', 'Loop2']);
    expect(nodes.map((n) => !!n.unreachable)).toEqual([false, false, false, true, true, true]);
    const text = renderView(view);
    expect(text).toContain('  ! unreachable: task Old "Old step"');
    expect(text).toContain('  ! unreachable: task Loop1 -> Loop2 (L1)');
    expect(view.problems.filter((p) => p.code === 'W_UNREACHABLE').map((p) => p.element)).toEqual(['Old', 'Loop1', 'Loop2']);
  });

  it('nests boundary events under their host and follows their flows', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'userTask', id: 'A', attrs: 'name="Check"' },
            { tag: 'boundaryEvent', id: 'Timeout', attrs: 'name="2 days" attachedToRef="A" cancelActivity="false"', inner: timer('PT2D') },
            { tag: 'boundaryEvent', id: 'Err', attrs: 'attachedToRef="A"', inner: '<bpmn:errorEventDefinition errorRef="Error_1" />' },
            { tag: 'task', id: 'Remind' },
            { tag: 'endEvent', id: 'End' },
            { tag: 'endEvent', id: 'Failed' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'A' },
            { id: 'F2', from: 'A', to: 'End' },
            { id: 'F3', from: 'Timeout', to: 'Remind' },
            { id: 'F4', from: 'Remind', to: 'End' },
            { id: 'F5', from: 'Err', to: 'Failed' },
          ],
        ),
        { extraRoots: '<bpmn:error id="Error_1" name="PaymentFailed" errorCode="PAY-001" />' },
      ),
    );
    const view = buildView(doc);
    const nodes = view.processes[0]!.nodes;
    expect(ids(nodes)).toEqual(['Start', 'A', 'End', 'Remind', 'Failed']);
    const host = nodes[1]!;
    expect(host.boundary!.map((b) => [b.id, b.kind, b.trigger, b.nonInterrupting])).toEqual([
      ['Timeout', 'boundaryEvent:timer', 'PT2D', true],
      ['Err', 'boundaryEvent:error', 'error PaymentFailed (PAY-001)', undefined],
    ]);
    expect(nodes.some((n) => n.unreachable)).toBe(false);
    const text = renderView(view);
    expect(text).toContain('  userTask A "Check" -> End (F2)\n    boundaryEvent:timer Timeout "2 days" [PT2D, non-interrupting] -> Remind (F3)\n    boundaryEvent:error Err [error PaymentFailed (PAY-001)] -> Failed (F5)');
    expect(text).toContain('root: error Error_1 "PaymentFailed" (PAY-001)');
    expect(view.rootElements).toEqual([{ id: 'Error_1', kind: 'error', name: 'PaymentFailed', code: 'PAY-001' }]);
  });

  it('nests sub-process children and reads the expanded flag from DI', async () => {
    const inner = body(
      [
        { tag: 'startEvent', id: 'S2' },
        { tag: 'subProcess', id: 'Inner', attrs: 'name="Inner"', inner: body([{ tag: 'startEvent', id: 'S3' }, { tag: 'endEvent', id: 'E3' }], [{ id: 'I1', from: 'S3', to: 'E3' }]) },
        { tag: 'subProcess', id: 'Inner2', inner: body([{ tag: 'startEvent', id: 'S4' }, { tag: 'endEvent', id: 'E4' }], [{ id: 'I2', from: 'S4', to: 'E4' }]) },
        { tag: 'endEvent', id: 'E2' },
      ],
      [
        { id: 'F21', from: 'S2', to: 'Inner' },
        { id: 'F22', from: 'Inner', to: 'Inner2' },
        { id: 'F23', from: 'Inner2', to: 'E2' },
      ],
    );
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'subProcess', id: 'Outer', attrs: 'name="Outer"', inner },
            { tag: 'endEvent', id: 'End' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'Outer' },
            { id: 'F2', from: 'Outer', to: 'End' },
          ],
        ),
        { nsDecl: DI_NS, extraRoots: diagram('Process_1', [{ id: 'Outer', expanded: true }, { id: 'Inner' }]) },
      ),
    );
    const view = buildView(doc);
    const outer = view.processes[0]!.nodes[1]!;
    expect(outer.kind).toBe('subProcess');
    expect(outer.expanded).toBe(true);
    expect(ids(outer.children!)).toEqual(['S2', 'Inner', 'Inner2', 'E2']);
    const [, innerNode, inner2] = outer.children!;
    expect(innerNode!.expanded).toBe(false); // DI shape without isExpanded
    expect(inner2!.expanded).toBe(true); // no DI shape: expanded by convention
    expect(ids(innerNode!.children!)).toEqual(['S3', 'E3']);
    const text = renderView(view);
    expect(text).toContain(
      [
        '  subProcess Outer "Outer" [expanded] -> End (F2)',
        '    startEvent S2 -> Inner (F21)',
        '    subProcess Inner "Inner" [collapsed] -> Inner2 (F22)',
        '      startEvent S3 -> E3 (I1)',
        '      endEvent E3',
        '    subProcess Inner2 [expanded] -> E2 (F23)',
      ].join('\n'),
    );
    expect(view.problems).toEqual([]);
  });

  it('shows event sub-processes without flagging them', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'endEvent', id: 'End' },
            {
              tag: 'subProcess',
              id: 'OnMsg',
              attrs: 'name="On message" triggeredByEvent="true"',
              inner: body(
                [
                  { tag: 'startEvent', id: 'MsgStart', attrs: 'isInterrupting="false"', inner: '<bpmn:messageEventDefinition messageRef="Message_1" />' },
                  { tag: 'endEvent', id: 'MsgEnd' },
                ],
                [{ id: 'M1', from: 'MsgStart', to: 'MsgEnd' }],
              ),
            },
          ],
          [{ id: 'F1', from: 'Start', to: 'End' }],
        ),
        { extraRoots: '<bpmn:message id="Message_1" name="Cancel" />' },
      ),
    );
    const view = buildView(doc);
    const sub = view.processes[0]!.nodes[2]!;
    expect(sub.kind).toBe('eventSubProcess');
    expect(sub.unreachable).toBeUndefined();
    expect(sub.children![0]).toMatchObject({ id: 'MsgStart', kind: 'startEvent:message', trigger: 'message Cancel', nonInterrupting: true });
    expect(renderView(view)).toContain('  eventSubProcess OnMsg "On message" [expanded]\n    startEvent:message MsgStart [message Cancel, non-interrupting] -> MsgEnd (M1)');
    expect(view.problems).toEqual([]);
  });

  it('lists nested lanes with their members', async () => {
    const lanes = `<bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Sales" name="Sales"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef>
        <bpmn:childLaneSet id="LaneSet_2"><bpmn:lane id="Lane_Inner" name="Inner"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane></bpmn:childLaneSet>
      </bpmn:lane>
      <bpmn:lane id="Lane_IT" name="IT"><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>`;
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'task', id: 'A' },
            { tag: 'endEvent', id: 'End' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'A' },
            { id: 'F2', from: 'A', to: 'End' },
          ],
          lanes,
        ),
      ),
    );
    const view = buildView(doc);
    expect(view.processes[0]!.lanes).toEqual([
      { id: 'Lane_Sales', name: 'Sales', members: ['Start'], lanes: [{ id: 'Lane_Inner', name: 'Inner', members: ['A'] }] },
      { id: 'Lane_IT', name: 'IT', members: ['End'] },
    ]);
    expect(view.processes[0]!.nodes.map((n) => n.lane)).toEqual(['Lane_Sales', 'Lane_Inner', 'Lane_IT']);
    expect(renderView(view)).toContain('  lanes:\n    Lane_Sales "Sales" [Start]\n      Lane_Inner "Inner" [A]\n    Lane_IT "IT" [End]');
    expect(view.problems).toEqual([]);
  });

  it('renders a collaboration with two participants, message flows and a black box', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${BPMN_NS}" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Shop" name="Shop" processRef="Process_Shop" />
    <bpmn:participant id="Participant_Bank" name="Bank" processRef="Process_Bank" />
    <bpmn:participant id="Participant_Customer" name="Customer" />
    <bpmn:messageFlow id="Flow_M1" name="Order" sourceRef="Participant_Customer" targetRef="Start" />
    <bpmn:messageFlow id="Flow_M2" sourceRef="Pay" targetRef="Receive" messageRef="Message_Pay" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Shop" name="Shop" isExecutable="true">
    ${body(
      [
        { tag: 'startEvent', id: 'Start', inner: '<bpmn:messageEventDefinition />' },
        { tag: 'sendTask', id: 'Pay', attrs: 'name="Pay" messageRef="Message_Pay"' },
        { tag: 'endEvent', id: 'End' },
      ],
      [
        { id: 'F1', from: 'Start', to: 'Pay' },
        { id: 'F2', from: 'Pay', to: 'End' },
      ],
    )}
  </bpmn:process>
  <bpmn:process id="Process_Bank" isExecutable="false">
    ${body(
      [
        { tag: 'startEvent', id: 'BStart' },
        { tag: 'receiveTask', id: 'Receive', attrs: 'name="Receive payment"' },
        { tag: 'endEvent', id: 'BEnd' },
      ],
      [
        { id: 'B1', from: 'BStart', to: 'Receive' },
        { id: 'B2', from: 'Receive', to: 'BEnd' },
      ],
    )}
  </bpmn:process>
  <bpmn:message id="Message_Pay" name="Payment" />
</bpmn:definitions>`;
    const doc = await docFromXml(xml);
    const view = buildView(doc);
    expect(view.collaboration).toEqual({
      id: 'Collaboration_1',
      participants: [
        { id: 'Participant_Shop', name: 'Shop', process: 'Process_Shop' },
        { id: 'Participant_Bank', name: 'Bank', process: 'Process_Bank' },
        { id: 'Participant_Customer', name: 'Customer' },
      ],
      messageFlows: [
        { id: 'Flow_M1', source: 'Participant_Customer', target: 'Start', name: 'Order' },
        { id: 'Flow_M2', source: 'Pay', target: 'Receive', message: 'Payment' },
      ],
    });
    expect(view.processes.map((p) => [p.id, p.executable, p.participant])).toEqual([
      ['Process_Shop', true, 'Participant_Shop'],
      ['Process_Bank', false, 'Participant_Bank'],
    ]);
    const text = renderView(view);
    expect(text).toContain(
      [
        'collaboration Collaboration_1',
        '  participant Participant_Shop "Shop" = Process_Shop',
        '  participant Participant_Bank "Bank" = Process_Bank',
        '  participant Participant_Customer "Customer" (black box)',
        '  messageFlow Flow_M1 Participant_Customer -> Start "Order"',
        '  messageFlow Flow_M2 Pay -> Receive [message Payment]',
        'process Process_Shop "Shop" executable in Participant_Shop',
      ].join('\n'),
    );
    expect(text).toContain('process Process_Bank non-executable in Participant_Bank');
    expect(text).toContain('  sendTask Pay "Pay" [message=Payment] -> End (F2)');
    expect(text).toContain('root: message Message_Pay "Payment"');
    expect(view.problems).toEqual([]);
  });

  it('lists data objects and stores with their associations', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            {
              tag: 'task',
              id: 'Write',
              attrs: 'name="Write"',
              inner: '<bpmn:dataOutputAssociation id="DOA_1"><bpmn:targetRef>DataObjectReference_Order</bpmn:targetRef></bpmn:dataOutputAssociation><bpmn:dataOutputAssociation id="DOA_2"><bpmn:targetRef>DataStoreReference_DB</bpmn:targetRef></bpmn:dataOutputAssociation>',
            },
            {
              tag: 'task',
              id: 'Read',
              attrs: 'name="Read"',
              inner:
                '<bpmn:property id="Property_1" name="__targetRef_placeholder" /><bpmn:dataInputAssociation id="DIA_1"><bpmn:sourceRef>DataObjectReference_Order</bpmn:sourceRef><bpmn:targetRef>Property_1</bpmn:targetRef></bpmn:dataInputAssociation>',
            },
            { tag: 'endEvent', id: 'End' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'Write' },
            { id: 'F2', from: 'Write', to: 'Read' },
            { id: 'F3', from: 'Read', to: 'End' },
          ],
          `<bpmn:dataObjectReference id="DataObjectReference_Order" name="Order" dataObjectRef="DataObject_Order" />
           <bpmn:dataObject id="DataObject_Order" />
           <bpmn:dataStoreReference id="DataStoreReference_DB" name="DB" />`,
        ),
      ),
    );
    const view = buildView(doc);
    expect(view.processes[0]!.data).toEqual([
      { id: 'DataObjectReference_Order', kind: 'dataObject', name: 'Order', from: ['Write'], to: ['Read'] },
      { id: 'DataStoreReference_DB', kind: 'dataStore', name: 'DB', from: ['Write'], to: [] },
    ]);
    expect(renderView(view)).toContain('  data:\n    dataObject DataObjectReference_Order "Order" (from Write; to Read)\n    dataStore DataStoreReference_DB "DB" (from Write)');
    expect(view.problems).toEqual([]);
  });

  it('lists text annotations with the elements they are attached to', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'endEvent', id: 'End' },
          ],
          [{ id: 'F1', from: 'Start', to: 'End' }],
          `<bpmn:textAnnotation id="TextAnnotation_1"><bpmn:text>note text</bpmn:text></bpmn:textAnnotation>
           <bpmn:textAnnotation id="TextAnnotation_2"><bpmn:text>loose</bpmn:text></bpmn:textAnnotation>
           <bpmn:association id="Association_1" sourceRef="Start" targetRef="TextAnnotation_1" />
           <bpmn:association id="Association_2" sourceRef="TextAnnotation_1" targetRef="End" />`,
        ),
      ),
    );
    const view = buildView(doc);
    expect(view.processes[0]!.annotations).toEqual([
      { id: 'TextAnnotation_1', text: 'note text', attachedTo: ['Start', 'End'] },
      { id: 'TextAnnotation_2', text: 'loose', attachedTo: [] },
    ]);
    expect(renderView(view)).toContain('  annotations:\n    TextAnnotation_1 "note text" ~ Start, End\n    TextAnnotation_2 "loose"');
  });

  it('mentions vendor namespaces, attributes, extension elements, documentation and semantic props', async () => {
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            {
              tag: 'serviceTask',
              id: 'A',
              attrs: 'name="Call worker" camunda:asyncBefore="true"',
              inner:
                '<bpmn:documentation>Talks to the   payment provider</bpmn:documentation><bpmn:extensionElements><zeebe:taskDefinition type="pay" /><zeebe:ioMapping /></bpmn:extensionElements><bpmn:multiInstanceLoopCharacteristics isSequential="true"><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>',
            },
            { tag: 'callActivity', id: 'C', attrs: 'calledElement="Other"' },
            { tag: 'endEvent', id: 'End' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'A' },
            { id: 'F2', from: 'A', to: 'C' },
            { id: 'F3', from: 'C', to: 'End' },
          ],
        ),
        { nsDecl: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"' },
      ),
    );
    const view = buildView(doc);
    expect(view.definitions.namespaces).toEqual(['camunda', 'zeebe']);
    const task = view.processes[0]!.nodes[1]!;
    expect(task.extensions).toEqual(['zeebe:taskDefinition', 'zeebe:ioMapping', 'camunda:asyncBefore']);
    expect(task.props).toEqual({ loop: 'sequential', cardinality: '3' });
    expect(task.documentation).toBe('Talks to the   payment provider');
    expect(view.processes[0]!.nodes[2]!.props).toEqual({ calledElement: 'Other' });
    const text = renderView(view);
    expect(text.startsWith('namespaces: camunda, zeebe\n')).toBe(true);
    expect(text).toContain('  serviceTask A "Call worker" [loop=sequential, cardinality=3, camunda:asyncBefore=true, ext: zeebe:taskDefinition, zeebe:ioMapping, doc: "Talks to the payment provider"] -> C (F2)');
    expect(text).toContain('  callActivity C [calledElement=Other] -> End (F3)');
  });

  it('shows an empty process and its problems', async () => {
    const doc = await docFromXml(definitionsXml(''));
    const text = renderView(buildView(doc));
    expect(text).toContain('process Process_1 executable\n  (empty)\nproblems:\n  W_NO_START Process_1:');
    expect(text).toContain('W_NO_END Process_1:');
  });
});

/* ------------------------------------------------------------------ */
/* elementDetail / renderDetail                                         */
/* ------------------------------------------------------------------ */

describe('elementDetail / renderDetail', () => {
  const XML = definitionsXml(
    body(
      [
        { tag: 'startEvent', id: 'Start' },
        { tag: 'userTask', id: 'A', attrs: 'name="Check" camunda:assignee="bob"', inner: '<bpmn:extensionElements><zeebe:taskDefinition type="check" /></bpmn:extensionElements>' },
        { tag: 'boundaryEvent', id: 'Timeout', attrs: 'attachedToRef="A"', inner: timer('PT1H') },
        { tag: 'exclusiveGateway', id: 'Gw', attrs: 'name="Ok?" default="Flow_no"' },
        { tag: 'subProcess', id: 'Sub', attrs: 'name="Sub"', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }]) },
        { tag: 'endEvent', id: 'End' },
        { tag: 'endEvent', id: 'Late' },
      ],
      [
        { id: 'F1', from: 'Start', to: 'A' },
        { id: 'F2', from: 'A', to: 'Gw' },
        { id: 'Flow_yes', from: 'Gw', to: 'Sub', attrs: 'name="yes"', inner: condition('${ok}') },
        { id: 'Flow_no', from: 'Gw', to: 'End', attrs: 'name="no"' },
        { id: 'F3', from: 'Sub', to: 'End' },
        { id: 'F4', from: 'Timeout', to: 'Late' },
      ],
      `<bpmn:laneSet id="LaneSet_1"><bpmn:lane id="Lane_1" name="L"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`,
    ),
    { nsDecl: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"' },
  );

  it('describes a task with lane, flows, boundary events, extensions and vendor attrs', async () => {
    const doc = await docFromXml(XML);
    const d = elementDetail(doc, doc.require('A'));
    expect(d).toMatchObject({ id: 'A', kind: 'userTask', type: 'bpmn:UserTask', name: 'Check', scope: 'Process_1', process: 'Process_1', lane: 'Lane_1', boundary: ['Timeout'] });
    expect(d.incoming).toEqual([{ id: 'F1', source: 'Start' }]);
    expect(d.outgoing).toEqual([{ id: 'F2', target: 'Gw' }]);
    expect(d.attrs).toEqual({ 'camunda:assignee': 'bob' });
    expect(d.extensions.map((e) => (e as { type: string }).type)).toEqual(['zeebe:taskDefinition']);
    const text = renderDetail(d);
    expect(text).toContain('id: A\nkind: userTask\ntype: bpmn:UserTask\nname: Check\nscope: Process_1\nprocess: Process_1\nlane: Lane_1');
    expect(text).toContain('incoming: F1 from Start\noutgoing: F2 to Gw\nboundary: Timeout\nextensions:\n  zeebe:taskDefinition type="check"\ncamunda:assignee: bob');
  });

  it('describes a gateway with its default flow and conditional branches', async () => {
    const doc = await docFromXml(XML);
    const d = elementDetail(doc, doc.require('Gw'));
    expect(d.properties['default']).toBe('Flow_no');
    expect(d.outgoing).toEqual([
      { id: 'Flow_yes', target: 'Sub', name: 'yes', condition: '${ok}' },
      { id: 'Flow_no', target: 'End', name: 'no', default: true },
    ]);
    expect(renderDetail(d)).toContain('outgoing: Flow_yes to Sub "yes" if ${ok}; Flow_no to End "no" default');
  });

  it('describes a sequence flow, a boundary event, a sub-process and a lane', async () => {
    const doc = await docFromXml(XML);
    const flow = elementDetail(doc, doc.require('Flow_no'));
    expect(flow.kind).toBe('sequenceFlow');
    expect(flow.properties).toMatchObject({ source: 'Gw', target: 'End', default: true });
    expect(renderDetail(elementDetail(doc, doc.require('Flow_yes')))).toContain('source: Gw\ntarget: Sub\ncondition: ${ok}');

    const boundary = elementDetail(doc, doc.require('Timeout'));
    expect(boundary).toMatchObject({ kind: 'boundaryEvent:timer', host: 'A' });
    expect(boundary.properties).toMatchObject({ trigger: 'timer', triggerDetails: 'PT1H' });
    expect(boundary.lane).toBeUndefined();

    const sub = elementDetail(doc, doc.require('Sub'));
    expect(sub.children).toEqual(['S2', 'E2']);
    expect(sub.properties['expanded']).toBe(true);
    expect(renderDetail(sub)).toContain('children: S2, E2');

    const lane = elementDetail(doc, doc.require('Lane_1'));
    expect(lane.kind).toBe('lane');
    expect(lane.properties['members']).toEqual(['A']);
    expect(renderDetail(lane)).toContain('members: A');
  });
});

/* ------------------------------------------------------------------ */
/* findElements                                                         */
/* ------------------------------------------------------------------ */

describe('findElements', () => {
  it('matches ids and names case-insensitively and filters by kind', async () => {
    const doc = await linearDoc();
    expect(findElements(doc, 'do a')).toEqual([{ id: 'Task_A', kind: 'userTask', name: 'Do A', scope: 'Process_1' }]);
    expect(findElements(doc, 'START').map((e) => e.id)).toEqual(['Start']);
    expect(findElements(doc, '', 'user').map((e) => e.id)).toEqual(['Task_A']);
    expect(findElements(doc, '', 'bpmn:EndEvent').map((e) => e.id)).toEqual(['End']);
    expect(findElements(doc, '', 'sequenceFlow').map((e) => e.id)).toEqual(['F1', 'F2']);
    expect(findElements(doc, 'nothing-like-this')).toEqual([]);
    expect(findElements(doc, '', 'startEvent:message')).toEqual([]);
    expect(findElements(doc, '', 'startEvent:none').map((e) => e.id)).toEqual(['Start']);
    expect(findElements(doc, '').map((e) => e.id)).toEqual(['Process_1', 'Start', 'Task_A', 'End', 'F1', 'F2']);
  });

  it('rejects unknown kinds with a usage error', async () => {
    const doc = await linearDoc();
    expect(() => findElements(doc, '', 'usertsk')).toThrowError(/Unknown kind "usertsk"/);
    try {
      findElements(doc, '', 'usertsk');
    } catch (err) {
      expect((err as { code: string }).code).toBe('E_USAGE');
    }
  });

  it('labelOf gives canonical kinds and lowerCamel types', async () => {
    const doc = await linearDoc();
    expect(labelOf(doc.require('Task_A'))).toBe('userTask');
    expect(labelOf(doc.require('F1'))).toBe('sequenceFlow');
    expect(labelOf(doc.require('Process_1'))).toBe('process');
  });
});

/* ------------------------------------------------------------------ */
/* renderChanges / renderProblems                                       */
/* ------------------------------------------------------------------ */

describe('renderChanges / renderProblems', () => {
  it('prints one line per change, then warnings, then notes', () => {
    const cs = new ChangeSet()
      .create({ id: 'Activity_X', kind: 'userTask', name: 'Do X', detail: 'after Event_Y' })
      .create({ id: 'Flow_3', kind: 'sequenceFlow', detail: 'Event_Y -> Activity_X' })
      .change({ id: 'Flow_1', kind: 'sequenceFlow', detail: 'Start -> Activity_X (was -> Task_A)' })
      .remove({ id: 'Flow_2', kind: 'sequenceFlow', name: 'old', detail: 'Task_A -> End' })
      .warn({ code: 'W_IMPLICIT_JOIN', message: 'End now has 2 incoming flows', element: 'End', hint: 'Join through a gateway.' })
      .note('inserted between Start and Task_A');
    expect(renderChanges(cs)).toBe(
      [
        'created userTask Activity_X "Do X" - after Event_Y',
        'created sequenceFlow Flow_3 - Event_Y -> Activity_X',
        'changed sequenceFlow Flow_1 - Start -> Activity_X (was -> Task_A)',
        'removed sequenceFlow Flow_2 "old" - Task_A -> End',
        'warning W_IMPLICIT_JOIN End: End now has 2 incoming flows  (Join through a gateway.)',
        'note: inserted between Start and Task_A',
      ].join('\n'),
    );
    expect(renderChanges(new ChangeSet().note('nothing to do'))).toBe('no changes\nnote: nothing to do');
  });

  it('prints one line per problem', () => {
    expect(
      renderProblems([
        { code: 'E_CROSS_SCOPE', message: 'Flows cannot cross scopes', element: 'Flow_1', related: ['A', 'B'], hint: 'Use a message flow.' },
        { code: 'W_NO_END', message: 'Process P has no end event', element: 'P' },
        { code: 'E_X', message: 'no element' },
      ]),
    ).toBe(['E_CROSS_SCOPE Flow_1 [A, B]: Flows cannot cross scopes  (Use a message flow.)', 'W_NO_END P: Process P has no end event', 'E_X: no element'].join('\n'));
    expect(renderProblems([])).toBe('no problems');
  });
});

/* ------------------------------------------------------------------ */
/* link events, ad-hoc sub-processes, files without incoming/outgoing  */
/* ------------------------------------------------------------------ */

describe('reachability in the view', () => {
  it('link catch events and ad-hoc children are not rendered as unreachable', async () => {
    const link = (name: string) => `<bpmn:linkEventDefinition name="${name}" />`;
    const doc = await docFromXml(
      definitionsXml(
        body(
          [
            { tag: 'startEvent', id: 'Start' },
            { tag: 'intermediateThrowEvent', id: 'Throw', inner: link('L1') },
            { tag: 'adHocSubProcess', id: 'AdHoc', inner: '<bpmn:task id="T1" name="Free" /><bpmn:task id="T2" />' },
            { tag: 'intermediateCatchEvent', id: 'Catch', inner: link('L1') },
            { tag: 'endEvent', id: 'End' },
          ],
          [
            { id: 'F1', from: 'Start', to: 'Throw' },
            { id: 'F2', from: 'Catch', to: 'AdHoc' },
            { id: 'F3', from: 'AdHoc', to: 'End' },
          ],
        ),
      ),
    );
    const view = buildView(doc);
    expect(view.problems).toEqual([]);
    expect(ids(view.processes[0]!.nodes)).toEqual(['Start', 'Throw', 'Catch', 'AdHoc', 'End']);
    expect(view.processes[0]!.nodes.every((n) => !n.unreachable)).toBe(true);
    const text = renderView(view);
    expect(text).not.toContain('unreachable');
    expect(text).toContain('  intermediateThrowEvent:link Throw [link L1]\n  intermediateCatchEvent:link Catch [link L1] -> AdHoc (F2)\n  adHocSubProcess AdHoc [expanded] -> End (F3)\n    task T1 "Free"\n    task T2\n');
    expect(text.endsWith('problems: none')).toBe(true);
  });

  it('renders files that omit the optional incoming/outgoing entries', async () => {
    const xml = definitionsXml(`
        <bpmn:startEvent id="Start" />
        <bpmn:task id="A" name="Do" />
        <bpmn:endEvent id="End" />
        <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="A" />
        <bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="End" />`);
    const view = buildView(await docFromXml(xml));
    expect(view.problems).toEqual([]);
    expect(renderView(view)).toBe(['process Process_1 executable', '  startEvent Start -> A (F1)', '  task A "Do" -> End (F2)', '  endEvent End', 'problems: none'].join('\n'));
    const fresh = await docFromXml(xml);
    const detail = elementDetail(fresh, fresh.require('A'));
    expect(detail.incoming).toEqual([{ id: 'F1', source: 'Start' }]);
    expect(detail.outgoing).toEqual([{ id: 'F2', target: 'End' }]);
    expect(renderDetail(detail)).toContain('incoming: F1 from Start\noutgoing: F2 to End');
  });
});
