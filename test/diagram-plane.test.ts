/**
 * src/diagram/plane.ts (reading the DI into planes) and src/diagram/write.ts
 * (writing it back, pruning, colours) on hand-written DI fixtures.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { readPlanes, semantics, homePlane, frameOf, type Plane } from '../src/diagram/plane.js';
import { applyColors, colorsOf, diIds, pruneDi, writePlanes } from '../src/diagram/write.js';
import { is, type El } from '../src/model.js';
import { BPMN_NS } from './helpers.js';

const NS = `xmlns:bpmn="${BPMN_NS}" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"`;

const shape = (id: string, x: number, y: number, w: number, h: number, extra = '', inner = ''): string =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" ${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" />${inner}</bpmndi:BPMNShape>`;
const edge = (id: string, pts: Array<[number, number]>): string =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`;

/** A pool with two lanes (the second nested twice), a task with a boundary event, an expanded sub-process. */
const POOL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="D" targetNamespace="x">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>T</bpmn:flowNodeRef><bpmn:flowNodeRef>B</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2"><bpmn:childLaneSet id="LS2"><bpmn:lane id="L2a"><bpmn:flowNodeRef>Sub</bpmn:flowNodeRef></bpmn:lane></bpmn:childLaneSet></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" name="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T" name="Task"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:subProcess id="Sub"><bpmn:incoming>F2</bpmn:incoming>
      <bpmn:startEvent id="SS" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T" />
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="Sub" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dia"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">
    ${shape('Pool', 100, 100, 800, 400, 'isHorizontal="true"')}
    ${shape('L1', 130, 100, 770, 150, 'isHorizontal="true"')}
    ${shape('L2', 130, 250, 770, 250, 'isHorizontal="true"')}
    ${shape('L2a', 160, 250, 740, 250, 'isHorizontal="true"')}
    ${shape('S', 180, 157, 36, 36, 'bioc:stroke="#205022" bioc:fill="#c8e6c9" color:background-color="#c8e6c9" color:border-color="#205022"', '<bpmndi:BPMNLabel color:color="#205022"><dc:Bounds x="180" y="200" width="30" height="14" /></bpmndi:BPMNLabel>')}
    ${shape('T', 260, 135, 100, 80)}
    ${shape('B', 322, 197, 36, 36)}
    ${shape('Sub', 420, 280, 300, 180, 'isExpanded="true"')}
    ${shape('SS', 450, 340, 36, 36)}
    ${edge('F1', [[216, 175], [260, 175]])}
    ${edge('F2', [[360, 175], [390, 175], [390, 370], [420, 370]])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml = POOL): Promise<{ doc: Doc; planes: Plane[] }> {
  const doc = await Doc.fromXml(xml);
  return { doc, planes: readPlanes(doc.definitions) };
}

function bounds(doc: Doc, id: string): Record<string, number> | undefined {
  for (const d of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of d.get<El>('plane').get<El[]>('planeElement')) {
      if (pe.get<El>('bpmnElement')?.get('id') === id && pe.get('bounds')) {
        const b = pe.get<El>('bounds');
        return { x: b.get('x'), y: b.get('y'), width: b.get('width'), height: b.get('height') };
      }
    }
  }
  return undefined;
}

describe('readPlanes', () => {
  it('reads shapes, edges and membership from the semantic model', async () => {
    const { planes } = await load();
    expect(planes).toHaveLength(1);
    const p = planes[0]!;
    expect(p.rootId).toBe('C');
    const s = (id: string) => p.shapes.get(id)!;
    expect(s('Pool')).toMatchObject({ kind: 'participant', container: true });
    expect(s('L2a')).toMatchObject({ kind: 'lane', container: true, laneId: 'L2', poolId: 'Pool' });
    expect(s('T')).toMatchObject({ kind: 'task', container: false, laneId: 'L1', poolId: 'Pool' });
    expect(s('B')).toMatchObject({ kind: 'boundary', hostId: 'T', laneId: 'L1' });
    expect(s('Sub')).toMatchObject({ kind: 'subProcess', container: true, expanded: true, laneId: 'L2a' });
    expect(s('SS')).toMatchObject({ kind: 'event', parentId: 'Sub', poolId: 'Pool' });
    expect(s('S').label).toEqual({ x: 180, y: 200, width: 30, height: 14 });
    expect(p.edges.get('F2')).toMatchObject({ kind: 'sequenceFlow', sourceId: 'T', targetId: 'Sub' });
    expect(p.edges.get('F2')!.points).toHaveLength(4);
  });

  it('finds frames and home planes', async () => {
    const { doc, planes } = await load();
    const p = planes[0]!;
    expect(frameOf(p, p.shapes.get('T')!)!.id).toBe('L1');
    expect(frameOf(p, p.shapes.get('SS')!)!.id).toBe('Sub');
    expect(frameOf(p, p.shapes.get('L2a')!)!.id).toBe('L2');
    expect(frameOf(p, p.shapes.get('L1')!)!.id).toBe('Pool');
    const sem = semantics(doc.definitions);
    expect(homePlane(planes, sem, 'SS')).toBe(p);
    expect(homePlane(planes, sem, 'F1')).toBe(p);
  });

  it('does not materialise collections on the model', async () => {
    const { doc } = await load();
    const before = await doc.toXml();
    readPlanes(doc.definitions);
    expect(await doc.toXml()).toBe(before);
  });
});

