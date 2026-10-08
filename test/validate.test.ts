import { describe, expect, it } from 'vitest';
import type { Doc } from '../src/document.js';
import { addTo, removeFrom } from '../src/model.js';
import { flowOrder, repairFlowLinks, validateDoc } from '../src/validate.js';
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

/** start -> ...nodes... -> end, chained in order. */
function chain(nodes: N[], extra = ''): string {
  const all: N[] = [{ tag: 'startEvent', id: 'Start' }, ...nodes, { tag: 'endEvent', id: 'End' }];
  const flows: F[] = [];
  for (let i = 0; i < all.length - 1; i++) flows.push({ id: `F${i + 1}`, from: all[i]!.id, to: all[i + 1]!.id });
  return body(all, flows, extra);
}

async function processDoc(processBody: string, opts: Parameters<typeof definitionsXml>[1] = {}): Promise<Doc> {
  return docFromXml(definitionsXml(processBody, opts));
}

function codes(doc: Doc): { errors: string[]; warnings: string[] } {
  const r = validateDoc(doc);
  return { errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) };
}

function findingsOf(doc: Doc, code: string) {
  const r = validateDoc(doc);
  return [...r.errors, ...r.warnings].filter((f) => f.code === code);
}

const timerDef = '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const messageDef = '<bpmn:messageEventDefinition />';
const errorDef = '<bpmn:errorEventDefinition />';
const cancelDef = '<bpmn:cancelEventDefinition />';
const terminateDef = '<bpmn:terminateEventDefinition />';

/* ------------------------------------------------------------------ */
/* baseline                                                             */
/* ------------------------------------------------------------------ */

