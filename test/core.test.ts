import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { IdRegistry, isValidId, slugify } from '../src/ids.js';
import { kindLabel, kindOf, parseKind, suggestKinds, triggerOf } from '../src/kinds.js';
import { diExpansionState, layoutModel, resolveExpanded } from '../src/layout.js';
import { many } from '../src/model.js';
import { createSequenceFlow, detachNode, placeNode, redirectFlow, spliceIntoFlow } from '../src/ops/flows.js';
import { runOps } from '../src/ops/index.js';
import { mutateDoc } from '../src/pipeline.js';
import { ChangeSet } from '../src/result.js';
import { definitionsXml, linearDoc } from './helpers.js';

function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

/** start -> "Charge card" -> end, a compensate boundary event on the task and an unconnected compensation handler. */
async function compensationDoc(): Promise<Doc> {
  const doc = Doc.create({ processId: 'P' });
  runOps(doc, [
    { op: 'add', kind: 'startEvent', id: 'S' },
    { op: 'add', kind: 'serviceTask', name: 'Charge card', after: 'S' },
    { op: 'add', kind: 'endEvent', id: 'E', after: 'Activity_ChargeCard' },
    { op: 'add', kind: 'boundaryEvent:compensate', id: 'Comp', on: 'Activity_ChargeCard' },
    { op: 'add', kind: 'serviceTask', name: 'Refund card', in: 'P', set: { isForCompensation: 'true' } },
    { op: 'connect', source: 'Comp', target: 'Activity_RefundCard' },
  ]);
  return doc;
}

describe('ids', () => {
  it('slugifies names to ASCII PascalCase', () => {
    expect(slugify('Check invoice')).toBe('CheckInvoice');
    expect(slugify('Rechnung prüfen (groß)')).toBe('RechnungPrufenGross');
    expect(slugify('  ')).toBe('');
    expect(slugify('a'.repeat(60)).length).toBe(40);
  });

  it('generates Prefix_Slug and Prefix_n ids without collisions', () => {
    const ids = new IdRegistry(['Activity_CheckInvoice', 'Flow_3', 'Flow_7']);
    expect(ids.next('Activity', 'Check invoice')).toBe('Activity_CheckInvoice_2');
    expect(ids.next('Activity', 'Check invoice')).toBe('Activity_CheckInvoice_3');
    expect(ids.next('Flow')).toBe('Flow_8');
    expect(ids.next('Flow')).toBe('Flow_9');
    expect(ids.next('Gateway', '???')).toBe('Gateway_1');
  });

  it('validates NCNames', () => {
    expect(isValidId('Task_1')).toBe(true);
    expect(isValidId('1Task')).toBe(false);
    expect(isValidId('has space')).toBe(false);
  });
});

