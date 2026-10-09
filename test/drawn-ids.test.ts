/**
 * A full redraw of a file with id-less elements (collaboration, participant,
 * process, message flow, sequence flow) gives them ids in the file's style
 * first: never bpmnElement="undefined" or repeated `_undefined` DI ids.
 * Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, layoutXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { parseXml } from '../src/model.js';
import { mutateDoc } from '../src/pipeline.js';

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const defs = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${body}
</bpmn:definitions>
`;
const LINE = `    <bpmn:startEvent id="Start_1"/>
    <bpmn:task id="Task_1" name="Check"/>
    <bpmn:endEvent id="End_1"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1"/>`;

/** An id-less collaboration with an id-less pool around the process, a black-box pool and two id-less message flows. */
const COLLAB = defs(`  <bpmn:collaboration>
    <bpmn:participant name="Shop" processRef="Process_A"/>
    <bpmn:participant id="Part_B" name="Customer"/>
    <bpmn:messageFlow sourceRef="Part_B" targetRef="Task_1"/>
    <bpmn:messageFlow name="Answer" sourceRef="Task_1" targetRef="Part_B"/>
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="false">
${LINE}
  </bpmn:process>`);

/** Every BPMNShape / BPMNEdge refers to an element that exists, no id is used twice, and the file reads back without warnings. */
async function sound(xml: string): Promise<void> {
  expect(xml).not.toMatch(/undefined/);
  const ids = [...xml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  expect(ids.length).toBe(new Set(ids).size);
  for (const m of xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge|Plane) [^>]*?bpmnElement="([^"]+)"/g)) expect(ids).toContain(m[1]);
  expect((await parseXml(xml)).importWarnings.map((w) => w.message)).toEqual([]);
}

describe('ids for id-less elements a full redraw draws', () => {
  it('a file without diagram: the collaboration, the pool and the message flows get ids in the file\'s style, each its own DI', async () => {
    const r = await applyToXml(COLLAB, [{ op: 'set', id: 'Task_1', values: { name: 'Check' } }]);
    await sound(r.xml);
    // the file's style: it numbers its flows and unnamed elements, and its pool is Part_B
    expect(r.xml).toContain('<bpmn:collaboration id="Collaboration_1">');
    expect(r.xml).toContain('<bpmn:participant id="Part_Shop" name="Shop" processRef="Process_A"/>');
    expect(r.xml).toContain('<bpmn:messageFlow id="Flow_3" sourceRef="Part_B" targetRef="Task_1"/>');
    expect(r.xml).toContain('<bpmn:messageFlow id="Flow_4" name="Answer" sourceRef="Task_1" targetRef="Part_B"/>');
    for (const id of ['Collaboration_1', 'Flow_3', 'Flow_4', 'Part_Shop', 'Part_B']) expect(r.xml).toMatch(new RegExp(`<bpmndi:BPMN(?:Shape|Edge|Plane) id="[^"]+" bpmnElement="${id}"`));
    expect(r.result.changed.filter((c) => c.detail?.startsWith('id added')).map((c) => [c.kind, c.id])).toEqual([
      ['collaboration', 'Collaboration_1'],
      ['participant', 'Part_Shop'],
      ['messageFlow', 'Flow_3'],
      ['messageFlow', 'Flow_4'],
    ]);
    expect(r.result.notes).toContainEqual(expect.stringContaining('4 element(s) without id got one'));
    // the same write gives the same ids
    expect((await applyToXml(COLLAB, [{ op: 'set', id: 'Task_1', values: { name: 'Check' } }])).xml).toBe(r.xml);
  });

  it('an id-less process as the layout root and id-less sequence flows (both engines)', async () => {
    const xml = defs(`  <bpmn:process isExecutable="false">
    <bpmn:startEvent id="Start_1"/>
    <bpmn:task id="Task_1" name="Check"/>
    <bpmn:endEvent id="End_1"/>
    <bpmn:sequenceFlow sourceRef="Start_1" targetRef="Task_1"/>
    <bpmn:sequenceFlow sourceRef="Task_1" targetRef="End_1"/>
  </bpmn:process>`);
    for (const engine of ['clean', 'auto'] as const) {
      const r = await layoutXml(xml, { engine });
      await sound(r.xml);
      expect(r.xml).toContain('<bpmn:process id="Process_1" isExecutable="false">');
      expect(r.xml).toContain('<bpmndi:BPMNPlane id="BPMNPlane_Process_1" bpmnElement="Process_1">');
      expect([...r.xml.matchAll(/<bpmn:sequenceFlow id="(Flow_[01][0-9a-z]{6})"/g)]).toHaveLength(2);
      expect([...r.xml.matchAll(/<bpmndi:BPMNEdge /g)]).toHaveLength(2);
    }
  });

  it('the file\'s own registry: a generated id never collides with an existing or a DI id', async () => {
    const xml = defs(`  <bpmn:collaboration id="C">
    <bpmn:participant id="P1" processRef="Process_A"/>
    <bpmn:participant id="P2"/>
    <bpmn:messageFlow sourceRef="P2" targetRef="Task_1"/>
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="false">
${LINE}
    <bpmn:task id="Flow_3" name="A task named like the next flow"/>
  </bpmn:process>`);
    const doc = await Doc.fromXml(xml);
    const r = await mutateDoc(doc, [], { layout: 'full', force: true });
    await sound(r.xml);
    expect(r.xml).toContain('<bpmn:messageFlow id="Flow_4" sourceRef="P2" targetRef="Task_1"/>');
    expect(doc.ids.has('Flow_4')).toBe(true);
  });

  it('a kept (incremental) drawing leaves id-less elements alone: a no-op stays unchanged', async () => {
    const drawn = (await layoutXml(COLLAB.replace(/<bpmn:messageFlow /g, (m, at: number) => `<bpmn:messageFlow id="MF_${at}" `))).xml;
    // the same drawing without the message flows' ids and edges, and moved by hand (not the engine's)
    const kept = drawn
      .replace(/ id="MF_\d+"/g, '')
      .replace(/\s*<bpmndi:BPMNEdge id="[^"]*" bpmnElement="MF_\d+">[\s\S]*?<\/bpmndi:BPMNEdge>/g, '')
      .replace(/<dc:Bounds x="(\d+)"/g, (_m, x: string) => `<dc:Bounds x="${Number(x) + 3}"`);
    const r = await applyToXml(kept, [{ op: 'set', id: 'Task_1', values: { name: 'Check' } }]);
    expect(r.unchanged).toBe(true);
    expect(r.xml).toBe(kept);
  });
});