describe('validateDoc baseline', () => {
  it('reports nothing for a clean linear process', async () => {
    expect(codes(await linearDoc())).toEqual({ errors: [], warnings: [] });
  });

  it('every finding has code, message, element and hint', async () => {
    const doc = await processDoc(body([{ tag: 'task', id: 'Lonely' }]));
    const r = validateDoc(doc);
    for (const f of [...r.errors, ...r.warnings]) {
      expect(f.code).toMatch(/^[EW]_[A-Z_]+$/);
      expect(f.message).toBeTruthy();
      expect(f.element).toBeTruthy();
      expect(f.hint).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* structural errors                                                    */
/* ------------------------------------------------------------------ */

describe('structural errors', () => {
  it('E_DUPLICATE_ID', async () => {
    const doc = await linearDoc();
    expect(codes(doc).errors).not.toContain('E_DUPLICATE_ID');
    const process = doc.processes()[0]!;
    addTo(process, 'flowElements', doc.create('bpmn:Task', { id: 'Task_A' }));
    doc.invalidate();
    const f = findingsOf(doc, 'E_DUPLICATE_ID');
    expect(f).toHaveLength(1);
    expect(f[0]!.element).toBe('Task_A');
  });

  it('E_DANGLING_REF for references to elements outside the tree', async () => {
    const doc = await linearDoc();
    expect(codes(doc).errors).not.toContain('E_DANGLING_REF');
    const process = doc.processes()[0]!;
    removeFrom(process, 'flowElements', doc.require('Task_A'));
    doc.invalidate();
    const f = findingsOf(doc, 'E_DANGLING_REF');
    expect(f.map((x) => [x.element, x.related])).toEqual([
      ['F1', ['Task_A']],
      ['F2', ['Task_A']],
    ]);
  });

  it('E_DANGLING_REF for unresolved sourceRef/targetRef', async () => {
    const doc = await processDoc(body([{ tag: 'startEvent', id: 'Start' }], [{ id: 'F1', from: 'Start', to: 'Missing' }]));
    const f = findingsOf(doc, 'E_DANGLING_REF');
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain('has no target');
  });

  it('E_DANGLING_REF for lane members and hosts that were removed', async () => {
    const doc = await processDoc(
      chain([{ tag: 'task', id: 'A' }], '<bpmn:laneSet id="LS"><bpmn:lane id="Lane_1"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>'),
    );
    expect(codes(doc).errors).toEqual([]);
    const process = doc.processes()[0]!;
    const a = doc.require('A');
    removeFrom(process, 'flowElements', a);
    for (const f of [...doc.incoming(a), ...doc.outgoing(a)]) removeFrom(process, 'flowElements', f);
    doc.invalidate();
    const f = findingsOf(doc, 'E_DANGLING_REF');
    expect(f.some((x) => x.element === 'Lane_1' && x.related?.[0] === 'A')).toBe(true);
  });

  it('E_MULTIPLE_ROOTS', async () => {
    const one = await processDoc(chain([]));
    expect(codes(one).errors).not.toContain('E_MULTIPLE_ROOTS');
    const two = await processDoc(chain([]), { extraRoots: '<bpmn:process id="Process_2" />' });
    const f = findingsOf(two, 'E_MULTIPLE_ROOTS');
    expect(f).toHaveLength(1);
    expect(f[0]!.element).toBe('Process_2');
  });

  it('E_EMPTY_COLLABORATION and E_ORPHAN_PROCESS', async () => {
    const bound = await processDoc(chain([]), {
      extraRoots: '<bpmn:collaboration id="C"><bpmn:participant id="P1" processRef="Process_1" /></bpmn:collaboration>',
    });
    expect(codes(bound).errors).toEqual([]);
    const blackOnly = await processDoc(chain([]), { extraRoots: '<bpmn:collaboration id="C"><bpmn:participant id="P1" /></bpmn:collaboration>' });
    expect(codes(blackOnly).errors).toEqual(['E_EMPTY_COLLABORATION', 'E_ORPHAN_PROCESS']);
    const orphan = await processDoc(chain([]), {
      extraRoots: '<bpmn:collaboration id="C"><bpmn:participant id="P1" processRef="Process_1" /></bpmn:collaboration><bpmn:process id="Process_2" />',
    });
    const f = findingsOf(orphan, 'E_ORPHAN_PROCESS');
    expect(f.map((x) => x.element)).toEqual(['Process_2']);
    expect(codes(orphan).errors).not.toContain('E_MULTIPLE_ROOTS');
  });

  it('E_UNSUPPORTED_KIND', async () => {
    const doc = await processDoc(chain([{ tag: 'complexGateway', id: 'Gw' }]));
    const f = findingsOf(doc, 'E_UNSUPPORTED_KIND');
    expect(f).toHaveLength(1);
    expect(f[0]!.element).toBe('Gw');
    expect(f[0]!.message).toContain('complex');
  });

  it('E_INVALID_SOURCE / E_INVALID_TARGET (flow endpoint rules)', async () => {
    const fromEnd = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'endEvent', id: 'End' },
          { tag: 'task', id: 'A' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'End' },
          { id: 'F2', from: 'End', to: 'A' },
          { id: 'F3', from: 'A', to: 'Start' },
        ],
      ),
    );
    const r = validateDoc(fromEnd);
    expect(r.errors.map((e) => [e.code, e.element])).toEqual([
      ['E_INVALID_SOURCE', 'F2'],
      ['E_INVALID_TARGET', 'F3'],
    ]);
    expect(r.errors[0]!.related).toEqual(['End', 'A']);
  });

  it('E_CROSS_SCOPE', async () => {
    const doc = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'subProcess', id: 'Sub', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'task', id: 'Inner' }], [{ id: 'I1', from: 'S2', to: 'Inner' }]) },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Sub' },
          { id: 'F2', from: 'Sub', to: 'End' },
        ],
      ),
    );
    expect(codes(doc).errors).toEqual([]);
    // declare a flow in the process that jumps into the sub-process
    const process = doc.processes()[0]!;
    const start = doc.require('Start');
    const inner = doc.require('Inner');
    const flow = doc.create('bpmn:SequenceFlow', { id: 'Bad', sourceRef: start, targetRef: inner });
    addTo(process, 'flowElements', flow);
    addTo(start, 'outgoing', flow);
    addTo(inner, 'incoming', flow);
    doc.invalidate();
    const f = findingsOf(doc, 'E_CROSS_SCOPE');
    expect(f).toHaveLength(1);
    expect(f[0]!.element).toBe('Bad');
    expect(f[0]!.hint).toMatch(/message flow|move/);
  });

  it('E_CROSS_SCOPE when a flow is declared in the wrong scope', async () => {
    const doc = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'subProcess', id: 'Sub', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }]) },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Sub' },
          { id: 'F2', from: 'Sub', to: 'End' },
        ],
      ),
    );
    const sub = doc.require('Sub');
    const inner = doc.require('I1');
    removeFrom(sub, 'flowElements', inner);
    addTo(doc.processes()[0]!, 'flowElements', inner);
    doc.invalidate();
    const f = findingsOf(doc, 'E_CROSS_SCOPE');
    expect(f.map((x) => x.element)).toEqual(['I1']);
  });

  it('missing incoming/outgoing entries are repaired, not reported (they are optional in BPMN 2.0)', async () => {
    const doc = await docFromXml(
      definitionsXml(`
        <bpmn:startEvent id="Start" />
        <bpmn:task id="A"><bpmn:incoming>F1</bpmn:incoming></bpmn:task>
        <bpmn:endEvent id="End" />
        <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="A" />
        <bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="End" />`),
    );
    expect(doc.outgoing(doc.require('Start'))).toEqual([]);
    expect(codes(doc)).toEqual({ errors: [], warnings: [] });
    const id = (el: { get: <T>(k: string) => T }) => el.get<string>('id');
    expect(doc.outgoing(doc.require('Start')).map(id)).toEqual(['F1']);
    expect(doc.incoming(doc.require('A')).map(id)).toEqual(['F1']);
    expect(doc.outgoing(doc.require('A')).map(id)).toEqual(['F2']);
    expect(doc.incoming(doc.require('End')).map(id)).toEqual(['F2']);
    expect(repairFlowLinks(doc)).toBe(0); // idempotent
    const order = flowOrder(doc, doc.processes()[0]!);
    expect(order.ordered.map(id)).toEqual(['Start', 'A', 'End']);
    expect(order.unreachable.size).toBe(0);
    expect(await doc.toXml()).toMatch(/<bpmn:startEvent id="Start">\s*<bpmn:outgoing>F1<\/bpmn:outgoing>/);
  });

  it('E_FLOW_LINKS when a node lists a flow that does not touch it', async () => {
    const clean = await linearDoc();
    addTo(clean.require('End'), 'incoming', clean.require('F1'));
    const f = findingsOf(clean, 'E_FLOW_LINKS');
    expect(f.map((x) => [x.element, x.related])).toEqual([['End', ['F1']]]);
    expect(f[0]!.hint).toContain('<bpmn:incoming>F1</bpmn:incoming>');
    const out = await linearDoc();
    addTo(out.require('Start'), 'outgoing', out.require('F2'));
    expect(findingsOf(out, 'E_FLOW_LINKS').map((x) => x.element)).toEqual(['Start']);
  });

  it('E_INVALID_SOURCE / E_INVALID_TARGET: compensate boundary events and compensation handlers have no sequence flows', async () => {
    const nodes: N[] = [
      { tag: 'startEvent', id: 'Start' },
      { tag: 'task', id: 'A' },
      { tag: 'boundaryEvent', id: 'Comp', attrs: 'attachedToRef="A"', inner: '<bpmn:compensateEventDefinition />' },
      { tag: 'task', id: 'Handler', attrs: 'isForCompensation="true"' },
      { tag: 'endEvent', id: 'End' },
    ];
    const main: F[] = [
      { id: 'F1', from: 'Start', to: 'A' },
      { id: 'F2', from: 'A', to: 'End' },
    ];
    const bad = await processDoc(body(nodes, [...main, { id: 'F3', from: 'Comp', to: 'Handler' }, { id: 'F4', from: 'Handler', to: 'End' }]));
    const r = validateDoc(bad);
    expect(r.errors.every((e) => e.code === 'E_INVALID_SOURCE' || e.code === 'E_INVALID_TARGET')).toBe(true);
    const fromBoundary = r.errors.find((e) => e.element === 'F3' && e.code === 'E_INVALID_SOURCE')!;
    expect(fromBoundary.message).toMatch(/Compensate boundary event Comp/);
    expect(fromBoundary.related).toEqual(['Comp', 'Handler']);
    expect(fromBoundary.hint).toContain('bpmn remove <file> F3');
    expect(fromBoundary.hint).toContain('bpmn connect <file> Comp Handler');
    expect(r.errors.some((e) => e.element === 'F4' && e.code === 'E_INVALID_SOURCE' && /Compensation handler/.test(e.message))).toBe(true);
    expect(codes(bad).warnings).not.toContain('W_DEAD_END'); // the handler is no dead end either way
    // the handler linked by a compensation association: clean
    const ok = await processDoc(body(nodes, main, '<bpmn:association id="As" associationDirection="One" sourceRef="Comp" targetRef="Handler" />'));
    expect(codes(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('E_NO_HOST / E_INVALID_HOST for boundary events', async () => {
    const noHost = await processDoc(chain([{ tag: 'task', id: 'A' }], `<bpmn:boundaryEvent id="B" >${timerDef}</bpmn:boundaryEvent>`));
    expect(findingsOf(noHost, 'E_NO_HOST').map((x) => x.element)).toEqual(['B']);

    const ok = await processDoc(chain([{ tag: 'task', id: 'A' }], `<bpmn:boundaryEvent id="B" attachedToRef="A">${timerDef}</bpmn:boundaryEvent>`));
    expect(codes(ok).errors).toEqual([]);

    const crossScope = await processDoc(
      chain(
        [{ tag: 'subProcess', id: 'Sub', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'task', id: 'Inner' }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'Inner' }, { id: 'I2', from: 'Inner', to: 'E2' }]) }],
        `<bpmn:boundaryEvent id="B" attachedToRef="Inner">${timerDef}</bpmn:boundaryEvent>`,
      ),
    );
    const f = findingsOf(crossScope, 'E_INVALID_HOST');
    expect(f.map((x) => [x.element, x.related])).toEqual([['B', ['Inner']]]);

    const onGateway = await processDoc(chain([{ tag: 'exclusiveGateway', id: 'Gw' }], `<bpmn:boundaryEvent id="B" attachedToRef="Gw">${timerDef}</bpmn:boundaryEvent>`));
    expect(findingsOf(onGateway, 'E_INVALID_HOST').map((x) => x.element)).toEqual(['B']);
  });

  it('E_INVALID_TRIGGER: trigger matrix', async () => {
    const bad = await processDoc(body([{ tag: 'startEvent', id: 'Start', inner: terminateDef }, { tag: 'endEvent', id: 'End', inner: timerDef }], [{ id: 'F1', from: 'Start', to: 'End' }]));
    expect(findingsOf(bad, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['Start', 'End']);
    const ok = await processDoc(body([{ tag: 'startEvent', id: 'Start', inner: timerDef }, { tag: 'endEvent', id: 'End', inner: terminateDef }], [{ id: 'F1', from: 'Start', to: 'End' }]));
    expect(codes(ok).errors).toEqual([]);
  });

  it('E_INVALID_TRIGGER: error/escalation/compensate starts only in event sub-processes', async () => {
    const bad = await processDoc(body([{ tag: 'startEvent', id: 'Start', inner: errorDef }, { tag: 'endEvent', id: 'End' }], [{ id: 'F1', from: 'Start', to: 'End' }]));
    expect(findingsOf(bad, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['Start']);
    const ok = await processDoc(
      chain([], `<bpmn:subProcess id="Sub" triggeredByEvent="true">${body([{ tag: 'startEvent', id: 'S2', inner: errorDef }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }])}</bpmn:subProcess>`),
    );
    expect(codes(ok).errors).toEqual([]);
  });

  it('E_INVALID_TRIGGER: triggered or non-interrupting starts inside embedded sub-processes', async () => {
    const triggered = await processDoc(chain([{ tag: 'subProcess', id: 'Sub', inner: body([{ tag: 'startEvent', id: 'S2', inner: timerDef }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }]) }]));
    expect(findingsOf(triggered, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['S2']);
    const nonInterrupting = await processDoc(body([{ tag: 'startEvent', id: 'Start', attrs: 'isInterrupting="false"', inner: messageDef }, { tag: 'endEvent', id: 'End' }], [{ id: 'F1', from: 'Start', to: 'End' }]));
    expect(findingsOf(nonInterrupting, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['Start']);
  });

  it('E_INVALID_TRIGGER: non-interrupting error/cancel/compensate boundary events', async () => {
    const bad = await processDoc(chain([{ tag: 'task', id: 'A' }], `<bpmn:boundaryEvent id="B" attachedToRef="A" cancelActivity="false">${errorDef}</bpmn:boundaryEvent>`));
    expect(findingsOf(bad, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['B']);
    const ok = await processDoc(chain([{ tag: 'task', id: 'A' }], `<bpmn:boundaryEvent id="B" attachedToRef="A" cancelActivity="false">${messageDef}</bpmn:boundaryEvent>`));
    expect(codes(ok).errors).toEqual([]);
  });

  it('E_INVALID_TRIGGER: cancel events only with transactions', async () => {
    const badEnd = await processDoc(body([{ tag: 'startEvent', id: 'Start' }, { tag: 'endEvent', id: 'End', inner: cancelDef }], [{ id: 'F1', from: 'Start', to: 'End' }]));
    expect(findingsOf(badEnd, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['End']);
    const badBoundary = await processDoc(chain([{ tag: 'task', id: 'A' }], `<bpmn:boundaryEvent id="B" attachedToRef="A">${cancelDef}</bpmn:boundaryEvent>`));
    expect(findingsOf(badBoundary, 'E_INVALID_TRIGGER').map((x) => x.element)).toEqual(['B']);
    const ok = await processDoc(
      chain(
        [{ tag: 'transaction', id: 'Tx', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'endEvent', id: 'E2', inner: cancelDef }], [{ id: 'I1', from: 'S2', to: 'E2' }]) }],
        `<bpmn:boundaryEvent id="B" attachedToRef="Tx">${cancelDef}</bpmn:boundaryEvent>`,
      ),
    );
    expect(codes(ok).errors).toEqual([]);
  });

  it('E_INVALID_DEFAULT', async () => {
    const notOutgoing = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'exclusiveGateway', id: 'Gw', attrs: 'name="Ok?" default="F1"' },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Gw' },
          { id: 'F2', from: 'Gw', to: 'End', attrs: 'name="yes"' },
        ],
      ),
    );
    expect(findingsOf(notOutgoing, 'E_INVALID_DEFAULT').map((x) => [x.element, x.related])).toEqual([['Gw', ['F1']]]);
    const ok = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'exclusiveGateway', id: 'Gw', attrs: 'name="Ok?" default="F2"' },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Gw' },
          { id: 'F2', from: 'Gw', to: 'End', attrs: 'name="yes"' },
        ],
      ),
    );
    expect(codes(ok).errors).toEqual([]);
  });

  it('E_EVENT_SUBPROCESS_NO_START / E_EVENT_SUBPROCESS_PLAIN_START', async () => {
    const noStart = await processDoc(chain([], '<bpmn:subProcess id="Sub" triggeredByEvent="true"><bpmn:task id="T" /></bpmn:subProcess>'));
    expect(findingsOf(noStart, 'E_EVENT_SUBPROCESS_NO_START').map((x) => x.element)).toEqual(['Sub']);
    const plain = await processDoc(chain([], `<bpmn:subProcess id="Sub" triggeredByEvent="true">${body([{ tag: 'startEvent', id: 'S2' }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }])}</bpmn:subProcess>`));
    expect(findingsOf(plain, 'E_EVENT_SUBPROCESS_PLAIN_START').map((x) => x.element)).toEqual(['S2']);
    const ok = await processDoc(chain([], `<bpmn:subProcess id="Sub" triggeredByEvent="true">${body([{ tag: 'startEvent', id: 'S2', inner: timerDef }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }])}</bpmn:subProcess>`));
    expect(codes(ok).errors).toEqual([]);
  });

  it('E_LANE_CONFLICT / E_INVALID_LANE_MEMBER', async () => {
    const conflict = await processDoc(
      chain(
        [{ tag: 'task', id: 'A' }],
        `<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`,
      ),
    );
    expect(findingsOf(conflict, 'E_LANE_CONFLICT').map((x) => [x.element, x.related])).toEqual([['A', ['L1', 'L2']]]);
    const badMember = await processDoc(
      chain(
        [{ tag: 'subProcess', id: 'Sub', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }]) }],
        `<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>Sub</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef><bpmn:flowNodeRef>S2</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`,
      ),
    );
    expect(findingsOf(badMember, 'E_INVALID_LANE_MEMBER').map((x) => [x.element, x.related])).toEqual([['L1', ['S2']]]);
    const ok = await processDoc(
      chain([{ tag: 'task', id: 'A' }], `<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`),
    );
    expect(codes(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('E_INVALID_MESSAGE_FLOW / E_MESSAGE_FLOW_SAME_POOL', async () => {
    const collab = (flows: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${BPMN_NS}" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C">
    <bpmn:participant id="P1" processRef="Process_1" />
    <bpmn:participant id="P2" />
    ${flows}
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    ${chain([{ tag: 'exclusiveGateway', id: 'Gw' }, { tag: 'task', id: 'A' }, { tag: 'task', id: 'B' }])}
  </bpmn:process>
</bpmn:definitions>`;
    const ok = await docFromXml(collab('<bpmn:messageFlow id="M1" sourceRef="A" targetRef="P2" /><bpmn:messageFlow id="M2" sourceRef="P2" targetRef="B" />'));
    expect(codes(ok).errors).toEqual([]);
    const fromGateway = await docFromXml(collab('<bpmn:messageFlow id="M1" sourceRef="Gw" targetRef="P2" />'));
    expect(findingsOf(fromGateway, 'E_INVALID_MESSAGE_FLOW').map((x) => [x.element, x.related])).toEqual([['M1', ['Gw']]]);
    const samePool = await docFromXml(collab('<bpmn:messageFlow id="M1" sourceRef="A" targetRef="B" /><bpmn:messageFlow id="M2" sourceRef="A" targetRef="P1" />'));
    expect(findingsOf(samePool, 'E_MESSAGE_FLOW_SAME_POOL').map((x) => x.element)).toEqual(['M1', 'M2']);
  });
});

/* ------------------------------------------------------------------ */
/* lint warnings                                                        */
/* ------------------------------------------------------------------ */

describe('lint warnings', () => {
  it('W_NO_START / W_NO_END', async () => {
    const doc = await processDoc(body([{ tag: 'task', id: 'A' }]));
    expect(codes(doc).warnings).toEqual(expect.arrayContaining(['W_NO_START', 'W_NO_END']));
    const empty = await processDoc('');
    expect(codes(empty).warnings).toEqual(['W_NO_START', 'W_NO_END']);
    expect(codes(await linearDoc()).warnings).toEqual([]);
    // sub-processes with nodes get the same check; event sub-processes are not asked for a start
    const sub = await processDoc(chain([{ tag: 'subProcess', id: 'Sub', inner: '<bpmn:task id="T" />' }]));
    expect(findingsOf(sub, 'W_NO_START').map((x) => x.element)).toEqual(['Sub']);
  });

  it('W_UNREACHABLE', async () => {
    const doc = await processDoc(chain([], '<bpmn:task id="Lonely" />'));
    const f = findingsOf(doc, 'W_UNREACHABLE');
    expect(f.map((x) => x.element)).toEqual(['Lonely']);
    expect(f[0]!.hint).toContain('bpmn connect');
    // without any start event, nodes without incoming are entry points
    const noStart = await processDoc(body([{ tag: 'task', id: 'A' }, { tag: 'endEvent', id: 'End' }], [{ id: 'F1', from: 'A', to: 'End' }]));
    expect(codes(noStart).warnings).not.toContain('W_UNREACHABLE');
    // compensation handlers and event sub-processes are exempt
    const exempt = await processDoc(
      chain([], `<bpmn:task id="Comp" isForCompensation="true" /><bpmn:subProcess id="Sub" triggeredByEvent="true">${body([{ tag: 'startEvent', id: 'S2', inner: timerDef }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }])}</bpmn:subProcess>`),
    );
    expect(codes(exempt).warnings).not.toContain('W_UNREACHABLE');
  });

  it('flowOrder lists reachable nodes first and follows boundary flows', async () => {
    const doc = await processDoc(
      body(
        [
          { tag: 'task', id: 'Old' },
          { tag: 'startEvent', id: 'Start' },
          { tag: 'task', id: 'A' },
          { tag: 'boundaryEvent', id: 'B', attrs: 'attachedToRef="A"', inner: timerDef },
          { tag: 'endEvent', id: 'End' },
          { tag: 'endEvent', id: 'Late' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'A' },
          { id: 'F2', from: 'A', to: 'End' },
          { id: 'F3', from: 'B', to: 'Late' },
        ],
      ),
    );
    const order = flowOrder(doc, doc.processes()[0]!);
    expect(order.ordered.map((n) => n.get<string>('id'))).toEqual(['Start', 'A', 'End', 'Late', 'Old']);
    expect([...order.unreachable].map((n) => n.get<string>('id'))).toEqual(['Old']);
  });

  it('W_DEAD_END', async () => {
    const doc = await processDoc(body([{ tag: 'startEvent', id: 'Start' }, { tag: 'task', id: 'A' }], [{ id: 'F1', from: 'Start', to: 'A' }]));
    expect(findingsOf(doc, 'W_DEAD_END').map((x) => x.element)).toEqual(['A']);
    // end events, link throws, compensation handlers and compensate boundary events are exempt
    const exempt = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'task', id: 'A' },
          { tag: 'boundaryEvent', id: 'Comp', attrs: 'attachedToRef="A"', inner: '<bpmn:compensateEventDefinition />' },
          { tag: 'intermediateThrowEvent', id: 'Link', inner: '<bpmn:linkEventDefinition name="L" />' },
          { tag: 'task', id: 'Handler', attrs: 'isForCompensation="true"' },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'A' },
          { id: 'F2', from: 'A', to: 'Link' },
          { id: 'F3', from: 'A', to: 'End' },
        ],
      ),
    );
    expect(codes(exempt).warnings).not.toContain('W_DEAD_END');
  });

  it('link catch events are reached through the throwing link with the same name', async () => {
    const link = (name: string) => `<bpmn:linkEventDefinition name="${name}" />`;
    const doc = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'task', id: 'A' },
          { tag: 'intermediateThrowEvent', id: 'Throw', inner: link('L1') },
          { tag: 'intermediateCatchEvent', id: 'Lonely', inner: link('L2') },
          { tag: 'intermediateCatchEvent', id: 'Catch', inner: link('L1') },
          { tag: 'task', id: 'B' },
          { tag: 'endEvent', id: 'End' },
          { tag: 'endEvent', id: 'End2' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'A' },
          { id: 'F2', from: 'A', to: 'Throw' },
          { id: 'F3', from: 'Catch', to: 'B' },
          { id: 'F4', from: 'B', to: 'End' },
          { id: 'F5', from: 'Lonely', to: 'End2' },
        ],
      ),
    );
    const order = flowOrder(doc, doc.processes()[0]!);
    expect(order.ordered.map((n) => n.get<string>('id'))).toEqual(['Start', 'A', 'Throw', 'Catch', 'B', 'End', 'Lonely', 'End2']);
    expect([...order.unreachable].map((n) => n.get<string>('id'))).toEqual(['Lonely', 'End2']);
    const f = findingsOf(doc, 'W_UNREACHABLE');
    expect(f.map((x) => x.element)).toEqual(['Lonely', 'End2']);
    expect(f[0]!.message).toContain('no throwing link event "L2"');
    expect(f[1]!.hint).toContain('bpmn connect <file> <fromId> End2');
    expect(f[0]!.hint).toContain('intermediateThrowEvent:link');
    expect(f[0]!.hint).toContain('--link L2');
    expect(codes(doc).warnings).toEqual(['W_UNREACHABLE', 'W_UNREACHABLE']);
  });

  it('ad-hoc sub-processes need neither start/end events nor sequence flows', async () => {
    const inner = '<bpmn:task id="T1" /><bpmn:task id="T2" />';
    const adHoc = await processDoc(chain([{ tag: 'adHocSubProcess', id: 'AdHoc', inner }]));
    expect(codes(adHoc)).toEqual({ errors: [], warnings: [] });
    const order = flowOrder(adHoc, adHoc.require('AdHoc'));
    expect(order.ordered.map((n) => n.get<string>('id'))).toEqual(['T1', 'T2']);
    expect(order.unreachable.size).toBe(0);
    // an ordinary sub-process with the same content is asked for start/end events and flows
    const plain = await processDoc(chain([{ tag: 'subProcess', id: 'Sub', inner }]));
    expect(codes(plain).warnings).toEqual(expect.arrayContaining(['W_NO_START', 'W_NO_END', 'W_DEAD_END']));
    // an empty ad-hoc sub-process is still reported as empty
    const empty = await processDoc(chain([{ tag: 'adHocSubProcess', id: 'AdHoc' }]));
    expect(codes(empty).warnings).toEqual(['W_EMPTY_SUBPROCESS']);
  });

  it('W_GATEWAY_NAME / W_BRANCH_NAME', async () => {
    const split = (attrs: string, yes: string, no: string) =>
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'exclusiveGateway', id: 'Gw', attrs },
          { tag: 'endEvent', id: 'End1' },
          { tag: 'endEvent', id: 'End2' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Gw' },
          { id: 'F2', from: 'Gw', to: 'End1', attrs: yes },
          { id: 'F3', from: 'Gw', to: 'End2', attrs: no },
        ],
      );
    const bad = await processDoc(split('name="Check"', '', 'name="no"'));
    expect(findingsOf(bad, 'W_GATEWAY_NAME').map((x) => x.element)).toEqual(['Gw']);
    expect(findingsOf(bad, 'W_BRANCH_NAME').map((x) => [x.element, x.related])).toEqual([['Gw', ['F2']]]);
    const unnamed = await processDoc(split('', 'name="yes"', 'name="no"'));
    expect(findingsOf(unnamed, 'W_GATEWAY_NAME')).toHaveLength(1);
    const ok = await processDoc(split('name="Invoice ok?"', 'name="yes"', 'name="no"'));
    expect(codes(ok).warnings).toEqual([]);
  });

  it('W_NAMED_JOIN / W_NAMED_PARALLEL', async () => {
    const twoIn = (tag: string, attrs: string) =>
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'parallelGateway', id: 'Fork' },
          { tag: 'task', id: 'A' },
          { tag: 'task', id: 'B' },
          { tag, id: 'Join', attrs },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Fork' },
          { id: 'F2', from: 'Fork', to: 'A' },
          { id: 'F3', from: 'Fork', to: 'B' },
          { id: 'F4', from: 'A', to: 'Join' },
          { id: 'F5', from: 'B', to: 'Join' },
          { id: 'F6', from: 'Join', to: 'End' },
        ],
      );
    const namedJoin = await processDoc(twoIn('inclusiveGateway', 'name="Merge"'));
    expect(findingsOf(namedJoin, 'W_NAMED_JOIN').map((x) => x.element)).toEqual(['Join']);
    const namedParallel = await processDoc(twoIn('parallelGateway', 'name="Both done"'));
    expect(findingsOf(namedParallel, 'W_NAMED_PARALLEL').map((x) => x.element)).toEqual(['Join']);
    const ok = await processDoc(twoIn('parallelGateway', ''));
    expect(codes(ok).warnings).toEqual([]);
  });

  it('W_NOT_IN_LANE', async () => {
    const doc = await processDoc(chain([{ tag: 'task', id: 'A' }], '<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>'));
    expect(findingsOf(doc, 'W_NOT_IN_LANE').map((x) => x.element)).toEqual(['A']);
    expect(codes(await linearDoc()).warnings).not.toContain('W_NOT_IN_LANE');
  });

  it('W_IMPLICIT_SPLIT / W_IMPLICIT_JOIN', async () => {
    const doc = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'task', id: 'A' },
          { tag: 'task', id: 'B' },
          { tag: 'task', id: 'C' },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'A' },
          { id: 'F2', from: 'A', to: 'B' },
          { id: 'F3', from: 'A', to: 'C' },
          { id: 'F4', from: 'B', to: 'End' },
          { id: 'F5', from: 'C', to: 'End' },
        ],
      ),
    );
    expect(findingsOf(doc, 'W_IMPLICIT_SPLIT').map((x) => [x.element, x.related])).toEqual([['A', ['F2', 'F3']]]);
    expect(findingsOf(doc, 'W_IMPLICIT_JOIN').map((x) => [x.element, x.related])).toEqual([['End', ['F4', 'F5']]]);
  });

  it('W_EVENT_GATEWAY_TARGET', async () => {
    const gw = (targets: N[]) =>
      body(
        [{ tag: 'startEvent', id: 'Start' }, { tag: 'eventBasedGateway', id: 'Gw' }, ...targets, { tag: 'endEvent', id: 'End' }],
        [
          { id: 'F1', from: 'Start', to: 'Gw' },
          ...targets.map((t, i) => ({ id: `G${i}`, from: 'Gw', to: t.id })),
          ...targets.map((t, i) => ({ id: `E${i}`, from: t.id, to: 'End' })),
        ],
      );
    const bad = await processDoc(gw([{ tag: 'intermediateCatchEvent', id: 'Msg', inner: messageDef }, { tag: 'task', id: 'T' }]));
    expect(findingsOf(bad, 'W_EVENT_GATEWAY_TARGET').map((x) => [x.element, x.related])).toEqual([['Gw', ['T']]]);
    const ok = await processDoc(gw([{ tag: 'intermediateCatchEvent', id: 'Msg', inner: messageDef }, { tag: 'receiveTask', id: 'R' }, { tag: 'intermediateCatchEvent', id: 'Tm', inner: timerDef }]));
    expect(findingsOf(ok, 'W_EVENT_GATEWAY_TARGET')).toEqual([]);
  });

  it('W_EMPTY_SUBPROCESS', async () => {
    const doc = await processDoc(chain([{ tag: 'subProcess', id: 'Sub' }]));
    expect(findingsOf(doc, 'W_EMPTY_SUBPROCESS').map((x) => x.element)).toEqual(['Sub']);
    expect(codes(doc).warnings).not.toContain('W_NO_START');
    const ok = await processDoc(chain([{ tag: 'subProcess', id: 'Sub', inner: body([{ tag: 'startEvent', id: 'S2' }, { tag: 'endEvent', id: 'E2' }], [{ id: 'I1', from: 'S2', to: 'E2' }]) }]));
    expect(codes(ok).warnings).toEqual([]);
  });

  it('W_DUPLICATE_NAME', async () => {
    const dup = await processDoc(chain([{ tag: 'userTask', id: 'A', attrs: 'name="Do it"' }, { tag: 'userTask', id: 'B', attrs: 'name="Do it"' }]));
    expect(findingsOf(dup, 'W_DUPLICATE_NAME').map((x) => [x.element, x.related])).toEqual([['A', ['B']]]);
    const differentKinds = await processDoc(chain([{ tag: 'userTask', id: 'A', attrs: 'name="Do it"' }, { tag: 'serviceTask', id: 'B', attrs: 'name="Do it"' }]));
    expect(codes(differentKinds).warnings).toEqual([]);
    // branch names may repeat
    const branches = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'exclusiveGateway', id: 'G1', attrs: 'name="A?"' },
          { tag: 'exclusiveGateway', id: 'G2', attrs: 'name="B?"' },
          { tag: 'endEvent', id: 'End1' },
          { tag: 'endEvent', id: 'End2' },
          { tag: 'endEvent', id: 'End3' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'G1' },
          { id: 'F2', from: 'G1', to: 'G2', attrs: 'name="yes"' },
          { id: 'F3', from: 'G1', to: 'End1', attrs: 'name="no"' },
          { id: 'F4', from: 'G2', to: 'End2', attrs: 'name="yes"' },
          { id: 'F5', from: 'G2', to: 'End3', attrs: 'name="no"' },
        ],
      ),
    );
    expect(codes(branches).warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* hints                                                                */
/* ------------------------------------------------------------------ */

describe('hints', () => {
  const FILE_COMMANDS = ['add', 'set', 'remove', 'connect', 'move', 'retype', 'apply', 'layout', 'validate', 'show', 'find', 'order', 'ext'];

  async function fixtures(): Promise<Doc[]> {
    const gw = (attrs: string, yes: string, no: string) =>
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'exclusiveGateway', id: 'Gw', attrs },
          { tag: 'task', id: 'A' },
          { tag: 'endEvent', id: 'End1' },
          { tag: 'endEvent', id: 'End2' },
          { tag: 'parallelGateway', id: 'Join', attrs: 'name="Both"' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'Gw' },
          { id: 'F2', from: 'Gw', to: 'End1', attrs: yes },
          { id: 'F3', from: 'Gw', to: 'A', attrs: no },
          { id: 'F4', from: 'A', to: 'End2' },
          { id: 'F5', from: 'A', to: 'Join' },
          { id: 'F6', from: 'Join', to: 'End2' },
          { id: 'F7', from: 'Start', to: 'Start' },
        ],
      );
    return Promise.all([
      processDoc(''),
      processDoc(body([{ tag: 'task', id: 'Lonely' }])),
      processDoc(chain([], '<bpmn:task id="Lonely" /><bpmn:subProcess id="Empty" /><bpmn:intermediateCatchEvent id="LinkCatch"><bpmn:linkEventDefinition name="L" /></bpmn:intermediateCatchEvent>')),
      processDoc(gw('name="Check"', '', 'name="no"')),
      processDoc(chain([]), { extraRoots: '<bpmn:process id="Process_2" />' }),
      processDoc(chain([]), { extraRoots: '<bpmn:collaboration id="C"><bpmn:participant id="P1" /></bpmn:collaboration>' }),
      processDoc(chain([{ tag: 'complexGateway', id: 'Cg' }], '<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>')),
      processDoc(body([{ tag: 'startEvent', id: 'Start', inner: terminateDef }, { tag: 'endEvent', id: 'End', inner: cancelDef }, { tag: 'task', id: 'A' }, { tag: 'boundaryEvent', id: 'B', attrs: 'attachedToRef="A" cancelActivity="false"', inner: errorDef }, { tag: 'boundaryEvent', id: 'C', inner: timerDef }, { tag: 'exclusiveGateway', id: 'Gw', attrs: 'default="F1"' }], [{ id: 'F1', from: 'Start', to: 'End' }, { id: 'F2', from: 'A', to: 'End' }, { id: 'F3', from: 'Gw', to: 'A' }])),
      processDoc(chain([], '<bpmn:subProcess id="Sub" triggeredByEvent="true"><bpmn:task id="T" /></bpmn:subProcess><bpmn:subProcess id="Sub2" triggeredByEvent="true"><bpmn:startEvent id="S2" /></bpmn:subProcess>')),
      processDoc(body([{ tag: 'startEvent', id: 'Start' }, { tag: 'task', id: 'A' }, { tag: 'boundaryEvent', id: 'Comp', attrs: 'attachedToRef="A"', inner: '<bpmn:compensateEventDefinition />' }, { tag: 'task', id: 'H', attrs: 'isForCompensation="true"' }, { tag: 'endEvent', id: 'End' }], [{ id: 'F1', from: 'Start', to: 'A' }, { id: 'F2', from: 'A', to: 'End' }, { id: 'F3', from: 'Comp', to: 'H' }])),
      processDoc(chain([{ tag: 'userTask', id: 'A', attrs: 'name="Do it"' }, { tag: 'userTask', id: 'B', attrs: 'name="Do it"' }])),
    ]);
  }

  it('name real command lines: `bpmn <cmd> <file> ...`, no --name on add, no `bpmn split`', async () => {
    const seen = new Set<string>();
    const hints: Array<[string, string]> = [];
    for (const doc of await fixtures()) {
      const r = validateDoc(doc);
      for (const f of [...r.errors, ...r.warnings]) {
        seen.add(f.code);
        if (f.hint) hints.push([f.code, f.hint]);
      }
    }
    expect([...seen]).toEqual(
      expect.arrayContaining(['W_NO_START', 'W_NO_END', 'W_UNREACHABLE', 'W_DEAD_END', 'W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN', 'W_EMPTY_SUBPROCESS', 'W_GATEWAY_NAME', 'W_BRANCH_NAME', 'W_NAMED_PARALLEL', 'W_NOT_IN_LANE', 'W_DUPLICATE_NAME', 'E_MULTIPLE_ROOTS', 'E_EMPTY_COLLABORATION', 'E_ORPHAN_PROCESS', 'E_INVALID_TRIGGER', 'E_INVALID_DEFAULT', 'E_NO_HOST', 'E_LANE_CONFLICT', 'E_UNSUPPORTED_KIND', 'E_EVENT_SUBPROCESS_NO_START', 'E_EVENT_SUBPROCESS_PLAIN_START', 'E_INVALID_SOURCE', 'E_INVALID_TARGET']),
    );
    expect(hints.length).toBeGreaterThan(20);
    for (const [code, hint] of hints) {
      const commands = [...hint.matchAll(/`bpmn (\w+)([^`]*)`/g)];
      for (const m of commands) {
        const cmd = m[1]!;
        const rest = m[2]!;
        expect(cmd, `${code}: ${hint}`).not.toBe('split');
        if (FILE_COMMANDS.includes(cmd)) expect(rest, `${code}: ${hint}`).toMatch(/^ <file>/);
        if (cmd === 'add') expect(rest, `${code}: ${hint}`).not.toMatch(/--name/);
      }
    }
  });

  it('W_NO_START / W_NO_END / E_ORPHAN_PROCESS hints use the positional name of `bpmn add`', async () => {
    const doc = await processDoc('');
    const [noStart, noEnd] = validateDoc(doc).warnings;
    expect(noStart!.hint).toContain('`bpmn add <file> startEvent "<Name>" --in Process_1`');
    expect(noEnd!.hint).toContain('`bpmn add <file> endEvent "<Name>" --after <nodeId>`');
    const orphan = await processDoc(chain([]), { extraRoots: '<bpmn:collaboration id="C"><bpmn:participant id="P1" /></bpmn:collaboration>' });
    expect(findingsOf(orphan, 'E_ORPHAN_PROCESS')[0]!.hint).toContain('`bpmn add <file> participant "<Name>" --process Process_1`');
    expect(findingsOf(orphan, 'E_EMPTY_COLLABORATION')[0]!.hint).toContain('`bpmn add <file> participant "<Name>" --process <processId>`');
  });

  it('W_IMPLICIT_SPLIT / W_IMPLICIT_JOIN hints name the flows to insert into and to redirect', async () => {
    const doc = await processDoc(
      body(
        [
          { tag: 'startEvent', id: 'Start' },
          { tag: 'task', id: 'A' },
          { tag: 'task', id: 'B' },
          { tag: 'task', id: 'C' },
          { tag: 'endEvent', id: 'End' },
        ],
        [
          { id: 'F1', from: 'Start', to: 'A' },
          { id: 'F2', from: 'A', to: 'B' },
          { id: 'F3', from: 'A', to: 'C' },
          { id: 'F4', from: 'B', to: 'End' },
          { id: 'F5', from: 'C', to: 'End' },
        ],
      ),
    );
    const split = findingsOf(doc, 'W_IMPLICIT_SPLIT')[0]!;
    expect(split.hint).toContain('`bpmn add <file> parallelGateway --flow F2`');
    expect(split.hint).toContain('`bpmn set <file> F3 source=<gatewayId>`');
    const join = findingsOf(doc, 'W_IMPLICIT_JOIN')[0]!;
    expect(join.hint).toContain('`bpmn add <file> exclusiveGateway --flow F4`');
    expect(join.hint).toContain('`bpmn set <file> F5 target=<gatewayId>`');
    expect(join.hint).not.toContain('--before');
  });
});