describe('kinds', () => {
  it('resolves canonical names, aliases and moddle types', () => {
    expect(parseKind('userTask').def.type).toBe('bpmn:UserTask');
    expect(parseKind('user').def.kind).toBe('userTask');
    expect(parseKind('bpmn:UserTask').def.kind).toBe('userTask');
    expect(parseKind('UserTask').def.kind).toBe('userTask');
    expect(parseKind('xor').def.kind).toBe('exclusiveGateway');
    expect(parseKind('eventSub').def.props).toEqual({ triggeredByEvent: true });
    expect(parseKind('bpmn:SubProcess').def.kind).toBe('subProcess');
  });

  it('parses triggers and enforces the matrix', () => {
    expect(parseKind('startEvent:message').trigger).toBe('message');
    expect(parseKind('boundary:timer').trigger).toBe('timer');
    expect(parseKind('end:compensation').trigger).toBe('compensate');
    expect(() => parseKind('startEvent:terminate')).toThrow(/not allowed/);
    expect(() => parseKind('userTask:timer')).toThrow(/not an event/);
    expect(() => parseKind('catch:bogus')).toThrow(/Unknown event trigger/);
  });

  it('rejects unsupported kinds with a reason and suggests near misses', () => {
    expect(() => parseKind('complexGateway')).toThrow(/rejected/);
    expect(() => parseKind('usertsk')).toThrow(/did you mean/);
    expect(suggestKinds('servic')).toContain('serviceTask');
  });

  it('labels elements with kind and trigger', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:messageEventDefinition /></bpmn:startEvent>
    <bpmn:subProcess id="ES" triggeredByEvent="true" />
    <bpmn:userTask id="T" />`),
    );
    expect(kindLabel(doc.get('S')!)).toBe('startEvent:message');
    expect(triggerOf(doc.get('T')!)).toBeUndefined();
    expect(kindOf(doc.get('ES')!)?.kind).toBe('eventSubProcess');
    expect(kindLabel(doc.get('T')!)).toBe('userTask');
  });
});

describe('document', () => {
  it('creates a new document with a named process', async () => {
    const doc = Doc.create({ processName: 'Order handling', target: 'camunda8' });
    expect(doc.processes()[0]!.get('id')).toBe('Process_OrderHandling');
    const xml = await doc.toXml();
    expect(xml).toContain('xmlns:zeebe=');
    expect(xml).toContain('modeler:executionPlatform="Camunda Cloud"');
    const again = await Doc.fromXml(xml);
    expect(again.importWarnings).toHaveLength(0);
  });

  it('resolves ids with candidates and type checks', async () => {
    const doc = await linearDoc();
    expect(doc.require('Task_A').get('id')).toBe('Task_A');
    expect(() => doc.require('task_a')).toThrow(/did you mean: Task_A/);
    expect(() => doc.require('Task_A', 'bpmn:Gateway')).toThrow(/expected Gateway/);
    expect(doc.scopeOf(doc.get('Task_A')!)?.get('id')).toBe('Process_1');
    expect(doc.incoming(doc.get('End')!).map((f) => f.get('id'))).toEqual(['F2']);
  });

  it('detects lossy imports', async () => {
    const doc = await Doc.fromXml(definitionsXml(`<bpmn:fooBar id="X" />`));
    expect(doc.lossyImportWarnings.length).toBeGreaterThan(0);
  });

  it('never resolves or suggests diagram interchange ids', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`<bpmn:task id="Task_A" />`, {
        extraRoots: `<bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_Process_1" bpmnElement="Process_1"><bpmndi:BPMNShape id="BPMNShape_Task_A" bpmnElement="Task_A"><dc:Bounds x="0" y="0" width="100" height="80" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
        nsDecl: 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
      }),
    );
    expect(doc.importWarnings).toHaveLength(0);
    expect(doc.get('BPMNShape_Task_A')).toBeUndefined();
    expect(doc.suggest('Task_')).toEqual(['Task_A']);
    expect(doc.suggest('Process')).toEqual(['Process_1']);
    expect(caught(() => doc.require('BPMNShape_Task_A')).code).toBe('E_NOT_FOUND');
    // DI ids stay reserved so a generated or explicit id can never collide with a shape id
    expect(caught(() => doc.claimId('BPMNShape_Task_A')).code).toBe('E_DUPLICATE_ID');
  });

  it('points unknown namespace prefixes at a way that exists', () => {
    const doc = Doc.create({ processId: 'P' });
    const err = caught(() => doc.declareNamespace('acme'));
    expect(err.code).toBe('E_UNKNOWN_NAMESPACE');
    expect(String(err.details['hint'])).toMatch(/--xml '<acme:<type> xmlns:acme="<uri>"\/>'/);
    expect(String(err.details['hint'])).not.toMatch(/--ns/);
  });
});

