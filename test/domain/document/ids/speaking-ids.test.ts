/**
 * Speaking ids: every generated id says what it names (a name; a kind and a
 * place for unnamed elements; the ends of a flow), never a hash or a running
 * number, in the prefixes and case of element-id-naming. A flow whose id names its ends
 * follows them when an edit changes them. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../../../src/api.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { runOps } from '../../../../src/index.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { mutationSummary, renderMutation, renderSummary } from '../../../../src/index.js';
import { definitionsXml, flowBetween } from '../../../helpers/helpers.js';

/** Hashes, numbers and tool defaults: what a generated id never ends in. */
const NOT_SPEAKING = /(_[01][0-9a-z]{6}|_\d+|^[A-Za-z]+\d+)$/;

async function created(xml: string, ops: EditCommand[]): Promise<{ doc: Doc; ids: string[]; warnings: string[]; changed: string[] }> {
  const doc = await Doc.fromXml(xml);
  const cs = runOps(doc, ops);
  return { doc, ids: cs.created.map((change) => change.id), warnings: cs.warnings.map((warning) => `${warning.code} ${warning.element ?? ''}`.trim()), changed: cs.changed.map((change) => `${change.id}: ${change.detail ?? ''}`) };
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
    const outcome = await created(MODELER, [
      { op: 'add', kind: 'serviceTask', name: 'Größe messen', after: 'Activity_0k3x9qa' },
      { op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_0k3x9qa', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', after: 'event_timerOnPruefung' },
      { op: 'add', kind: 'exclusiveGateway', before: 'serviceTask_groesseMessen' },
      { op: 'add', kind: 'subProcess', name: 'Nacharbeit', in: 'Process_1' },
      { op: 'add', kind: 'startEvent', in: 'subProcess_nacharbeit' },
    ]);
    expect(outcome.ids).toEqual([
      'serviceTask_groesseMessen',
      // the end event says nothing about itself (a hash, no name): a word for its kind
      'flow_groesseMessenToEnd',
      'event_timerOnPruefung',
      // an unnamed end is named by its own id's speaking part: its kind and place
      'endEvent_afterTimerOnPruefung',
      'flow_timerOnPruefungToAfterTimerOnPruefung',
      'gateway_beforeGroesseMessen',
      'flow_beforeGroesseMessenToGroesseMessen',
      'subProcess_nacharbeit',
      'startEvent_inNacharbeit',
    ]);
    for (const id of outcome.ids) expect(id).not.toMatch(NOT_SPEAKING);
    // the hashed flows say nothing about their ends: they keep their ids where an edit changed the ends
    expect(flowBetween(outcome.doc, 'Activity_0k3x9qa', 'gateway_beforeGroesseMessen')).toBe('Flow_1q2w3e4');
  });

  it('two unnamed elements in the same place: the second gets 2 and W_ID_SUFFIXED, deterministically', async () => {
    const ops: EditCommand[] = [
      { op: 'add', kind: 'endEvent', in: 'Process_1' },
      { op: 'add', kind: 'endEvent', in: 'Process_1' },
      { op: 'connect', source: 'Activity_0k3x9qa', target: 'endEvent_end' },
      { op: 'connect', source: 'Activity_0k3x9qa', target: 'endEvent_end' },
    ];
    const outcome = await created(MODELER, ops);
    expect(outcome.ids).toEqual(['endEvent_end', 'endEvent_end2', 'flow_pruefungToEnd', 'flow_pruefungToEnd2']);
    expect(outcome.warnings.filter((warning) => warning.startsWith('W_ID_SUFFIXED'))).toEqual(['W_ID_SUFFIXED endEvent_end2', 'W_ID_SUFFIXED flow_pruefungToEnd2']);
    expect((await created(MODELER, ops)).ids).toEqual(outcome.ids);
  });
});

