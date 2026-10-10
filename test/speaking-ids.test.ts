/**
 * Speaking ids: every generated id says what it names (a name; a kind and a
 * place for unnamed elements; the ends of a flow), never a hash or a running
 * number, in the file's prefixes and case. A flow whose id names its ends
 * follows them when an edit changes them. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { runOps } from '../src/ops/index.js';
import type { Op } from '../src/ops/types.js';
import { definitionsXml, flowBetween } from './helpers.js';

/** Hashes, numbers and tool defaults: what a generated id never ends in. */
const NOT_SPEAKING = /(_[01][0-9a-z]{6}|_\d+|^[A-Za-z]+\d+)$/;

async function created(xml: string, ops: Op[]): Promise<{ doc: Doc; ids: string[]; warnings: string[]; changed: string[] }> {
  const doc = await Doc.fromXml(xml);
  const cs = runOps(doc, ops);
  return { doc, ids: cs.created.map((c) => c.id), warnings: cs.warnings.map((w) => `${w.code} ${w.element ?? ''}`.trim()), changed: cs.changed.map((c) => `${c.id}: ${c.detail ?? ''}`) };
}

/** A Camunda Modeler file: hashed ids, `<id>_di` DI. */
const MODELER = definitionsXml(`
    <bpmn:startEvent id="StartEvent_1" name="Order received"><bpmn:outgoing>Flow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Activity_0k3x9qa" name="Prüfung"><bpmn:incoming>Flow_0a1b2c3</bpmn:incoming><bpmn:outgoing>Flow_1q2w3e4</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="Event_0zz81aa"><bpmn:incoming>Flow_1q2w3e4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_0a1b2c3" sourceRef="StartEvent_1" targetRef="Activity_0k3x9qa" />
    <bpmn:sequenceFlow id="Flow_1q2w3e4" sourceRef="Activity_0k3x9qa" targetRef="Event_0zz81aa" />`);

describe('speaking ids in a Camunda Modeler file', () => {
  it('names, kinds and places, the ends of flows: no hash, no number; umlauts transliterated', async () => {
    const r = await created(MODELER, [
      { op: 'add', kind: 'serviceTask', name: 'Größe messen', after: 'Activity_0k3x9qa' },
      { op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_0k3x9qa', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', after: 'Event_TimerOnPruefung' },
      { op: 'add', kind: 'exclusiveGateway', before: 'Activity_GroesseMessen' },
      { op: 'add', kind: 'subProcess', name: 'Nacharbeit', in: 'Process_1' },
      { op: 'add', kind: 'startEvent', in: 'Activity_Nacharbeit' },
    ]);
    expect(r.ids).toEqual([
      'Activity_GroesseMessen',
      // the end event says nothing about itself (a hash, no name): a word for its kind
      'Flow_GroesseMessenToEnd',
      'Event_TimerOnPruefung',
      'Event_EndAfterTimer',
      'Flow_TimerToEnd',
      'Gateway_BeforeGroesseMessen',
      'Flow_GatewayToGroesseMessen',
      'Activity_Nacharbeit',
      'Event_StartInNacharbeit',
    ]);
    for (const id of r.ids) expect(id).not.toMatch(NOT_SPEAKING);
    // the hashed flows say nothing about their ends: they keep their ids where an edit changed the ends
    expect(flowBetween(r.doc, 'Activity_0k3x9qa', 'Gateway_BeforeGroesseMessen')).toBe('Flow_1q2w3e4');
  });

  it('two unnamed elements in the same place: the second gets _2 and W_ID_SUFFIXED, deterministically', async () => {
    const ops: Op[] = [
      { op: 'add', kind: 'endEvent', in: 'Process_1' },
      { op: 'add', kind: 'endEvent', in: 'Process_1' },
      { op: 'connect', source: 'Activity_0k3x9qa', target: 'Event_End' },
      { op: 'connect', source: 'Activity_0k3x9qa', target: 'Event_End' },
    ];
    const a = await created(MODELER, ops);
    expect(a.ids).toEqual(['Event_End', 'Event_End_2', 'Flow_PruefungToEnd', 'Flow_PruefungToEnd_2']);
    expect(a.warnings.filter((w) => w.startsWith('W_ID_SUFFIXED'))).toEqual(['W_ID_SUFFIXED Event_End_2', 'W_ID_SUFFIXED Flow_PruefungToEnd_2']);
    expect((await created(MODELER, ops)).ids).toEqual(a.ids);
  });
});