describe('flows & placement', () => {
  it('splices after a connected task and appends after a gateway', async () => {
    const doc = await linearDoc();
    const cs = new ChangeSet();
    const t = doc.create('bpmn:ServiceTask', { id: doc.newId('Activity', 'Check stock'), name: 'Check stock' });
    placeNode(doc, t, { after: 'Task_A', flowName: 'ok' }, cs);
    expect(cs.notes).toContain('inserted between Task_A and End');
    expect(doc.outgoing(doc.get('Task_A')!).map((f) => f.get<any>('targetRef').id)).toEqual(['Activity_CheckStock']);
    expect(doc.get('F2')!.get('name')).toBe('ok');
    const gw = doc.create('bpmn:ExclusiveGateway', { id: 'G', name: 'ok?' });
    placeNode(doc, gw, { after: 'Activity_CheckStock' }, new ChangeSet());
    const e2 = doc.create('bpmn:EndEvent', { id: 'E2' });
    const cs2 = new ChangeSet();
    placeNode(doc, e2, { after: 'G', flowName: 'no', default: true }, cs2);
    expect(cs2.notes).toContain('appended after G');
    expect(gw.get<any>('default').id).toBe(cs2.created[0]!.id);
    const xml = await doc.toXml();
    expect((await Doc.fromXml(xml)).importWarnings).toHaveLength(0);
  });

  it('refuses to fork a non-gateway silently', async () => {
    const doc = await linearDoc();
    const t = doc.create('bpmn:Task', { id: 'T2' });
    placeNode(doc, t, { in: 'Process_1' }, new ChangeSet());
    createSequenceFlow(doc, doc.get('Task_A')!, t, {});
    const t3 = doc.create('bpmn:Task', { id: 'T3' });
    expect(() => placeNode(doc, t3, { after: 'Task_A' }, new ChangeSet())).toThrow(/E_HAS_SUCCESSOR|outgoing flows/);
  });

  it('places before, between and into a flow; attaches boundary events', async () => {
    const doc = await linearDoc();
    const a = doc.create('bpmn:Task', { id: 'A' });
    const cs = new ChangeSet();
    placeNode(doc, a, { before: 'End' }, cs);
    expect(cs.notes[0]).toMatch(/inserted between Task_A and End/);
    const b = doc.create('bpmn:Task', { id: 'B' });
    placeNode(doc, b, { after: 'Start', before: 'Task_A' }, new ChangeSet());
    expect(doc.outgoing(doc.get('Start')!)[0]!.get<any>('targetRef').id).toBe('B');
    const c = doc.create('bpmn:Task', { id: 'C' });
    placeNode(doc, c, { flow: 'F1' }, new ChangeSet());
    expect(doc.get('F1')!.get<any>('targetRef').id).toBe('C');
    const be = doc.create('bpmn:BoundaryEvent', { id: 'BE' });
    placeNode(doc, be, { on: 'Task_A' }, new ChangeSet());
    expect(be.get<any>('attachedToRef').id).toBe('Task_A');
    expect(() => placeNode(doc, doc.create('bpmn:Task', { id: 'D' }), { on: 'Task_A' }, new ChangeSet())).toThrow(/boundary/);
    expect(() => placeNode(doc, doc.create('bpmn:BoundaryEvent', { id: 'BE2' }), { after: 'Task_A' }, new ChangeSet())).toThrow(/--on/);
  });

  it('bridges on detach and carries labels over', async () => {
    const doc = await linearDoc();
    doc.get('F2')!.set('name', 'done');
    const cs = new ChangeSet();
    detachNode(doc, doc.get('Task_A')!, true, cs);
    expect(doc.get('F1')!.get<any>('targetRef').id).toBe('End');
    expect(doc.get('F1')!.get('name')).toBe('done');
    expect(doc.get('F2')).toBeUndefined();
    expect(cs.notes).toContain('bridged: Start -> End');
  });

  it('rejects invalid endpoints and cross-scope flows', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`
    <bpmn:startEvent id="S" />
    <bpmn:endEvent id="E" />
    <bpmn:subProcess id="Sub"><bpmn:task id="Inner" /></bpmn:subProcess>`),
    );
    expect(() => createSequenceFlow(doc, doc.get('E')!, doc.get('S')!, {})).toThrow(/End event/);
    expect(() => createSequenceFlow(doc, doc.get('S')!, doc.get('Inner')!, {})).toThrow(/cross scopes/);
    expect(() => createSequenceFlow(doc, doc.get('S')!, doc.get('E')!, { condition: '  ' })).toThrow(/empty/);
  });

  it('applies flow options of --before to the flow INTO the new node', async () => {
    const doc = await linearDoc();
    const t = doc.create('bpmn:ServiceTask', { id: 'Book' });
    const cs = new ChangeSet();
    placeNode(doc, t, { before: 'End', flowName: 'yes', condition: '${ok}' }, cs);
    const into = doc.get('F2')!; // Task_A -> Book, the spliced flow
    expect(into.get<any>('targetRef').id).toBe('Book');
    expect(into.get('name')).toBe('yes');
    expect(into.get<any>('conditionExpression').body).toBe('${ok}');
    const out = doc.outgoing(t)[0]!; // Book -> End stays plain
    expect(out.get('name')).toBeUndefined();
    expect(out.get('conditionExpression')).toBeUndefined();
    expect(cs.changed.some((c) => c.id === 'F2' && c.name === 'yes')).toBe(true);
  });

  it('prepending applies flow options to the one flow it creates and says so', async () => {
    const doc = await linearDoc();
    const x = doc.create('bpmn:Task', { id: 'X' });
    placeNode(doc, x, { in: 'Process_1' }, new ChangeSet());
    const y = doc.create('bpmn:Task', { id: 'Y' });
    const cs = new ChangeSet();
    placeNode(doc, y, { before: 'X', flowName: 'go', flowId: 'Flow_Go' }, cs);
    expect(doc.get('Flow_Go')!.get<any>('targetRef').id).toBe('X');
    expect(doc.get('Flow_Go')!.get('name')).toBe('go');
    expect(cs.notes.some((n) => /--flow-name, --flow-id applied to Flow_Go/.test(n))).toBe(true);
  });

  it('refuses to splice start / end events into a flow before touching the model', async () => {
    const doc = await linearDoc();
    const before = doc.flowElements(doc.processes()[0]!).length;
    const end = doc.create('bpmn:EndEvent', { id: 'E2' });
    let err = caught(() => placeNode(doc, end, { after: 'Task_A' }, new ChangeSet()));
    expect(err.code).toBe('E_INVALID_PLACEMENT');
    expect(err.message).toMatch(/endEvent E2 cannot be inserted into the flow Task_A -> End/);
    expect(String(err.details['hint'])).toMatch(/--in Process_1/);
    expect(String(err.details['hint'])).toMatch(/bpmn connect <file> Task_A <newId>/);
    const start = doc.create('bpmn:StartEvent', { id: 'S2' });
    err = caught(() => placeNode(doc, start, { before: 'Task_A' }, new ChangeSet()));
    expect(err.code).toBe('E_INVALID_PLACEMENT');
    expect(err.message).toMatch(/cannot have incoming sequence flows/);
    err = caught(() => placeNode(doc, start, { flow: 'F1' }, new ChangeSet()));
    expect(err.code).toBe('E_INVALID_PLACEMENT');
    // nothing was retargeted or created
    expect(doc.get('F1')!.get<any>('targetRef').id).toBe('Task_A');
    expect(doc.get('F2')!.get<any>('targetRef').id).toBe('End');
    expect(doc.flowElements(doc.processes()[0]!).length).toBe(before);
    expect(caught(() => spliceIntoFlow(doc, doc.get('F2')!, end)).code).toBe('E_INVALID_SOURCE');
    expect(doc.get('F2')!.get<any>('targetRef').id).toBe('End');
  });

  it('removes and reports a self-loop flow once on detach', async () => {
    const doc = await linearDoc();
    redirectFlow(doc, doc.get('F2')!, { target: doc.get('Task_A')! });
    const cs = new ChangeSet();
    detachNode(doc, doc.get('Task_A')!, true, cs);
    expect(cs.removed.map((c) => c.id)).toEqual(['F1', 'F2']);
    expect(doc.get('F2')).toBeUndefined();
  });

  it('keeps declaration order: node after its source, flows after the node', async () => {
    const doc = await linearDoc();
    const t = doc.create('bpmn:Task', { id: 'T' });
    spliceIntoFlow(doc, doc.get('F2')!, t);
    const order = doc.flowElements(doc.processes()[0]!).map((e) => e.get('id'));
    expect(order.indexOf('T')).toBeGreaterThan(order.indexOf('Task_A'));
    expect(order.indexOf('Flow_1')).toBeGreaterThan(order.indexOf('T'));
  });
});

