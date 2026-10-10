/**
 * Step 3: audit bugs of the incremental layout fixed with the layout
 * ergonomics package (docs/audit-2026-10.md):
 *  - #41 a data object or annotation drawn in a lane follows the lane when
 *    the space tool moves it (it has no lane membership of its own)
 *  - #42 closing a strip inside a sub-process never puts a boundary event
 *    riding the shrinking border onto a shape outside the sub-process
 *  - #77 a splice pushes the rest of the pool only by the room that is
 *    missing, not by a whole column, when part of the room is free
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { readPlanes, semantics, type DShape } from '../src/diagram/plane.js';
import { makeSpace } from '../src/diagram/space.js';
import { mutateDoc } from '../src/pipeline.js';

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
const sh = (id: string, x: number, y: number, w: number, h: number, extra = ''): string => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
const ed = (id: string, pts: Array<[number, number]>): string => `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`;
const defs = (process: string, di: string, extraRoots = '', root = 'P'): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions ${NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">\n${process}\n${extraRoots}\n<bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="${root}">${di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>`;

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const p of readPlanes(doc.definitions)) for (const s of p.shapes.values()) out.set(s.id, s);
  return out;
}

describe('#41 shapes no lane lists follow the lane they are drawn in', () => {
  it('a space run whose band misses the data object still moves it with its lane', async () => {
    const process = `<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2"><bpmn:flowNodeRef>B</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
      <bpmn:task id="A" name="A" /><bpmn:task id="B" name="B" /><bpmn:dataObjectReference id="Data" dataObjectRef="DO" /><bpmn:dataObject id="DO" /></bpmn:process>`;
    const xml = defs(process, `${sh('Pool', 0, 0, 800, 300, ' isHorizontal="true"')}${sh('L1', 30, 0, 770, 150, ' isHorizontal="true"')}${sh('L2', 30, 150, 770, 150, ' isHorizontal="true"')}${sh('A', 100, 40, 100, 80)}${sh('B', 100, 190, 100, 80)}${sh('Data', 600, 200, 36, 50)}`, '<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>', 'C');
    const doc = await Doc.fromXml(xml);
    expect(doc.importWarnings).toEqual([]);
    const plane = readPlanes(doc.definitions, semantics(doc.definitions))[0]!;
    // room below A, in the band of A's column only (like a growing sub-process makes it): L2 lies beyond the line and moves
    makeSpace(plane, { axis: 'y', line: 140, delta: 100, within: { x: 90, y: 0, width: 120, height: 300 } });
    expect(plane.shapes.get('L2')!.bounds.y).toBe(250);
    expect(plane.shapes.get('B')!.bounds.y).toBe(290);
    expect(plane.shapes.get('Data')!.bounds.y).toBe(300);
  });
});

describe('#42 closing a strip never puts a boundary event onto a shape', () => {
  it('removing a node in a sub-process keeps the strip open when its boundary event would land on an annotation', async () => {
    const process = `<bpmn:process id="P">
      <bpmn:startEvent id="S"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
      <bpmn:subProcess id="Sub" name="Sub"><bpmn:incoming>F0</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing>
        <bpmn:startEvent id="SS"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:task id="A" name="A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
        <bpmn:task id="B" name="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
        <bpmn:endEvent id="SE"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="F1" sourceRef="SS" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" /><bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="SE" />
      </bpmn:subProcess>
      <bpmn:boundaryEvent id="T" name="Late" attachedToRef="Sub"><bpmn:timerEventDefinition id="TD" /></bpmn:boundaryEvent>
      <bpmn:endEvent id="E"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="Sub" /><bpmn:sequenceFlow id="F4" sourceRef="Sub" targetRef="E" />
      <bpmn:textAnnotation id="Note"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation>
    </bpmn:process>`;
    const di = [
      sh('S', 100, 182, 36, 36),
      sh('Sub', 200, 100, 640, 200, ' isExpanded="true"'),
      sh('SS', 230, 182, 36, 36),
      sh('A', 320, 160, 100, 80),
      sh('B', 480, 160, 100, 80),
      sh('SE', 740, 182, 36, 36),
      sh('T', 780, 282, 36, 36),
      sh('E', 900, 182, 36, 36),
      sh('Note', 500, 310, 100, 40),
      ed('F0', [[136, 200], [200, 200]]),
      ed('F1', [[266, 200], [320, 200]]),
      ed('F2', [[420, 200], [480, 200]]),
      ed('F3', [[580, 200], [740, 200]]),
      ed('F4', [[840, 200], [900, 200]]),
    ].join('');
    const r = await mutateDoc(await Doc.fromXml(defs(process, di)), [{ op: 'remove', ids: ['B'] }], { dryRun: true, layout: 'incremental' });
    expect(r.layout.metrics!.added).toEqual([]);
    const s = shapes(await Doc.fromXml(r.xml));
    expect(s.get('T')!.bounds).toEqual({ x: 780, y: 282, width: 36, height: 36 });
  });
});

describe('#71 a label moved past the right border of its pool widens the pool', () => {
  it('align --axis column next to the border: the pool and its lane grow around the label', async () => {
    const process = `<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="L"><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>E1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
      <bpmn:task id="A" name="A" /><bpmn:endEvent id="E1" name="Rechnungspruefungsabschluss" /></bpmn:process>`;
    const label = '<bpmndi:BPMNLabel><dc:Bounds x="23" y="240" width="190" height="14" /></bpmndi:BPMNLabel>';
    const di = `${sh('Pool', 0, 0, 600, 300, ' isHorizontal="true"')}${sh('L', 30, 0, 570, 300, ' isHorizontal="true"')}${sh('A', 480, 40, 100, 80)}<bpmndi:BPMNShape id="E1_di" bpmnElement="E1"><dc:Bounds x="100" y="200" width="36" height="36" />${label}</bpmndi:BPMNShape>`;
    const xml = defs(process, di, '<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>', 'C');
    const r = await mutateDoc(await Doc.fromXml(xml), [{ op: 'align', ids: ['E1'], to: 'A', axis: 'column' }], { dryRun: true });
    const s = shapes(await Doc.fromXml(r.xml));
    const labelRight = s.get('E1')!.label!.x + s.get('E1')!.label!.width;
    expect(labelRight).toBeGreaterThan(600);
    expect(s.get('Pool')!.bounds.x + s.get('Pool')!.bounds.width).toBeGreaterThanOrEqual(labelRight + 5);
    expect(s.get('L')!.bounds.x + s.get('L')!.bounds.width).toBe(s.get('Pool')!.bounds.x + s.get('Pool')!.bounds.width);
    expect(r.layout.metrics!.added.filter((p) => p.kind === 'labelOutsideFrame')).toEqual([]);
  });
});

describe('#69 a few px into a lane header do not refuse an alignment', () => {
  it('align --axis column puts a task 2 px into the lane header; 20 px are still refused', async () => {
    const process = `<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="L"><bpmn:flowNodeRef>Ev</bpmn:flowNodeRef><bpmn:flowNodeRef>T</bpmn:flowNodeRef><bpmn:flowNodeRef>Ev2</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
      <bpmn:startEvent id="Ev" /><bpmn:startEvent id="Ev2" /><bpmn:task id="T" name="T" /></bpmn:process>`;
    const di = `${sh('Pool', 0, 0, 600, 300, ' isHorizontal="true"')}${sh('L', 30, 0, 570, 300, ' isHorizontal="true"')}${sh('Ev', 90, 40, 36, 36)}${sh('Ev2', 72, 220, 36, 36)}${sh('T', 300, 150, 100, 80)}`;
    const xml = defs(process, di, '<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>', 'C');
    const r = await mutateDoc(await Doc.fromXml(xml), [{ op: 'align', ids: ['T'], to: 'Ev', axis: 'column' }], { dryRun: true });
    expect(shapes(await Doc.fromXml(r.xml)).get('T')!.bounds.x).toBe(58);
    await expect(mutateDoc(await Doc.fromXml(xml), [{ op: 'align', ids: ['T'], to: 'Ev2', axis: 'column' }], { dryRun: true })).rejects.toMatchObject({ code: 'E_LEAVES_CONTAINER' });
  });
});

describe('#40 lane order keeps what hangs out of a band inside the pool', () => {
  it('a boundary event on the bottom border of the band that becomes the last one: the band and the pool grow', async () => {
    const process = `<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>B</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2"><bpmn:flowNodeRef>X</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
      <bpmn:task id="A" name="A" /><bpmn:boundaryEvent id="B" attachedToRef="A"><bpmn:timerEventDefinition id="BT" /></bpmn:boundaryEvent><bpmn:task id="X" name="X" /></bpmn:process>`;
    const di = `${sh('Pool', 0, 0, 600, 300, ' isHorizontal="true"')}${sh('L1', 30, 0, 570, 150, ' isHorizontal="true"')}${sh('L2', 30, 150, 570, 150, ' isHorizontal="true"')}${sh('A', 100, 60, 100, 80)}${sh('B', 160, 122, 36, 36)}${sh('X', 300, 190, 100, 80)}`;
    const xml = defs(process, di, '<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>', 'C');
    const r = await mutateDoc(await Doc.fromXml(xml), [{ op: 'order', id: 'Pool', lanes: ['L2', 'L1'] }], { dryRun: true });
    const s = shapes(await Doc.fromXml(r.xml));
    expect(s.get('L1')!.bounds.y).toBe(150);
    expect(s.get('B')!.bounds.y + 36).toBeLessThanOrEqual(s.get('Pool')!.bounds.y + s.get('Pool')!.bounds.height);
    expect(s.get('L1')!.bounds.y + s.get('L1')!.bounds.height).toBe(s.get('Pool')!.bounds.y + s.get('Pool')!.bounds.height);
    expect(r.layout.metrics!.added.filter((p) => ['outsidePool', 'laneGap'].includes(p.kind))).toEqual([]);
  });
});

describe('#12 a node is not placed beside its own sub-process', () => {
  it('place --after the enclosing (or the grandparent) sub-process is E_LEAVES_CONTAINER; nothing stretches', async () => {
    const r0 = await mutateDoc(
      Doc.create({ processId: 'P' }),
      [
        { op: 'add', kind: 'startEvent', id: 'S' },
        { op: 'add', kind: 'subProcess', id: 'Sub1', name: 'Outer', after: 'S' },
        { op: 'add', kind: 'startEvent', id: 'S1', in: 'Sub1' },
        { op: 'add', kind: 'subProcess', id: 'Sub2', name: 'Inner', after: 'S1' },
        { op: 'add', kind: 'startEvent', id: 'S2', in: 'Sub2' },
        { op: 'add', kind: 'task', id: 'Wrap', name: 'Wrap', after: 'S2' },
        { op: 'add', kind: 'endEvent', id: 'E', after: 'Sub1' },
      ],
      { dryRun: true },
    );
    for (const ref of ['Sub1', 'Sub2']) {
      await expect(mutateDoc(await Doc.fromXml(r0.xml), [{ op: 'place', ids: ['Wrap'], after: ref }], { dryRun: true })).rejects.toMatchObject({
        code: 'E_LEAVES_CONTAINER',
        message: `Placing Wrap after ${ref} would move it out of its sub-process ${ref}`,
      });
    }
    // centred on its own sub-process's column is fine: it stays inside
    const ok = await mutateDoc(await Doc.fromXml(r0.xml), [{ op: 'place', ids: ['Wrap'], columnOf: 'Sub2' }], { dryRun: true });
    expect(ok.layout.metrics!.added.filter((p) => p.kind.startsWith('outside'))).toEqual([]);
  });
});

describe('#62 route refuses a side that points into a boundary event host', () => {
  it('--exit top from a bottom boundary event is E_INVALID_VALUE; --exit bottom routes', async () => {
    const r0 = await mutateDoc(
      Doc.create({ processId: 'P' }),
      [
        { op: 'add', kind: 'startEvent', id: 'S' },
        { op: 'add', kind: 'task', id: 'A', name: 'Work', after: 'S' },
        { op: 'add', kind: 'endEvent', id: 'E', after: 'A' },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'TB', on: 'A', timer: 'PT1H' },
        { op: 'add', kind: 'endEvent', id: 'TE', after: 'TB' },
      ],
      { dryRun: true },
    );
    const doc = await Doc.fromXml(r0.xml);
    const flow = doc.outgoing(doc.get('TB')!)[0]!.get<string>('id');
    await expect(mutateDoc(await Doc.fromXml(r0.xml), [{ op: 'route', id: flow, exit: 'top' }], { dryRun: true })).rejects.toMatchObject({
      code: 'E_INVALID_VALUE',
      message: `--exit top would run ${flow} through A: TB sits on the bottom border of its host`,
    });
    const ok = await mutateDoc(await Doc.fromXml(r0.xml), [{ op: 'route', id: flow, exit: 'bottom' }], { dryRun: true });
    expect(ok.layout.metrics!.added.filter((p) => p.kind === 'through')).toEqual([]);
  });
});

describe('#77 a splice pushes only by the room that is missing', () => {
  it('a task added into a wide gap moves the rest by less than a column, keeping one gap', async () => {
    const process = `<bpmn:process id="P">
      <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="A" name="A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
      <bpmn:task id="B" name="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
      <bpmn:task id="C" name="C"><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing></bpmn:task>
      <bpmn:endEvent id="E"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" />
      <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="C" /><bpmn:sequenceFlow id="F4" sourceRef="C" targetRef="E" />
    </bpmn:process>`;
    // gaps of 60 px, except 172 px between A and B (a node was removed there)
    const di = [
      sh('S', 100, 182, 36, 36),
      sh('A', 196, 160, 100, 80),
      sh('B', 468, 160, 100, 80),
      sh('C', 628, 160, 100, 80),
      sh('E', 788, 182, 36, 36),
      ed('F1', [[136, 200], [196, 200]]),
      ed('F2', [[296, 200], [468, 200]]),
      ed('F3', [[568, 200], [628, 200]]),
      ed('F4', [[728, 200], [788, 200]]),
    ].join('');
    const r = await mutateDoc(await Doc.fromXml(defs(process, di)), [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'A' }], { dryRun: true, layout: 'incremental' });
    const s = shapes(await Doc.fromXml(r.xml));
    const n = s.get('N')!.bounds;
    expect(n.x).toBe(356);
    // B moves 48 px (to one gap right of N), not a whole column (160 px); its successors keep their distances
    expect(s.get('B')!.bounds.x).toBe(n.x + n.width + 60);
    expect(s.get('C')!.bounds.x - s.get('B')!.bounds.x).toBe(160);
    expect(r.layout.metrics!.added).toEqual([]);
  });
});
