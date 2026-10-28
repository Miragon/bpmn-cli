/**
 * A full redraw of a file with id-less elements (collaboration, participant,
 * process, message flow, sequence flow) gives them ids in the file's style
 * first: never bpmnElement="undefined" or repeated `_undefined` DI ids. An
 * op that gives a sequence flow without id other ends gives it an id from
 * its new ends. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, layoutXml } from '../../../../src/api.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { parseXml } from '../../../../src/domain/document/utils/moddle.js';
import { mutateDoc, mutationSummary, renderMutation, renderSummary } from '../../../../src/index.js';

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
  const ids = [...xml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
  expect(ids.length).toBe(new Set(ids).size);
  for (const match of xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge|Plane) [^>]*?bpmnElement="([^"]+)"/g)) expect(ids).toContain(match[1]);
  expect((await parseXml(xml)).importWarnings.map((warning) => warning.message)).toEqual([]);
}

describe('ids for id-less elements a full redraw draws', () => {
  it('a file without diagram: the collaboration, the pool and the message flows get ids in the file\'s style, each its own DI', async () => {
    const outcome = await applyToXml(COLLAB, [{ op: 'set', id: 'Task_1', values: { name: 'Check' } }]);
    await sound(outcome.xml);
    // the file's style: its pool is Part_B, its flows Flow_<n> (the prefix); the bodies speak: the collaboration is named
    // after the process of its first pool, the message flows after their ends
    expect(outcome.xml).toContain('<bpmn:collaboration id="Collaboration_A">');
    expect(outcome.xml).toContain('<bpmn:participant id="Part_Shop" name="Shop" processRef="Process_A"/>');
    expect(outcome.xml).toContain('<bpmn:messageFlow id="Flow_CustomerToCheck" sourceRef="Part_B" targetRef="Task_1"/>');
    expect(outcome.xml).toContain('<bpmn:messageFlow id="Flow_CheckToCustomer" name="Answer" sourceRef="Task_1" targetRef="Part_B"/>');
    for (const id of ['Collaboration_A', 'Flow_CustomerToCheck', 'Flow_CheckToCustomer', 'Part_Shop', 'Part_B']) expect(outcome.xml).toMatch(new RegExp(`<bpmndi:BPMN(?:Shape|Edge|Plane) id="[^"]+" bpmnElement="${id}"`));
    expect(outcome.result.changed.filter((change) => change.detail?.startsWith('id added')).map((change) => [change.kind, change.id])).toEqual([
      ['collaboration', 'Collaboration_A'],
      ['participant', 'Part_Shop'],
      ['messageFlow', 'Flow_CustomerToCheck'],
      ['messageFlow', 'Flow_CheckToCustomer'],
    ]);
    expect(outcome.result.notes).toContainEqual(expect.stringContaining('4 element(s) without id got one'));
    // the same write gives the same ids
    expect((await applyToXml(COLLAB, [{ op: 'set', id: 'Task_1', values: { name: 'Check' } }])).xml).toBe(outcome.xml);
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
      const outcome = await layoutXml(xml, { engine });
      await sound(outcome.xml);
      // the one process of the file without name and pool: Main; flows after their ends (Start_1 says nothing: Start)
      expect(outcome.xml).toContain('<bpmn:process id="Process_Main" isExecutable="false">');
      expect(outcome.xml).toContain('<bpmndi:BPMNPlane id="BPMNPlane_Process_Main" bpmnElement="Process_Main">');
      expect([...outcome.xml.matchAll(/<bpmn:sequenceFlow id="(Flow_StartToCheck|Flow_CheckToEnd)"/g)]).toHaveLength(2);
      expect([...outcome.xml.matchAll(/<bpmndi:BPMNEdge /g)]).toHaveLength(2);
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
    <bpmn:task id="Flow_ParticipantToCheck" name="A task named like the next flow"/>
  </bpmn:process>`);
    const doc = await Doc.fromXml(xml);
    const outcome = await mutateDoc(doc, [], { layout: 'full', force: true });
    await sound(outcome.xml);
    // P2 says nothing (a number) and has no name: a participant
    expect(outcome.xml).toContain('<bpmn:messageFlow id="Flow_ParticipantToCheck_2" sourceRef="P2" targetRef="Task_1"/>');
    expect(doc.ids.has('Flow_ParticipantToCheck_2')).toBe(true);
  });

  it('a kept (incremental) drawing leaves id-less elements alone: a no-op stays unchanged', async () => {
    const drawn = (await layoutXml(COLLAB.replace(/<bpmn:messageFlow /g, (match, at: number) => `<bpmn:messageFlow id="MF_${at}" `))).xml;
    // the same drawing without the message flows' ids and edges, and moved by hand (not the engine's)
    const kept = drawn
      .replace(/ id="MF_\d+"/g, '')
      .replace(/\s*<bpmndi:BPMNEdge id="[^"]*" bpmnElement="MF_\d+">[\s\S]*?<\/bpmndi:BPMNEdge>/g, '')
      .replace(/<dc:Bounds x="(\d+)"/g, (_m, left: string) => `<dc:Bounds x="${Number(left) + 3}"`);
    const outcome = await applyToXml(kept, [{ op: 'set', id: 'Task_1', values: { name: 'Check' } }]);
    expect(outcome.unchanged).toBe(true);
    expect(outcome.xml).toBe(kept);
  });
});

describe('a sequence flow without id whose ends an op changes', () => {
  /** Start_1 -> Check -> End_1; the flow out of Check has no id (valid BPMN), no diagram. */
  const OUT = defs(`  <bpmn:process id="Process_A" isExecutable="false">
${LINE.replace('<bpmn:sequenceFlow id="Flow_2" ', '<bpmn:sequenceFlow ')}
  </bpmn:process>`);
  /** The same with the flow into Check without id. */
  const IN = defs(`  <bpmn:process id="Process_A" isExecutable="false">
${LINE.replace('<bpmn:sequenceFlow id="Flow_1" ', '<bpmn:sequenceFlow ')}
  </bpmn:process>`);
  const flows = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow ([^>]*?)\/>/g)].map((match) => match[1]!);

  it('a splice (add, split; with and without layout, with ids kept too) gives it an id from its new ends and lists it once, as changed', async () => {
    for (const keepFlowIds of [false, true]) {
      for (const layout of [false, undefined]) {
        const outcome = await applyToXml(OUT, [{ op: 'add', kind: 'task', name: 'Log', after: 'Task_1' }], { keepFlowIds, ...(layout === false ? { layout } : {}) });
        await sound(outcome.xml);
        expect(flows(outcome.xml)).toEqual(['id="Flow_1" sourceRef="Start_1" targetRef="Task_1"', 'id="Flow_CheckToLog" sourceRef="Task_1" targetRef="Task_Log"', 'id="Flow_LogToEnd" sourceRef="Task_Log" targetRef="End_1"']);
        expect(outcome.result.changed.map((change) => `${change.id}: ${change.detail}`)).toEqual(['Flow_CheckToLog: Task_1 -> Task_Log (was -> End_1) (id added: it had none)']);
        expect(outcome.result.created.map((change) => change.id)).toEqual(['Task_Log', 'Flow_LogToEnd']);
        expect([outcome.result.renamed, outcome.result.warnings.added]).toEqual([undefined, []]);
      }
      const split = await applyToXml(OUT, [{ op: 'split', after: 'Task_1', name: 'Ok?', branches: [{ flowName: 'yes', nodes: [{ kind: 'task', name: 'A' }] }, { flowName: 'no', nodes: [] }] }], { keepFlowIds, layout: false });
      expect(split.result.changed.map((change) => `${change.id}: ${change.detail}`)).toContain('Flow_CheckToOk: Task_1 -> Gateway_Ok (was -> End_1) (id added: it had none)');
      expect(flows(split.xml)).toContain('id="Flow_CheckToOk" sourceRef="Task_1" targetRef="Gateway_Ok"');
    }
  });

  it('add --flow-id on a splice into it: the flow takes that id (claimed like the id of a flow add creates), without W_OPTION_IGNORED', async () => {
    for (const keepFlowIds of [false, true]) {
      const outcome = await applyToXml(OUT, [{ op: 'add', kind: 'task', name: 'Log', after: 'Task_1', flowId: 'Flow_IntoLog' }], { keepFlowIds, layout: false });
      expect(flows(outcome.xml)).toEqual(['id="Flow_1" sourceRef="Start_1" targetRef="Task_1"', 'id="Flow_IntoLog" sourceRef="Task_1" targetRef="Task_Log"', 'id="Flow_LogToEnd" sourceRef="Task_Log" targetRef="End_1"']);
      expect(outcome.result.changed.map((change) => `${change.id}: ${change.detail}`)).toEqual(['Flow_IntoLog: Task_1 -> Task_Log (was -> End_1) (id added: it had none)']);
      expect(outcome.result.warnings.added).toEqual([]);
      await expect(applyToXml(OUT, [{ op: 'add', kind: 'task', name: 'Log', after: 'Task_1', flowId: 'Flow_1' }], { keepFlowIds, layout: false })).rejects.toMatchObject({ code: 'E_DUPLICATE_ID' });
    }
  });

  it('in a drawing kept as it is, the incremental layout draws the flow by its new id', async () => {
    const drawn = (await layoutXml(defs(`  <bpmn:process id="Process_A" isExecutable="false">\n${LINE}\n  </bpmn:process>`))).xml;
    // the flow out of Check without id, so without an edge either; the drawing moved by hand (not the engine's)
    const kept = drawn
      .replace(/\s*<bpmndi:BPMNEdge id="[^"]*" bpmnElement="Flow_2">[\s\S]*?<\/bpmndi:BPMNEdge>/, '')
      .replace('<bpmn:sequenceFlow id="Flow_2" ', '<bpmn:sequenceFlow ')
      .replace(/<dc:Bounds x="(\d+)"/g, (_m, left: string) => `<dc:Bounds x="${Number(left) + 3}"`);
    for (const keepFlowIds of [false, true]) {
      const outcome = await applyToXml(kept, [{ op: 'add', kind: 'task', name: 'Log', after: 'Task_1' }], { keepFlowIds });
      await sound(outcome.xml);
      expect(outcome.result.layout.mode).toBe('incremental');
      expect(outcome.xml).toMatch(/<bpmndi:BPMNEdge id="[^"]+" bpmnElement="Flow_CheckToLog">/);
      expect(outcome.result.changed.map((change) => change.id)).toContain('Flow_CheckToLog');
    }
  });

  it('a bridge gives the flow into the removed node an id; a removed flow without id prints `(no id)` and is left out of the summary', async () => {
    const bridged = await applyToXml(IN, [{ op: 'remove', ids: ['Task_1'] }], { layout: false });
    expect(flows(bridged.xml)).toEqual(['id="Flow_StartToEnd" sourceRef="Start_1" targetRef="End_1"']);
    expect(bridged.result.changed.map((change) => `${change.id}: ${change.detail}`)).toEqual(['Flow_StartToEnd: Start_1 -> End_1 (bridged Task_1) (id added: it had none)']);
    const removed = await applyToXml(OUT, [{ op: 'remove', ids: ['Task_1'] }], { layout: false });
    const text = renderMutation(removed.result);
    expect(text).toContain('removed sequenceFlow (no id) - Task_1 -> End_1\n');
    expect(text).not.toContain('undefined');
    expect(removed.result.removed.map((change) => change.id ?? '-')).toEqual(['-', 'Task_1']);
    const summary = mutationSummary(removed.result);
    expect([summary.changed, summary.removed]).toEqual([['Flow_1'], ['Task_1']]);
    expect(renderSummary(summary)).toMatch(/^changed: Flow_1\nremoved: Task_1\n/);
  });
});