describe('layout', () => {
  it('expands sub-processes by default and remembers collapse via DI', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Sub"><bpmn:incoming>F1</bpmn:incoming><bpmn:task id="Inner" /></bpmn:subProcess>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Sub" />`),
    );
    expect([...resolveExpanded(doc.model)]).toEqual(['Sub']);
    const r1 = await layoutModel(doc.model);
    expect(r1.expanded).toEqual(['Sub']);
    expect(r1.xml).toMatch(/BPMNShape_Sub" bpmnElement="Sub" isExpanded="true"/);
    const doc2 = await Doc.fromXml(r1.xml);
    expect(doc2.importWarnings).toHaveLength(0);
    const r2 = await layoutModel(doc2.model, { collapse: ['Sub'] });
    expect(r2.expanded).toEqual([]);
    const doc3 = await Doc.fromXml(r2.xml);
    expect(diExpansionState(doc3.definitions).get('Sub')).toBe(false);
    expect([...resolveExpanded(doc3.model)]).toEqual([]);
    expect(r2.xml).toMatch(/BPMNPlane_Sub/);
  });

  it('maps layout errors to codes', async () => {
    const doc = await Doc.fromXml(definitionsXml(`<bpmn:complexGateway id="CG" />`));
    await expect(layoutModel(doc.model, { engine: 'auto' })).rejects.toMatchObject({ code: 'LAYOUT_UNSUPPORTED_ELEMENT', details: { element: 'CG' } });
  });

  it('ignores expand/collapse ids that are not sub-processes', async () => {
    const doc = await Doc.fromXml(definitionsXml(`<bpmn:subProcess id="Sub"><bpmn:task id="Inner" /></bpmn:subProcess><bpmn:task id="T" />`));
    expect([...resolveExpanded(doc.model, { expand: ['Nope', 'T'], collapse: ['AlsoNope'] })]).toEqual(['Sub']);
    const r = await layoutModel(doc.model, { expand: ['Nope'] });
    expect(r.expanded).toEqual(['Sub']);
  });

  it('lays out a laneless node that shares a data object with a lane member', async () => {
    const doc = Doc.create({ processId: 'P' });
    runOps(doc, [
      { op: 'add', kind: 'startEvent', id: 'S' },
      { op: 'add', kind: 'task', id: 'A', after: 'S' },
      { op: 'add', kind: 'task', id: 'B', after: 'A' },
      { op: 'add', kind: 'endEvent', id: 'E', after: 'B' },
      { op: 'add', kind: 'dataObject', name: 'Doc', in: 'P' },
      { op: 'connect', source: 'A', target: 'DataObjectReference_Doc' },
      { op: 'connect', source: 'DataObjectReference_Doc', target: 'B' },
      { op: 'add', kind: 'lane', name: 'L1', in: 'P', members: ['S', 'A', 'E'] },
    ]);
    const members = () => many(doc.get('Lane_L1')!, 'flowNodeRef').map((n) => n.get('id'));
    expect(members()).toEqual(['S', 'A', 'E']);
    const r = await layoutModel(doc.model);
    expect(r.xml).toMatch(/BPMNShape_B"/);
    // the temporary membership used for the layout leaves no trace, in memory or in the written model
    expect(members()).toEqual(['S', 'A', 'E']);
    const written = await Doc.fromXml(r.xml);
    expect(written.importWarnings).toHaveLength(0);
    expect(many(written.get('Lane_L1')!, 'flowNodeRef').map((n) => n.get('id'))).toEqual(['S', 'A', 'E']);
    expect(written.lanesOf(written.get('B')!)).toHaveLength(0);
  });

  it('draws the compensation association and puts the handler below its boundary event', async () => {
    const doc = await compensationDoc();
    const r = await layoutModel(doc.model);
    expect(r.warnings.filter((w) => w.code === 'DI_NOT_CREATED')).toEqual([]);
    expect(r.xml).toMatch(/BPMNEdge_Association_1/);
    const laidOut = await Doc.fromXml(r.xml);
    const shapes = new Map<string, any>();
    for (const d of many(laidOut.definitions, 'diagrams')) for (const s of many(d.get('plane'), 'planeElement')) shapes.set(s.get('bpmnElement').id, s);
    const event = shapes.get('Comp').bounds;
    const handler = shapes.get('Activity_RefundCard').bounds;
    expect(handler.x + handler.width / 2).toBe(event.x + event.width / 2);
    expect(handler.y).toBeGreaterThan(event.y + event.height);
    const edge = shapes.get('Association_1');
    expect(edge.waypoint).toHaveLength(2);
    expect(edge.waypoint[0].y).toBe(event.y + event.height);
    expect(edge.waypoint[1].y).toBe(handler.y);
  });

  it('draws associations of text annotations on sequence flows', async () => {
    const doc = await linearDoc();
    runOps(doc, [{ op: 'add', kind: 'textAnnotation', text: 'on the flow', to: 'F1' }]);
    const r = await layoutModel(doc.model);
    expect(r.warnings).toEqual([]);
    expect(r.xml).toMatch(/BPMNEdge_Association_1/);
  });
});

describe('pipeline', () => {
  it('keeps a collapse request in the DI when the layout is skipped', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Sub"><bpmn:incoming>F1</bpmn:incoming><bpmn:task id="Inner" /></bpmn:subProcess>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Sub" />`),
    );
    const r = await mutateDoc(doc, [{ op: 'set', id: 'Sub', values: { expanded: 'false' } }], { dryRun: true, layout: false });
    expect(r.layout.status).toBe('skipped');
    expect(r.changes.changed.some((c) => c.id === 'Sub' && c.detail === 'expanded=false')).toBe(true);
    expect(r.xml).toMatch(/bpmnElement="Sub" isExpanded="false"/);
    const again = await Doc.fromXml(r.xml);
    expect(again.importWarnings).toHaveLength(0);
    expect([...resolveExpanded(again.model)]).toEqual([]);
    const laidOut = await layoutModel(again.model);
    expect(laidOut.xml).toMatch(/BPMNPlane_Sub/);
  });
});