describe('writePlanes', () => {
  it('updates geometry in place and keeps every other DI attribute', async () => {
    const { doc, planes } = await load();
    const p = planes[0]!;
    const s = p.shapes.get('S')!;
    s.bounds.x += 10;
    s.label!.x += 10;
    p.edges.get('F1')!.points[0]!.x += 10;
    writePlanes(doc.moddle, doc.definitions, planes);
    const xml = await doc.toXml();
    expect(bounds(doc, 'S')).toEqual({ x: 190, y: 157, width: 36, height: 36 });
    expect(xml).toContain('bioc:fill="#c8e6c9"');
    expect(xml).toContain('color:border-color="#205022"');
    expect(xml).toMatch(/<bpmndi:BPMNLabel color:color="#205022">\s*<dc:Bounds x="190"/);
    expect(xml).toContain('<di:waypoint x="226" y="175" />');
    // untouched shapes are written exactly as they were
    expect(bounds(doc, 'T')).toEqual({ x: 260, y: 135, width: 100, height: 80 });
  });

  it('creates DI for new shapes and edges in the file\'s id style, rounded', async () => {
    const { doc, planes } = await load();
    const p = planes[0]!;
    const el = doc.create('bpmn:ExclusiveGateway', { id: 'G' });
    doc.get('P')!.get<El[]>('flowElements').push(el);
    el.$parent = doc.get('P');
    p.shapes.set('G', { id: 'G', el, bounds: { x: 600.4, y: 150.6, width: 50, height: 50 }, kind: 'gateway', container: false, label: { x: 590, y: 120, width: 70, height: 14 } });
    writePlanes(doc.moddle, doc.definitions, planes);
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmndi:BPMNShape id="G_di" bpmnElement="G" isMarkerVisible="true">\s*<dc:Bounds x="600" y="151" width="50" height="50" \/>\s*<bpmndi:BPMNLabel>/);
    expect(p.shapes.get('G')!.di).toBeDefined();
  });

  it('follows the BPMNShape_ style of engine-written files and avoids taken ids', async () => {
    const doc = await Doc.fromXml(POOL.replace(/id="(\w+)_di" bpmnElement="(\w+)"/g, 'id="BPMNShape_$2" bpmnElement="$2"'));
    const ids = diIds(doc.definitions);
    expect(ids.shape('X')).toBe('BPMNShape_X');
    expect(ids.shape('S')).toBe('BPMNShape_S_2');
  });

  it('moves DI to another plane, deletes dropped DI and whole planes', async () => {
    const { doc, planes } = await load();
    const p = planes[0]!;
    const ss = p.shapes.get('SS')!;
    p.shapes.delete('SS');
    const child: Plane = { id: 'x', rootId: 'Sub', root: doc.get('Sub')!, shapes: new Map([['SS', ss]]), edges: new Map(), dropped: [] };
    p.dropped.push(p.edges.get('F1')!.di!);
    p.edges.delete('F1');
    writePlanes(doc.moddle, doc.definitions, [p, child]);
    const diagrams = doc.definitions.get<El[]>('diagrams');
    expect(diagrams).toHaveLength(2);
    const second = diagrams[1]!.get<El>('plane');
    expect(second.get<El>('bpmnElement')).toBe(doc.get('Sub'));
    expect(second.get<El[]>('planeElement').map((e) => e.get('id'))).toEqual(['SS_di']);
    expect(await doc.toXml()).not.toContain('F1_di');
    child.deleted = true;
    writePlanes(doc.moddle, doc.definitions, [p, child]);
    expect(doc.definitions.get<El[]>('diagrams')).toHaveLength(1);
  });
});

describe('pruneDi and colours', () => {
  it('prunes DI of removed elements and reports their ids', async () => {
    const { doc } = await load();
    const proc = doc.get('P')!;
    const list = proc.get<El[]>('flowElements');
    list.splice(list.indexOf(doc.get('B')!), 1);
    doc.invalidate();
    const pruned = pruneDi(doc.definitions, semantics(doc.definitions));
    expect(pruned).toEqual(['B']);
    expect(await doc.toXml()).not.toContain('B_di');
  });

  it('carries colours over by element id', async () => {
    const { doc } = await load();
    const colors = colorsOf(doc.definitions);
    expect([...colors.keys()]).toEqual(['S']);
    const fresh = await Doc.fromXml(POOL.replace(/ bioc:\S+| color:[a-z-]+="[^"]*"/g, ''));
    expect(await fresh.toXml()).not.toContain('bioc:fill');
    expect(applyColors(fresh.moddle, fresh.definitions, colors)).toBe(1);
    const xml = await fresh.toXml();
    expect(xml).toContain('bioc:fill="#c8e6c9"');
    expect(xml).toContain('color:color="#205022"');
    const shapeDi = fresh.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement').find((e) => is(e.get('bpmnElement'), 'bpmn:StartEvent'))!;
    expect(shapeDi.get('color:background-color')).toBe('#c8e6c9');
  });
});