/** A file of the default style with `<id>_di` DI: start -> A -> B -> end. */
async function drawnDefault(): Promise<string> {
  const ops: Op[] = [
    { op: 'add', kind: 'startEvent', name: 'Start' },
    { op: 'add', kind: 'task', name: 'Check', after: 'Event_Start' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', after: 'Activity_Check' },
    { op: 'add', kind: 'task', name: 'Book', after: 'Gateway_Ok', default: true },
    { op: 'add', kind: 'endEvent', name: 'Done', after: 'Activity_Book' },
  ];
  return (await applyToXml((await newXml({ processName: 'P' })).xml, ops)).xml.replace(/BPMN(Shape|Edge)_([A-Za-z0-9_]+)/g, '$2_di');
}

describe('flows whose ids name their ends follow them', () => {
  it('a splice renames the spliced flow, its DI edge and the default reference; the result says so', async () => {
    const xml = await drawnDefault();
    expect(xml).toContain('<bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?" default="Flow_OkToBook">');
    expect(xml).toContain('<bpmndi:BPMNEdge id="Flow_OkToBook_di" bpmnElement="Flow_OkToBook">');
    const r = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Review', flow: 'Flow_OkToBook' }]);
    expect(r.result.created.map((c) => c.id)).toEqual(['Activity_Review', 'Flow_ReviewToBook']);
    expect(r.result.changed.map((c) => `${c.id}: ${c.detail}`)).toContain('Flow_OkToReview: Gateway_Ok -> Activity_Review (was -> Activity_Book) (renamed from Flow_OkToBook: its id named its old ends)');
    expect(r.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?" default="Flow_OkToReview">');
    expect(r.xml).toContain('<bpmndi:BPMNEdge id="Flow_OkToReview_di" bpmnElement="Flow_OkToReview">');
    expect(r.xml).not.toContain('Flow_OkToBook');
  });

  it('a bridge, a move and set target= rename it too; every other id stays', async () => {
    const xml = await drawnDefault();
    const removed = await applyToXml(xml, [{ op: 'remove', ids: ['Activity_Book'] }]);
    expect(removed.result.changed.map((c) => c.id)).toContain('Flow_OkToDone');
    expect(removed.xml).toContain('<bpmn:sequenceFlow id="Flow_OkToDone" sourceRef="Gateway_Ok" targetRef="Event_Done" />');
    const retargeted = await applyToXml(xml, [{ op: 'set', id: 'Flow_BookToDone', values: { target: 'Activity_Check' } }]);
    expect(retargeted.xml).toContain('<bpmn:sequenceFlow id="Flow_BookToCheck" sourceRef="Activity_Book" targetRef="Activity_Check" />');
    const moved = await applyToXml(xml, [{ op: 'move', ids: ['Activity_Book'], before: 'Activity_Check' }]);
    const ids = [...moved.xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)" sourceRef="([^"]+)" targetRef="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}->${m[3]}`);
    expect(ids.sort()).toEqual(['Flow_BookToCheck Activity_Book->Activity_Check', 'Flow_CheckToOk Activity_Check->Gateway_Ok', 'Flow_OkToDone Gateway_Ok->Event_Done', 'Flow_StartToBook Event_Start->Activity_Book']);
    // an explicit id that does not name its ends stays
    const own = await applyToXml(xml, [
      { op: 'connect', source: 'Gateway_Ok', target: 'Event_Done', id: 'Flow_Shortcut', name: 'skip' },
      { op: 'add', kind: 'task', name: 'Log', flow: 'Flow_Shortcut' },
    ]);
    expect(own.xml).toContain('<bpmn:sequenceFlow id="Flow_Shortcut" name="skip" sourceRef="Gateway_Ok" targetRef="Activity_Log" />');
  });

  it('a batch lists every id as it is at its end, also when a later op renamed it', async () => {
    const doc = Doc.create({ processName: 'P' });
    const cs = runOps(doc, [
      { op: 'add', kind: 'startEvent', name: 'Start' },
      { op: 'add', kind: 'endEvent', name: 'End', after: 'Event_Start' },
      { op: 'add', kind: 'task', name: 'Work', after: 'Event_Start' },
    ]);
    expect(cs.created.map((c) => c.id)).toEqual(['Event_Start', 'Event_End', 'Flow_StartToWork', 'Activity_Work', 'Flow_WorkToEnd']);
    expect(doc.get('Flow_StartToEnd')).toBeUndefined();
    expect(flowBetween(doc, 'Event_Start', 'Activity_Work')).toBe('Flow_StartToWork');
  });
});

describe('speaking ids follow the file', () => {
  it('a file that numbers its ids keeps its prefixes and separator, never its numbers', async () => {
    const xml = definitionsXml(`
    <bpmn:startEvent id="Start_1" name="Begin"><bpmn:outgoing>SF_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="First"><bpmn:incoming>SF_1</bpmn:incoming><bpmn:outgoing>SF_2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_2" name="Second"><bpmn:incoming>SF_2</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="SF_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="SF_2" sourceRef="Task_1" targetRef="Task_2" />`);
    const r = await created(xml, [
      { op: 'add', kind: 'parallelGateway', after: 'Task_2' },
      { op: 'add', kind: 'task', name: 'Third', after: 'Gateway_AfterSecond' },
    ]);
    expect(r.ids).toEqual(['Gateway_AfterSecond', 'SF_SecondToGateway', 'Task_Third', 'SF_GatewayToThird']);
  });
});