/** A file of the default style with `<id>_di` DI: start -> A -> B -> end. */
async function drawnDefault(): Promise<string> {
  const ops: EditCommand[] = [
    { op: 'add', kind: 'startEvent', name: 'Start' },
    { op: 'add', kind: 'task', name: 'Check', after: 'startEvent_start' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', after: 'task_check' },
    { op: 'add', kind: 'task', name: 'Book', after: 'gateway_ok', default: true },
    { op: 'add', kind: 'endEvent', name: 'Done', after: 'task_book' },
  ];
  return (await applyToXml((await newXml({ processName: 'P' })).xml, ops)).xml.replace(/BPMN(Shape|Edge)_([A-Za-z0-9_]+)/g, '$2_di');
}

describe('flows whose ids name their ends follow them', () => {
  it('a splice renames the spliced flow, its DI edge and the default reference; the result says so', async () => {
    const xml = await drawnDefault();
    expect(xml).toContain('<bpmn:exclusiveGateway id="gateway_ok" name="Ok?" default="flow_okToBook">');
    expect(xml).toContain('<bpmndi:BPMNEdge id="flow_okToBook_di" bpmnElement="flow_okToBook">');
    const outcome = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Review', flow: 'flow_okToBook' }]);
    expect(outcome.result.created.map((change) => change.id)).toEqual(['task_review', 'flow_reviewToBook']);
    expect(outcome.result.changed.map((change) => `${change.id}: ${change.detail}`)).toContain('flow_okToReview: gateway_ok -> task_review (was -> task_book) (renamed from flow_okToBook: its id named its old ends)');
    expect(outcome.xml).toContain('<bpmn:exclusiveGateway id="gateway_ok" name="Ok?" default="flow_okToReview">');
    expect(outcome.xml).toContain('<bpmndi:BPMNEdge id="flow_okToReview_di" bpmnElement="flow_okToReview">');
    expect(outcome.xml).not.toContain('flow_okToBook');
  });

  it('a bridge, a move and set target= rename it too; every other id stays', async () => {
    const xml = await drawnDefault();
    const removed = await applyToXml(xml, [{ op: 'remove', ids: ['task_book'] }]);
    expect(removed.result.changed.map((change) => change.id)).toContain('flow_okToDone');
    expect(removed.xml).toContain('<bpmn:sequenceFlow id="flow_okToDone" sourceRef="gateway_ok" targetRef="endEvent_done" />');
    const retargeted = await applyToXml(xml, [{ op: 'set', id: 'flow_bookToDone', values: { target: 'task_check' } }]);
    expect(retargeted.xml).toContain('<bpmn:sequenceFlow id="flow_bookToCheck" sourceRef="task_book" targetRef="task_check" />');
    const moved = await applyToXml(xml, [{ op: 'move', ids: ['task_book'], before: 'task_check' }]);
    const ids = [...moved.xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)" sourceRef="([^"]+)" targetRef="([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}->${match[3]}`);
    expect(ids.sort()).toEqual(['flow_bookToCheck task_book->task_check', 'flow_checkToOk task_check->gateway_ok', 'flow_okToDone gateway_ok->endEvent_done', 'flow_startToBook startEvent_start->task_book']);
    // an explicit id that does not name its ends stays
    const own = await applyToXml(xml, [
      { op: 'connect', source: 'gateway_ok', target: 'endEvent_done', id: 'flow_shortcut', name: 'skip' },
      { op: 'add', kind: 'task', name: 'Log', flow: 'flow_shortcut' },
    ]);
    expect(own.xml).toContain('<bpmn:sequenceFlow id="flow_shortcut" name="skip" sourceRef="gateway_ok" targetRef="task_log" />');
  });

  it('a batch lists every id as it is at its end, also when a later op renamed it', async () => {
    const doc = Doc.create({ processName: 'P' });
    const cs = runOps(doc, [
      { op: 'add', kind: 'startEvent', name: 'Start' },
      { op: 'add', kind: 'endEvent', name: 'End', after: 'startEvent_start' },
      { op: 'add', kind: 'task', name: 'Work', after: 'startEvent_start' },
    ]);
    expect(cs.created.map((change) => change.id)).toEqual(['startEvent_start', 'endEvent_end', 'flow_startToWork', 'task_work', 'flow_workToEnd']);
    expect(doc.get('flow_startToEnd')).toBeUndefined();
    expect(flowBetween(doc, 'startEvent_start', 'task_work')).toBe('flow_startToWork');
  });
});

describe('the change report names a flow that took the id a renamed flow freed by its own id', () => {
  /** Check -> Done: a new node with the id task_check spliced after Check gives the flow into it flow_checkToCheck and the flow out of it flow_checkToDone, the id the spliced flow had. */
  const FREED = definitionsXml(`
    <bpmn:startEvent id="startEvent_check" name="Check"><bpmn:outgoing>flow_checkToDone</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_checkToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_checkToDone" sourceRef="startEvent_check" targetRef="endEvent_done" />`);
  const splice: EditCommand = { op: 'add', kind: 'task', id: 'task_check', after: 'startEvent_check' };

  it('text, JSON and summary agree with the file, alone and in a batch', async () => {
    for (const ops of [[splice], [{ op: 'set', id: 'flow_checkToDone', values: { name: 'go' } }, splice]] as EditCommand[][]) {
      const outcome = await applyToXml(FREED, ops, { layout: false });
      const doc = await Doc.fromXml(outcome.xml);
      expect([flowBetween(doc, 'startEvent_check', 'task_check'), flowBetween(doc, 'task_check', 'endEvent_done')]).toEqual(['flow_checkToCheck', 'flow_checkToDone']);
      expect(outcome.result.created.map((change) => `${change.id}: ${change.detail}`)).toEqual(['task_check: after startEvent_check', 'flow_checkToDone: task_check -> endEvent_done']);
      expect(outcome.result.changed.map((change) => `${change.id}: ${change.detail}`)).toContain('flow_checkToCheck: startEvent_check -> task_check (was -> endEvent_done) (renamed from flow_checkToDone: its id named its old ends)');
      // the entry of the earlier op is about the spliced flow: it names its final id
      if (ops.length === 2) expect(outcome.result.changed.map((change) => `${change.id}: ${change.detail}`)).toContain('flow_checkToCheck: name=go');
      expect(outcome.result.changed.map((change) => change.id)).not.toContain('flow_checkToDone');
      expect(outcome.result.renamed).toEqual({ flow_checkToDone: 'flow_checkToCheck' });
      const text = renderMutation(outcome.result);
      expect(text).toContain('created sequenceFlow flow_checkToDone - task_check -> endEvent_done\n');
      const summary = mutationSummary(outcome.result);
      expect([summary.created['sequenceFlow'], summary.changed, summary.renamed]).toEqual([['flow_checkToDone'], ['flow_checkToCheck'], { flow_checkToDone: 'flow_checkToCheck' }]);
      expect(renderSummary(summary)).toMatch(/^created task: task_check\ncreated sequenceFlow: flow_checkToDone\nchanged: flow_checkToCheck\nrenamed: flow_checkToDone -> flow_checkToCheck\n/);
    }
  });
});
