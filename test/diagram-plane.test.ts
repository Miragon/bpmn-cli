/**
 * src/drawing/DiagramReader.ts (reading the DI into planes) and src/drawing/PlaneWriter.ts
 * (writing it back, pruning, colours) on hand-written DI fixtures.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model/Doc.js';
import { DiPruner } from '../src/drawing/DiPruner.js';
import { Frames } from '../src/drawing/Frames.js';
import type { Plane } from '../src/drawing/types.js';
import { applyColors, colorsOf } from '../src/drawing/utils/colors.js';
import { DiagramReader } from '../src/drawing/DiagramReader.js';
import { Semantics } from '../src/drawing/Semantics.js';
import { DiIds } from '../src/drawing/DiIds.js';
import { PlaneWriter } from '../src/drawing/PlaneWriter.js';
import { is, type El } from '../src/model/utils/moddle.js';
import { BPMN_NS } from './helpers.js';

const NS = `xmlns:bpmn="${BPMN_NS}" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"`;

const shape = (id: string, left: number, top: number, width: number, height: number, extra = '', inner = ''): string =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" ${extra}><dc:Bounds x="${left}" y="${top}" width="${width}" height="${height}" />${inner}</bpmndi:BPMNShape>`;
const edge = (id: string, pts: Array<[number, number]>): string =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([left, top]) => `<di:waypoint x="${left}" y="${top}" />`).join('')}</bpmndi:BPMNEdge>`;

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
  return { doc, planes: new DiagramReader(doc.definitions).planes() };
}

function bounds(doc: Doc, id: string): Record<string, number> | undefined {
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      if (pe.get<El>('bpmnElement')?.get('id') === id && pe.get('bounds')) {
        const box = pe.get<El>('bounds');
        return { x: box.get('x'), y: box.get('y'), width: box.get('width'), height: box.get('height') };
      }
    }
  }
  return undefined;
}

describe('DiagramReader', () => {
  it('reads shapes, edges and membership from the semantic model', async () => {
    const { planes } = await load();
    expect(planes).toHaveLength(1);
    const plane = planes[0]!;
    expect(plane.rootId).toBe('C');
    const shapeById = (id: string) => plane.shapes.get(id)!;
    expect(shapeById('Pool')).toMatchObject({ kind: 'participant', container: true });
    expect(shapeById('L2a')).toMatchObject({ kind: 'lane', container: true, laneId: 'L2', poolId: 'Pool' });
    expect(shapeById('T')).toMatchObject({ kind: 'task', container: false, laneId: 'L1', poolId: 'Pool' });
    expect(shapeById('B')).toMatchObject({ kind: 'boundary', hostId: 'T', laneId: 'L1' });
    expect(shapeById('Sub')).toMatchObject({ kind: 'subProcess', container: true, expanded: true, laneId: 'L2a' });
    expect(shapeById('SS')).toMatchObject({ kind: 'event', parentId: 'Sub', poolId: 'Pool' });
    expect(shapeById('S').label).toEqual({ x: 180, y: 200, width: 30, height: 14 });
    expect(plane.edges.get('F2')).toMatchObject({ kind: 'sequenceFlow', sourceId: 'T', targetId: 'Sub' });
    expect(plane.edges.get('F2')!.points).toHaveLength(4);
  });

  it('finds frames and home planes', async () => {
    const { doc, planes } = await load();
    const plane = planes[0]!;
    expect(Frames.of(plane, plane.shapes.get('T')!)!.id).toBe('L1');
    expect(Frames.of(plane, plane.shapes.get('SS')!)!.id).toBe('Sub');
    expect(Frames.of(plane, plane.shapes.get('L2a')!)!.id).toBe('L2');
    expect(Frames.of(plane, plane.shapes.get('L1')!)!.id).toBe('Pool');
    const sem = Semantics.of(doc.definitions);
    expect(sem.homePlane(planes, 'SS')).toBe(plane);
    expect(sem.homePlane(planes, 'F1')).toBe(plane);
  });

  it('does not materialise collections on the model', async () => {
    const { doc } = await load();
    const before = await doc.toXml();
    new DiagramReader(doc.definitions).planes();
    expect(await doc.toXml()).toBe(before);
  });
});

describe('PlaneWriter', () => {
  it('updates geometry in place and keeps every other DI attribute', async () => {
    const { doc, planes } = await load();
    const plane = planes[0]!;
    const startShape = plane.shapes.get('S')!;
    startShape.bounds.x += 10;
    startShape.label!.x += 10;
    plane.edges.get('F1')!.points[0]!.x += 10;
    new PlaneWriter(doc.moddle, doc.definitions).write(planes);
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
    const plane = planes[0]!;
    const el = doc.create('bpmn:ExclusiveGateway', { id: 'G' });
    doc.get('P')!.get<El[]>('flowElements').push(el);
    el.$parent = doc.get('P');
    plane.shapes.set('G', { id: 'G', el, bounds: { x: 600.4, y: 150.6, width: 50, height: 50 }, kind: 'gateway', container: false, label: { x: 590, y: 120, width: 70, height: 14 } });
    new PlaneWriter(doc.moddle, doc.definitions).write(planes);
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmndi:BPMNShape id="G_di" bpmnElement="G" isMarkerVisible="true">\s*<dc:Bounds x="600" y="151" width="50" height="50" \/>\s*<bpmndi:BPMNLabel>/);
    expect(plane.shapes.get('G')!.di).toBeDefined();
  });

  it('follows the BPMNShape_ style of engine-written files and avoids taken ids', async () => {
    const doc = await Doc.fromXml(POOL.replace(/id="(\w+)_di" bpmnElement="(\w+)"/g, 'id="BPMNShape_$2" bpmnElement="$2"'));
    const ids = new DiIds(doc.definitions);
    expect(ids.shape('X')).toBe('BPMNShape_X');
    expect(ids.shape('S')).toBe('BPMNShape_S_2');
  });

  it('moves DI to another plane, deletes dropped DI and whole planes', async () => {
    const { doc, planes } = await load();
    const plane = planes[0]!;
    const ss = plane.shapes.get('SS')!;
    plane.shapes.delete('SS');
    const child: Plane = { id: 'x', rootId: 'Sub', root: doc.get('Sub')!, shapes: new Map([['SS', ss]]), edges: new Map(), dropped: [] };
    plane.dropped.push(plane.edges.get('F1')!.di!);
    plane.edges.delete('F1');
    new PlaneWriter(doc.moddle, doc.definitions).write([plane, child]);
    const diagrams = doc.definitions.get<El[]>('diagrams');
    expect(diagrams).toHaveLength(2);
    const second = diagrams[1]!.get<El>('plane');
    expect(second.get<El>('bpmnElement')).toBe(doc.get('Sub'));
    expect(second.get<El[]>('planeElement').map((element) => element.get('id'))).toEqual(['SS_di']);
    expect(await doc.toXml()).not.toContain('F1_di');
    child.deleted = true;
    new PlaneWriter(doc.moddle, doc.definitions).write([plane, child]);
    expect(doc.definitions.get<El[]>('diagrams')).toHaveLength(1);
  });
});

describe('DiPruner.prune and colours', () => {
  it('prunes DI of removed elements and reports their ids', async () => {
    const { doc } = await load();
    const proc = doc.get('P')!;
    const list = proc.get<El[]>('flowElements');
    list.splice(list.indexOf(doc.get('B')!), 1);
    doc.invalidate();
    const pruned = DiPruner.prune(doc.definitions, Semantics.of(doc.definitions));
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
    const shapeDi = fresh.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement').find((element) => is(element.get('bpmnElement'), 'bpmn:StartEvent'))!;
    expect(shapeDi.get('color:background-color')).toBe('#c8e6c9');
  });
});
