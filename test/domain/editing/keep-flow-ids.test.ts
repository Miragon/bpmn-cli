/**
 * Flow ids kept (issue #32): where flow ids are API (generated code, process
 * tests), `keepFlowIds` (`--keep-flow-ids`, BPMN_KEEP_FLOW_IDS) keeps the id
 * of every flow the file had when an edit changes its ends, and the change
 * names each flow whose id no longer names its ends (W_FLOW_ID_STALE, with
 * the `bpmn set` that renames it). A flow the same change created still
 * follows its ends. Synthetic fixtures only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyToXml, layoutXml, newXml } from '../../../src/api.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import type { El } from '../../../src/domain/document/utils/moddle.js';
import type { Finding } from '../../../src/domain/document/Finding.js';
import { runOp, runOps } from '../../../src/index.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import { mutateDoc, renderMutation } from '../../../src/index.js';
import type { ChangeSet } from '../../../src/domain/document/ChangeSet.js';
import { definitionsXml, flowBetween } from '../../helpers/helpers.js';

/** A file of the default style with `<id>_di` DI (`bpmn`: the engine's `BPMNShape_<id>`): start -> Check -> Ok? -> Book (default) -> Done. */
async function drawnDefault(style: 'suffix' | 'bpmn' = 'suffix'): Promise<string> {
  const ops: EditCommand[] = [
    { op: 'add', kind: 'startEvent', name: 'Start' },
    { op: 'add', kind: 'task', name: 'Check', after: 'startEvent_start' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', after: 'task_check' },
    { op: 'add', kind: 'task', name: 'Book', after: 'gateway_ok', default: true },
    { op: 'add', kind: 'endEvent', name: 'Done', after: 'task_book' },
  ];
  const xml = (await applyToXml((await newXml({ processName: 'P' })).xml, ops)).xml;
  return style === 'bpmn' ? xml : xml.replace(/BPMN(Shape|Edge)_([A-Za-z0-9_]+)/g, '$2_di');
}

/** The same chain without DI, for the ops alone. */
const CHAIN = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToCheck</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_check" name="Check"><bpmn:incoming>flow_startToCheck</bpmn:incoming><bpmn:outgoing>flow_checkToOk</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="gateway_ok" name="Ok?" default="flow_okToBook"><bpmn:incoming>flow_checkToOk</bpmn:incoming><bpmn:outgoing>flow_okToBook</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="task_book" name="Book"><bpmn:incoming>flow_okToBook</bpmn:incoming><bpmn:outgoing>flow_bookToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_bookToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToCheck" sourceRef="startEvent_start" targetRef="task_check" />
    <bpmn:sequenceFlow id="flow_checkToOk" sourceRef="task_check" targetRef="gateway_ok" />
    <bpmn:sequenceFlow id="flow_okToBook" sourceRef="gateway_ok" targetRef="task_book" />
    <bpmn:sequenceFlow id="flow_bookToDone" sourceRef="task_book" targetRef="endEvent_done" />`);

/** A split into A and B, joined before Done (remove --bridge-all of the join). */
const JOINED = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gateway_ok" name="Ok?"><bpmn:incoming>flow_startToOk</bpmn:incoming><bpmn:outgoing>flow_okToA</bpmn:outgoing><bpmn:outgoing>flow_okToB</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="task_a" name="A"><bpmn:incoming>flow_okToA</bpmn:incoming><bpmn:outgoing>flow_aToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>flow_okToB</bpmn:incoming><bpmn:outgoing>flow_bToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="gateway_join"><bpmn:incoming>flow_aToJoin</bpmn:incoming><bpmn:incoming>flow_bToJoin</bpmn:incoming><bpmn:outgoing>flow_joinToDone</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_joinToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToOk" sourceRef="startEvent_start" targetRef="gateway_ok" />
    <bpmn:sequenceFlow id="flow_okToA" sourceRef="gateway_ok" targetRef="task_a" />
    <bpmn:sequenceFlow id="flow_okToB" sourceRef="gateway_ok" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_aToJoin" sourceRef="task_a" targetRef="gateway_join" />
    <bpmn:sequenceFlow id="flow_bToJoin" sourceRef="task_b" targetRef="gateway_join" />
    <bpmn:sequenceFlow id="flow_joinToDone" sourceRef="gateway_join" targetRef="endEvent_done" />`);

/** Start -> A -> B -> C -> Done, for a move of two nodes. */
const LINE = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToA</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_a" name="A"><bpmn:incoming>flow_startToA</bpmn:incoming><bpmn:outgoing>flow_aToB</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>flow_aToB</bpmn:incoming><bpmn:outgoing>flow_bToC</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_c" name="C"><bpmn:incoming>flow_bToC</bpmn:incoming><bpmn:outgoing>flow_cToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_cToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToA" sourceRef="startEvent_start" targetRef="task_a" />
    <bpmn:sequenceFlow id="flow_aToB" sourceRef="task_a" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_bToC" sourceRef="task_b" targetRef="task_c" />
    <bpmn:sequenceFlow id="flow_cToDone" sourceRef="task_c" targetRef="endEvent_done" />`);

/** LINE with A as an exclusive gateway: a move after it appends. */
const FORKED = LINE.replace(/<bpmn:task id="task_a"(.*?)<\/bpmn:task>/, '<bpmn:exclusiveGateway id="task_a"$1</bpmn:exclusiveGateway>');

/** LINE with a second flow out of B (B -> Done): B is not bridged, so a move has no out-flow of B to put back. */
const TWO_OUT = LINE.replace('<bpmn:outgoing>flow_bToC</bpmn:outgoing>', '<bpmn:outgoing>flow_bToC</bpmn:outgoing><bpmn:outgoing>flow_bToDone</bpmn:outgoing>')
  .replace('<bpmn:incoming>flow_cToDone</bpmn:incoming>', '<bpmn:incoming>flow_cToDone</bpmn:incoming><bpmn:incoming>flow_bToDone</bpmn:incoming>')
  .replace('<bpmn:sequenceFlow id="flow_cToDone"', '<bpmn:sequenceFlow id="flow_bToDone" sourceRef="task_b" targetRef="endEvent_done" />\n    <bpmn:sequenceFlow id="flow_cToDone"');

/** LINE where B has a second flow in (A starts without one) and B -> C has a label and a condition: B is not bridged. */
const JOIN_B = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToB</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_a" name="A"><bpmn:outgoing>flow_aToB</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>flow_startToB</bpmn:incoming><bpmn:incoming>flow_aToB</bpmn:incoming><bpmn:outgoing>flow_bToC</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_c" name="C"><bpmn:incoming>flow_bToC</bpmn:incoming><bpmn:outgoing>flow_cToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_cToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToB" sourceRef="startEvent_start" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_aToB" sourceRef="task_a" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_bToC" name="approved" sourceRef="task_b" targetRef="task_c"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="flow_cToDone" sourceRef="task_c" targetRef="endEvent_done" />`);

/** Start -> X -> Done, and apart from it A -> B (A has no flow in, so it is not bridged) with a label and a condition. */
const APART = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToX</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_x" name="X"><bpmn:incoming>flow_startToX</bpmn:incoming><bpmn:outgoing>flow_xToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_xToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="task_a" name="A"><bpmn:outgoing>flow_aToB</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>flow_aToB</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="flow_startToX" sourceRef="startEvent_start" targetRef="task_x" />
    <bpmn:sequenceFlow id="flow_xToDone" sourceRef="task_x" targetRef="endEvent_done" />
    <bpmn:sequenceFlow id="flow_aToB" name="approved" sourceRef="task_a" targetRef="task_b"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>`);

/** A split into A and B, both ending in Done: Done has two flows in. */
const SHARED_END = definitionsXml(`
    <bpmn:startEvent id="startEvent_start" name="Start"><bpmn:outgoing>flow_startToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gateway_ok" name="Ok?"><bpmn:incoming>flow_startToOk</bpmn:incoming><bpmn:outgoing>flow_okToA</bpmn:outgoing><bpmn:outgoing>flow_okToB</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="task_a" name="A"><bpmn:incoming>flow_okToA</bpmn:incoming><bpmn:outgoing>flow_aToDone</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>flow_okToB</bpmn:incoming><bpmn:outgoing>flow_bToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done" name="Done"><bpmn:incoming>flow_aToDone</bpmn:incoming><bpmn:incoming>flow_bToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToOk" sourceRef="startEvent_start" targetRef="gateway_ok" />
    <bpmn:sequenceFlow id="flow_okToA" sourceRef="gateway_ok" targetRef="task_a" />
    <bpmn:sequenceFlow id="flow_okToB" sourceRef="gateway_ok" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_aToDone" sourceRef="task_a" targetRef="endEvent_done" />
    <bpmn:sequenceFlow id="flow_bToDone" sourceRef="task_b" targetRef="endEvent_done" />`);

/** A Camunda Modeler file: hashed flow ids say nothing about their ends. */
const MODELER = definitionsXml(`
    <bpmn:startEvent id="StartEvent_1" name="Order received"><bpmn:outgoing>Flow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Activity_0k3x9qa" name="Check order"><bpmn:incoming>Flow_0a1b2c3</bpmn:incoming><bpmn:outgoing>Flow_1q2w3e4</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="Event_0zz81aa" name="Order done"><bpmn:incoming>Flow_1q2w3e4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_0a1b2c3" sourceRef="StartEvent_1" targetRef="Activity_0k3x9qa" />
    <bpmn:sequenceFlow id="Flow_1q2w3e4" sourceRef="Activity_0k3x9qa" targetRef="Event_0zz81aa" />`);

const stale = (ws: readonly Finding[]): Finding[] => ws.filter((warning) => warning.code === 'W_FLOW_ID_STALE');
/** `<flow> <source>-><target> => <suggested id>` of each W_FLOW_ID_STALE. */
const staleLines = (ws: readonly Finding[]): string[] => stale(ws).map((warning) => `${warning.element} ${warning.related!.join('->')} => ${/ id=(\S+)`/.exec(warning.hint!)![1]}`);

/** Runs ops on CHAIN (or `xml`) with ids kept, without the pipeline. */
async function kept(ops: EditCommand[], xml = CHAIN): Promise<{ doc: Doc; warnings: Finding[]; renames: number; cs: ChangeSet }> {
  const doc = await Doc.fromXml(xml);
  doc.followFlowEnds = false;
  const cs = runOps(doc, ops);
  return { doc, warnings: cs.warnings, renames: cs.renames.length, cs };
}

/** The sequence flows of a change set: `created` / `removed` ids. */
const flowIds = (changes: ChangeSet['created']): string[] => changes.filter((change) => change.kind === 'sequenceFlow').map((change) => change.id);

describe('keepFlowIds: a flow the file had keeps its id and the change names it', () => {
  it('a splice keeps the flow id, its DI edge and the default reference; one W_FLOW_ID_STALE with the rename command, no renamed', async () => {
    const xml = await drawnDefault();
    const result = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Review', flow: 'flow_okToBook' }], { keepFlowIds: true });
    expect(result.result.created.map((change) => change.id)).toEqual(['task_review', 'flow_reviewToBook']);
    expect(result.result.changed.map((change) => `${change.id}: ${change.detail}`)).toContain('flow_okToBook: gateway_ok -> task_review (was -> task_book)');
    expect(result.result.changed.some((change) => change.detail?.includes('renamed from'))).toBe(false);
    expect(result.result.renamed).toBeUndefined();
    expect(result.xml).toContain('<bpmn:exclusiveGateway id="gateway_ok" name="Ok?" default="flow_okToBook">');
    expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_okToBook" sourceRef="gateway_ok" targetRef="task_review" />');
    expect(result.xml).toContain('<bpmndi:BPMNEdge id="flow_okToBook_di" bpmnElement="flow_okToBook">');
    expect(stale(result.result.warnings.added)).toEqual([
      {
        code: 'W_FLOW_ID_STALE',
        message: 'Flow flow_okToBook kept its id, which names its old ends gateway_ok -> task_book; it now runs gateway_ok -> task_review',
        element: 'flow_okToBook',
        related: ['gateway_ok', 'task_review'],
        hint: 'Code and tests that use the id keep working; to rename it together with them: `bpmn set <file> flow_okToBook id=flow_okToReview`.',
      },
    ]);
    // the hint's command renames it deliberately; nothing is stale any more
    const renamed = await applyToXml(result.xml, [{ op: 'set', id: 'flow_okToBook', values: { id: 'flow_okToReview' } }], { keepFlowIds: true });
    expect(renamed.xml).toContain('<bpmn:exclusiveGateway id="gateway_ok" name="Ok?" default="flow_okToReview">');
    expect(stale(renamed.result.warnings.added)).toEqual([]);
  });

  it('every op that changes the ends of a flow: add --after / --before / --flow / --after --before, split, remove, set source= / target=', async () => {
    const cases: Array<[EditCommand, string]> = [
      [{ op: 'add', kind: 'task', name: 'Review', after: 'task_check' }, 'flow_checkToOk task_check->task_review => flow_checkToReview'],
      [{ op: 'add', kind: 'task', name: 'Prepare', before: 'task_check' }, 'flow_startToCheck startEvent_start->task_prepare => flow_startToPrepare'],
      [{ op: 'add', kind: 'task', name: 'Review', flow: 'flow_okToBook' }, 'flow_okToBook gateway_ok->task_review => flow_okToReview'],
      [{ op: 'add', kind: 'task', name: 'Review', after: 'task_check', before: 'gateway_ok' }, 'flow_checkToOk task_check->task_review => flow_checkToReview'],
      [{ op: 'split', after: 'task_check', name: 'Valid?', branches: [{ nodes: [{ kind: 'task', name: 'Fix' }] }, { nodes: [] }] }, 'flow_checkToOk task_check->gateway_valid => flow_checkToValid'],
      [{ op: 'remove', ids: ['task_book'] }, 'flow_okToBook gateway_ok->endEvent_done => flow_okToDone'],
      [{ op: 'set', id: 'flow_bookToDone', values: { target: 'task_check' } }, 'flow_bookToDone task_book->task_check => flow_bookToCheck'],
      [{ op: 'set', id: 'flow_bookToDone', values: { source: 'task_check' } }, 'flow_bookToDone task_check->endEvent_done => flow_checkToDone'],
    ];
    for (const [op, line] of cases) {
      const result = await kept([op]);
      expect(staleLines(result.warnings), JSON.stringify(op)).toEqual([line]);
      expect(result.renames, JSON.stringify(op)).toBe(0);
      const flow = line.split(' ')[0]!;
      const [source, target] = line.split(' ')[1]!.split('->');
      expect(flowBetween(result.doc, source!, target!)).toBe(flow);
    }
  });

  it('a move keeps the bridge at its old place, the splice at its new one and the node\'s out-flow, put back there; remove --bridge-all one per predecessor', async () => {
    const moved = await kept([{ op: 'move', ids: ['task_book'], before: 'task_check' }]);
    expect(staleLines(moved.warnings).sort()).toEqual([
      'flow_bookToDone task_book->task_check => flow_bookToCheck',
      'flow_okToBook gateway_ok->endEvent_done => flow_okToDone',
      'flow_startToCheck startEvent_start->task_book => flow_startToBook',
    ]);
    // Book's out-flow is its out-flow at the new place: changed, neither removed nor created
    expect(flowBetween(moved.doc, 'task_book', 'task_check')).toBe('flow_bookToDone');
    expect([flowIds(moved.cs.created), flowIds(moved.cs.removed)]).toEqual([[], []]);
    expect(moved.cs.changed.map((change) => `${change.id}: ${change.detail}`)).toContain('flow_bookToDone: task_book -> task_check (was -> endEvent_done)');
    const bridged = await kept([{ op: 'remove', ids: ['gateway_join'], bridgeAll: true }], JOINED);
    expect(staleLines(bridged.warnings)).toEqual(['flow_aToJoin task_a->endEvent_done => flow_aToDone', 'flow_bToJoin task_b->endEvent_done => flow_bToDone']);
  });

  it('nodes moved together keep the flow between them, also when they are appended; later ops of the batch use every id', async () => {
    const result = await applyToXml(LINE, [
      { op: 'move', ids: ['task_b', 'task_c'], after: 'startEvent_start' },
      { op: 'set', id: 'flow_bToC', values: { name: 'go' } },
    ], { keepFlowIds: true, layout: false });
    expect([flowIds(result.result.created), flowIds(result.result.removed)]).toEqual([[], []]);
    expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_bToC" name="go" sourceRef="task_b" targetRef="task_c" />');
    // B -> C runs between its old ends again: no warning for it
    expect(staleLines(result.result.warnings.added).sort()).toEqual([
      'flow_aToB task_a->endEvent_done => flow_aToDone',
      'flow_cToDone task_c->task_a => flow_cToA',
      'flow_startToA startEvent_start->task_b => flow_startToB',
    ]);
    // after a gateway B is appended (a new flow into it); C is appended to B through B's old out-flow, C's has no place
    const appended = await kept([{ op: 'move', ids: ['task_b', 'task_c'], after: 'task_a' }], FORKED);
    expect(flowBetween(appended.doc, 'task_b', 'task_c')).toBe('flow_bToC');
    expect([flowIds(appended.cs.created), flowIds(appended.cs.removed)]).toEqual([['flow_aToB2'], ['flow_cToDone']]);
    expect(staleLines(appended.warnings)).toEqual(['flow_aToB task_a->endEvent_done => flow_aToDone']);
  });

  it('nodes moved together keep the flow between them when the second is not bridged: an end event, a join', async () => {
    // C is put back where it was, then Done: Done has no flow out, so C -> Done is taken out and put back by the append
    const tail = await applyToXml(LINE, [{ op: 'move', ids: ['task_c', 'endEvent_done'], after: 'task_b' }], { keepFlowIds: true, layout: false });
    expect([flowIds(tail.result.created), flowIds(tail.result.removed)]).toEqual([[], []]);
    expect(tail.result.warnings.added.map((warning) => warning.code)).toEqual([]);
    expect(tail.xml).toContain('<bpmn:sequenceFlow id="flow_cToDone" sourceRef="task_c" targetRef="endEvent_done" />');
    // Done has two flows in: B -> Done is removed like every other flow of a node that is not bridged, A -> Done stays A's
    const shared = await kept([{ op: 'move', ids: ['task_a', 'endEvent_done'], after: 'task_b' }], SHARED_END);
    expect(flowBetween(shared.doc, 'task_a', 'endEvent_done')).toBe('flow_aToDone');
    expect([flowIds(shared.cs.created), flowIds(shared.cs.removed)]).toEqual([[], ['flow_okToA']]);
    expect(shared.warnings.map((warning) => warning.code)).not.toContain('W_ID_SUFFIXED');
    // a gateway first: the next node is appended to it (a new branch), so its out-flow waits for that append
    const gateway = await kept([{ op: 'move', ids: ['gateway_ok', 'task_book'], after: 'startEvent_start' }]);
    expect(flowBetween(gateway.doc, 'gateway_ok', 'task_book')).toBe('flow_okToBook');
    expect([flowIds(gateway.cs.created), flowIds(gateway.cs.removed)]).toEqual([['flow_okToCheck'], ['flow_bookToDone']]);
    // the flow keeps what it had: the name the prepend gave A -> Join, before the join moves after A
    const named = await kept([{ op: 'move', ids: ['task_a', 'gateway_join'], before: 'gateway_join', flowName: 'done' }], JOINED);
    expect(flowBetween(named.doc, 'task_a', 'gateway_join')).toBe('flow_aToJoin');
    expect(named.doc.get('flow_aToJoin')!.get('name')).toBe('done');
    expect(flowIds(named.cs.created)).toEqual([]);
  });

  it('a moved node that is not bridged puts its out-flow back without the label and condition no bridge took, and says so; between its old ends it keeps them', async () => {
    const result = await applyToXml(JOIN_B, [{ op: 'move', ids: ['task_b'], after: 'task_c' }], { keepFlowIds: true, layout: false });
    expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_bToC" sourceRef="task_b" targetRef="endEvent_done" />');
    const dropped = result.result.warnings.added.filter((warning) => warning.code === 'W_LABEL_DROPPED' || warning.code === 'W_CONDITION_DROPPED');
    expect(dropped.map((warning) => `${warning.code} ${warning.element}: ${warning.message}`)).toEqual([
      'W_LABEL_DROPPED flow_bToC: Flow label "approved" of flow_bToC was dropped while moving task_b: task_b was not bridged, so nothing at its old place took it, and flow_bToC was put back at its new place without it',
      'W_CONDITION_DROPPED flow_bToC: Condition of flow_bToC was dropped while moving task_b: task_b was not bridged, so nothing at its old place took it, and flow_bToC was put back at its new place without it',
    ]);
    // B before C: flow_bToC is put back between its old ends, with its label and condition
    const same = await applyToXml(JOIN_B, [{ op: 'move', ids: ['task_b'], before: 'task_c' }], { keepFlowIds: true, layout: false });
    expect(same.xml).toMatch(/<bpmn:sequenceFlow id="flow_bToC" name="approved" sourceRef="task_b" targetRef="task_c">\s*<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{approved\}<\/bpmn:conditionExpression>/);
    expect(same.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LABEL_DROPPED');
    // a bridged node: the bridge takes both (A -> C), nothing is dropped
    const bridged = await applyToXml(LINE.replace('id="flow_bToC" sourceRef', 'id="flow_bToC" name="approved" sourceRef'), [{ op: 'move', ids: ['task_b'], after: 'task_c' }], { keepFlowIds: true, layout: false });
    expect(bridged.xml).toContain('<bpmn:sequenceFlow id="flow_aToB" name="approved" sourceRef="task_a" targetRef="task_c" />');
    expect(bridged.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LABEL_DROPPED');
    // by default the flow is removed and the change names it with its label, as before
    const renamed = await applyToXml(JOIN_B, [{ op: 'move', ids: ['task_b'], after: 'task_c' }], { layout: false });
    expect(renamed.result.removed).toContainEqual({ id: 'flow_bToC', kind: 'sequenceFlow', name: 'approved', detail: 'task_b -> task_c' });
    expect(renamed.result.warnings.added.map((warning) => warning.code)).not.toContain('W_LABEL_DROPPED');
  });

  it('a chain whose first node is not bridged: the flow to the next node, put back elsewhere and then between its old ends again, gets its label back', async () => {
    // A's splice puts A -> B back as A -> Done, B's splice after A ends it at B again
    const result = await applyToXml(APART, [{ op: 'move', ids: ['task_a', 'task_b'], after: 'task_x' }], { keepFlowIds: true, layout: false });
    expect(result.xml).toMatch(/<bpmn:sequenceFlow id="flow_aToB" name="approved" sourceRef="task_a" targetRef="task_b">\s*<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{approved\}<\/bpmn:conditionExpression>/);
    expect(result.result.warnings.added.map((warning) => warning.code)).toEqual(['W_FLOW_ID_STALE']);
    expect(result.result.changed.filter((change) => change.id === 'flow_aToB')).toEqual([{ id: 'flow_aToB', kind: 'sequenceFlow', name: 'approved', detail: 'task_a -> task_b' }]);
    // its default marker comes back the same way
    const marked = APART.replace('<bpmn:task id="task_a" name="A">', '<bpmn:task id="task_a" name="A" default="flow_aToB">').replace(/<bpmn:conditionExpression.*?<\/bpmn:conditionExpression>/, '');
    const def = await kept([{ op: 'move', ids: ['task_a', 'task_b'], after: 'task_x' }], marked);
    expect(def.doc.get('task_a')!.get<El>('default')).toBe(def.doc.get('flow_aToB'));
    expect(def.warnings.map((warning) => warning.code)).toEqual(['W_FLOW_ID_STALE']);
  });

  it('a put-back default flow never carries a condition, and a default the placement gave wins over the marker the flow had', async () => {
    // B (two flows in, not bridged) before C, its old target: the prepend makes flow_bToC the default flow, so its condition stays dropped
    const result = await applyToXml(JOIN_B, [{ op: 'move', ids: ['task_b'], before: 'task_c', default: true }], { keepFlowIds: true, layout: false });
    expect(result.xml).toContain('<bpmn:task id="task_b" name="B" default="flow_bToC">');
    expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_bToC" name="approved" sourceRef="task_b" targetRef="task_c" />');
    expect(result.result.warnings.added.filter((warning) => warning.code === 'W_CONDITION_DROPPED').map((warning) => warning.message)).toEqual([
      'Condition of flow_bToC was dropped while moving task_b: flow_bToC is now the default flow of task_b',
    ]);
    // the join's default flow comes back to Done, but the prepend made Join -> Archive the default, as asked (as by default)
    const archive = JOINED.replace('<bpmn:exclusiveGateway id="gateway_join">', '<bpmn:exclusiveGateway id="gateway_join" default="flow_joinToDone">')
      .replace('<bpmn:endEvent id="endEvent_done"', '<bpmn:task id="task_archive" name="Archive" />\n    <bpmn:endEvent id="endEvent_done"');
    const ops: EditCommand[] = [{ op: 'move', ids: ['gateway_join', 'endEvent_done'], before: 'task_archive', default: true }];
    const wins = await kept(ops, archive);
    expect(flowBetween(wins.doc, 'gateway_join', 'endEvent_done')).toBe('flow_joinToDone');
    expect(wins.doc.get('gateway_join')!.get<El>('default')).toBe(wins.doc.get('flow_joinToArchive'));
    expect(wins.cs.changed.filter((change) => change.id === 'flow_joinToDone').map((change) => change.detail)).toEqual(['gateway_join -> endEvent_done (no longer the default flow of gateway_join)']);
    expect((await applyToXml(archive, ops, { layout: false })).xml).toContain('<bpmn:exclusiveGateway id="gateway_join" default="flow_joinToArchive">');
  });

  it('none for a hashed id, an id that did not name its ends, ends a later op restored, or a flow a later op removed', async () => {
    const hashed = await kept([{ op: 'add', kind: 'task', name: 'Pack', after: 'Activity_0k3x9qa' }], MODELER);
    expect(stale(hashed.warnings)).toEqual([]);
    expect(flowBetween(hashed.doc, 'Activity_0k3x9qa', 'task_pack')).toBe('Flow_1q2w3e4');
    const own = await kept([
      { op: 'connect', source: 'gateway_ok', target: 'endEvent_done', id: 'flow_shortcut', name: 'skip' },
      { op: 'add', kind: 'task', name: 'Log', flow: 'flow_shortcut' },
    ]);
    expect(stale(own.warnings)).toEqual([]);
    // add, then remove the new node: the bridge puts the flow back between its old ends
    const restored = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'remove', ids: ['task_review'] },
    ]);
    expect(stale(restored.warnings)).toEqual([]);
    expect(flowBetween(restored.doc, 'task_check', 'gateway_ok')).toBe('flow_checkToOk');
    // flow_checkToOk goes stale, then goes with task_check; the bridge of that remove makes flow_startToCheck stale
    const gone = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'remove', ids: ['task_check'] },
    ]);
    expect(staleLines(gone.warnings)).toEqual(['flow_startToCheck startEvent_start->task_review => flow_startToReview']);
  });

  it('a flow created earlier in the same change follows its ends; one warning per flow, against its final ends', async () => {
    const result = await applyToXml(await drawnDefault(), [
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'add', kind: 'task', name: 'Approve', after: 'task_review' },
      { op: 'add', kind: 'task', name: 'Archive', before: 'task_review' },
    ], { keepFlowIds: true });
    // flow_reviewToOk (made by the first op) was spliced by the second: renamed after its new ends, listed under its final id
    expect(result.result.created.map((change) => change.id)).toEqual(['task_review', 'flow_reviewToApprove', 'task_approve', 'flow_approveToOk', 'task_archive', 'flow_archiveToReview']);
    expect(result.result.renamed).toBeUndefined();
    // flow_checkToOk was spliced twice (Check -> Review, then Check -> Archive): one warning, its first ends and its last
    expect(stale(result.result.warnings.added).map((warning) => warning.message)).toEqual(['Flow flow_checkToOk kept its id, which names its old ends task_check -> gateway_ok; it now runs task_check -> task_archive']);
  });

  it('a flow the same change renames with `set id=` takes that id; a later splice names the ends that id named', async () => {
    const chosen = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'set', id: 'flow_checkToOk', values: { id: 'flow_toReview' } },
    ]);
    expect(stale(chosen.warnings)).toEqual([]);
    const spliced = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'set', id: 'flow_checkToOk', values: { id: 'flow_checkToReview' } },
      { op: 'add', kind: 'task', name: 'Archive', after: 'task_check' },
    ]);
    expect(stale(spliced.warnings).map((warning) => warning.message)).toEqual(['Flow flow_checkToReview kept its id, which names its old ends task_check -> task_review; it now runs task_check -> task_archive']);
  });

  it('the default renames as before and never warns', async () => {
    const result = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Review', after: 'task_check' }]);
    expect(result.result.renamed).toEqual({ flow_checkToOk: 'flow_checkToReview' });
    expect(stale(result.result.warnings.added)).toEqual([]);
    const off = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Review', after: 'task_check' }], { keepFlowIds: false });
    expect(off.result.renamed).toEqual({ flow_checkToOk: 'flow_checkToReview' });
  });
});

describe('keepFlowIds in the library: the option, Doc.followFlowEnds and the report', () => {
  it('an explicit option wins over Doc.followFlowEnds, which is the caller\'s again afterwards (also after a refusal)', async () => {
    const doc = await Doc.fromXml(CHAIN);
    doc.followFlowEnds = false;
    const renamed = await mutateDoc(doc, [{ op: 'add', kind: 'task', name: 'Review', after: 'task_check' }], { keepFlowIds: false, layout: false });
    expect(renamed.changes.renames.map((result) => `${result.from} -> ${result.to}`)).toEqual(['flow_checkToOk -> flow_checkToReview']);
    expect(doc.followFlowEnds).toBe(false);
    // undefined: the field decides
    const keptDoc = await Doc.fromXml(CHAIN);
    keptDoc.followFlowEnds = false;
    const kept = await mutateDoc(keptDoc, [{ op: 'add', kind: 'task', name: 'Review', after: 'task_check' }], { layout: false });
    expect(stale(kept.changes.warnings).map((warning) => warning.element)).toEqual(['flow_checkToOk']);
    const fresh = await Doc.fromXml(CHAIN);
    await expect(mutateDoc(fresh, [{ op: 'add', kind: 'task', name: 'Review', after: 'task_nope' }], { keepFlowIds: true, layout: false })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect(fresh.followFlowEnds).toBe(true);
  });

  it('runOp on its own reports the flow it kept, like a batch', async () => {
    const doc = await Doc.fromXml(CHAIN);
    doc.followFlowEnds = false;
    const cs = runOp(doc, { op: 'remove', ids: ['task_book'] });
    expect(staleLines(cs.warnings)).toEqual(['flow_okToBook gateway_ok->endEvent_done => flow_okToDone']);
  });

  it('a flow the op or an earlier op of the batch created follows its ends, with runOp on its own too', async () => {
    const move: EditCommand = { op: 'move', ids: ['task_b', 'task_c'], after: 'startEvent_start' };
    const alone = await Doc.fromXml(TWO_OUT);
    alone.followFlowEnds = false;
    const single = runOp(alone, move);
    // B had two out-flows (not bridged, removed): the move made flow_bToA, then spliced it to B -> C
    expect(single.renames.map((result) => `${result.from} -> ${result.to}`)).toEqual(['flow_bToA -> flow_bToC2']);
    expect(staleLines(single.warnings).sort()).toEqual(['flow_cToDone task_c->task_a => flow_cToA', 'flow_startToA startEvent_start->task_b => flow_startToB']);
    const batch = await kept([move], TWO_OUT);
    expect(staleLines(batch.warnings).sort()).toEqual(staleLines(single.warnings).sort());
    // 0.6 kept every id with Doc.followFlowEnds = false; now only the flows the document had
    const doc = await Doc.fromXml(CHAIN);
    doc.followFlowEnds = false;
    const cs = runOps(doc, [
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'add', kind: 'task', name: 'Approve', after: 'task_review' },
    ]);
    expect(cs.renames.map((result) => `${result.from} -> ${result.to}`)).toEqual(['flow_reviewToOk -> flow_reviewToApprove']);
    expect(cs.created.map((change) => change.id)).toContain('flow_reviewToApprove');
  });

  it('only the change reports it (warnings.added, never counted as the file\'s); text gives each stale flow its own line', async () => {
    const result = await applyToXml(await drawnDefault(), [
      { op: 'add', kind: 'task', name: 'Review', after: 'task_check' },
      { op: 'add', kind: 'task', name: 'Prepare', before: 'task_check' },
      { op: 'add', kind: 'task', name: 'Pay', after: 'task_book' },
    ], { keepFlowIds: true });
    expect(staleLines(result.result.warnings.added).sort()).toEqual([
      'flow_bookToDone task_book->task_pay => flow_bookToPay',
      'flow_checkToOk task_check->task_review => flow_checkToReview',
      'flow_startToCheck startEvent_start->task_prepare => flow_startToPrepare',
    ]);
    expect(result.result.warnings.preexistingCount).toBe(0);
    const text = renderMutation(result.result);
    expect(text.match(/^warning W_FLOW_ID_STALE /gm)).toHaveLength(3);
    for (const cmd of ['id=flow_bookToPay', 'id=flow_checkToReview', 'id=flow_startToPrepare']) expect(text).toContain(cmd);
    // the next, unrelated change does not repeat it
    const next = await applyToXml(result.xml, [{ op: 'set', id: 'task_pay', values: { name: 'Pay invoice' } }], { keepFlowIds: true });
    expect(stale(next.result.warnings.added)).toEqual([]);
    expect(next.result.warnings.preexistingCount).toBe(0);
  });

  it('a later change that leaves a stale flow where it was does not repeat it, although the flow passes its old ends on the way', async () => {
    const first = await applyToXml(LINE, [{ op: 'add', kind: 'task', name: 'X', after: 'task_a' }], { keepFlowIds: true, layout: false });
    expect(staleLines(first.result.warnings.added)).toEqual(['flow_aToB task_a->task_x => flow_aToX']);
    // moving X away and back: the bridge runs flow_aToB A -> B (the ends its id names), the splice A -> X again
    const away: EditCommand[] = [{ op: 'move', ids: ['task_x'], after: 'task_c' }, { op: 'move', ids: ['task_x'], after: 'task_a' }];
    const again = await applyToXml(first.xml, away, { keepFlowIds: true, layout: false });
    expect(stale(again.result.warnings.added)).toEqual([]);
    const doc = await Doc.fromXml(first.xml);
    doc.followFlowEnds = false;
    expect(stale(runOps(doc, away).warnings)).toEqual([]);
    // a later op of the same change that gives it other ends again reports it
    const moved = await kept([...away, { op: 'add', kind: 'task', name: 'Y', after: 'task_a' }], first.xml);
    expect(staleLines(moved.warnings)).toEqual(['flow_aToB task_a->task_y => flow_aToY']);
  });
});

describe('an end renamed or named earlier in the change, and --flow-id on a splice', () => {
  /** CHAIN with a Camunda Modeler id for Check (its id says nothing: it is named by its name) and an unnamed Done. */
  const HASHED = CHAIN.replace(/task_check/g, 'Activity_0abc123').replace('<bpmn:endEvent id="endEvent_done" name="Done">', '<bpmn:endEvent id="endEvent_done">');

  /** `old -> new` of the renames by default, and `flow source->target => suggested id` of each W_FLOW_ID_STALE with ids kept. */
  async function bothModes(xml: string, ops: EditCommand[]): Promise<{ renamed: string[]; stale: string[] }> {
    const follow = await Doc.fromXml(xml);
    const renamed = runOps(follow, ops).renames.map((result) => `${result.from} -> ${result.to}`);
    const keep = await kept(ops, xml);
    expect(keep.renames).toBe(0);
    return { renamed, stale: staleLines(keep.warnings) };
  }

  it('an end `set id=` gave another id earlier in the batch: its flows follow, or with ids kept are reported, by default and with ids kept', async () => {
    const renamedThenSpliced = await bothModes(CHAIN, [
      { op: 'set', id: 'task_check', values: { id: 'task_verify' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'task_verify' },
    ]);
    expect(renamedThenSpliced).toEqual({ renamed: ['flow_checkToOk -> flow_verifyToLog'], stale: ['flow_checkToOk task_verify->task_log => flow_verifyToLog'] });
    // --flow names the flow by its id, the target end too
    expect(await bothModes(CHAIN, [
      { op: 'set', id: 'gateway_ok', values: { id: 'gateway_approved' } },
      { op: 'add', kind: 'task', name: 'Audit', flow: 'flow_checkToOk' },
    ])).toEqual({ renamed: ['flow_checkToOk -> flow_checkToAudit'], stale: ['flow_checkToOk task_check->task_audit => flow_checkToAudit'] });
    // an unnamed end: only the id it had tells (flow_bookToDone, Done renamed Finished); a remove bridges to it
    expect(await bothModes(HASHED, [
      { op: 'set', id: 'endEvent_done', values: { id: 'endEvent_finished' } },
      { op: 'add', kind: 'task', name: 'Log', before: 'endEvent_finished' },
    ])).toEqual({ renamed: ['flow_bookToDone -> flow_bookToLog'], stale: ['flow_bookToDone task_book->task_log => flow_bookToLog'] });
    expect(await bothModes(HASHED, [
      { op: 'set', id: 'endEvent_done', values: { id: 'endEvent_finished' } },
      { op: 'remove', ids: ['task_book'] },
    ])).toEqual({ renamed: ['flow_okToBook -> flow_okToFinished'], stale: ['flow_okToBook gateway_ok->endEvent_finished => flow_okToFinished'] });
  });

  it('an end `set name=` named again (its id says nothing), and `set id=` in a command before (the end keeps its name): the same', async () => {
    expect(await bothModes(HASHED, [
      { op: 'set', id: 'Activity_0abc123', values: { name: 'Verify' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'Activity_0abc123' },
    ])).toEqual({ renamed: ['flow_checkToOk -> flow_verifyToLog'], stale: ['flow_checkToOk Activity_0abc123->task_log => flow_verifyToLog'] });
    // two commands: the first renames Check, the second splices after it; Check is still named Check
    const first = await applyToXml(await drawnDefault(), [{ op: 'set', id: 'task_check', values: { id: 'task_verify' } }]);
    expect(first.xml).toContain('<bpmn:sequenceFlow id="flow_checkToOk" sourceRef="task_verify" targetRef="gateway_ok" />');
    const splice: EditCommand[] = [{ op: 'add', kind: 'task', name: 'Log', after: 'task_verify' }];
    const renamed = await applyToXml(first.xml, splice);
    expect(renamed.result.renamed).toEqual({ flow_checkToOk: 'flow_verifyToLog' });
    expect(renamed.xml).toContain('<bpmndi:BPMNEdge id="flow_verifyToLog_di" bpmnElement="flow_verifyToLog">');
    const keptIds = await applyToXml(first.xml, splice, { keepFlowIds: true });
    expect(staleLines(keptIds.result.warnings.added)).toEqual(['flow_checkToOk task_verify->task_log => flow_verifyToLog']);
    // the warning's command renames it; nothing is stale afterwards
    const followed = await applyToXml(keptIds.xml, [{ op: 'set', id: 'flow_checkToOk', values: { id: 'flow_verifyToLog' } }], { keepFlowIds: true });
    expect(stale(followed.result.warnings.added)).toEqual([]);
  });

  it('a retype between the `set` and the end change (a new element of the new type) keeps what the end was called', async () => {
    for (const retype of [{ op: 'retype', id: 'Activity_0abc123', kind: 'userTask' }, { op: 'retype', id: 'Activity_0abc123', kind: 'serviceTask' }] as EditCommand[]) {
      expect(await bothModes(HASHED, [
        { op: 'set', id: 'Activity_0abc123', values: { name: 'Verify' } },
        retype,
        { op: 'add', kind: 'task', name: 'Log', after: 'Activity_0abc123' },
      ])).toEqual({ renamed: ['flow_checkToOk -> flow_verifyToLog'], stale: ['flow_checkToOk Activity_0abc123->task_log => flow_verifyToLog'] });
    }
  });

  it('a renamed end changes nothing else: flows whose ends stay keep their ids, and a flow whose id names no ends stays', async () => {
    // Book is renamed, the splice is after Check: flow_checkToOk follows as always, flow_okToBook and flow_bookToDone keep their ids
    const result = await bothModes(CHAIN, [
      { op: 'set', id: 'task_book', values: { id: 'task_post', name: 'Post' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'task_check' },
    ]);
    expect(result).toEqual({ renamed: ['flow_checkToOk -> flow_checkToLog'], stale: ['flow_checkToOk task_check->task_log => flow_checkToLog'] });
    const own = await bothModes(CHAIN.replace(/flow_checkToOk/g, 'flow_review'), [
      { op: 'set', id: 'task_check', values: { id: 'task_verify' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'task_verify' },
    ]);
    expect(own).toEqual({ renamed: [], stale: [] });
  });

  it('--flow-id on a splice with ids kept: W_FLOW_ID_STALE suggests it, W_OPTION_IGNORED names no second command, and every hint can be followed', async () => {
    for (const placement of [{ flow: 'flow_checkToOk' }, { after: 'task_check' }]) {
      const result = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Audit', ...placement, flowId: 'flow_intoAudit' }], { keepFlowIds: true });
      const ignored = result.result.warnings.added.filter((warning) => warning.code === 'W_OPTION_IGNORED');
      expect(ignored.map((warning) => warning.hint)).toEqual(['--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); W_FLOW_ID_STALE names the command that renames flow_checkToOk.']);
      expect(staleLines(result.result.warnings.added)).toEqual(['flow_checkToOk task_check->task_audit => flow_intoAudit']);
      // every command the warnings name, in order: one per flow, none fails
      const commands = result.result.warnings.added.flatMap((warning) => [...(warning.hint ?? '').matchAll(/`bpmn set <file> (\S+) id=(\S+)`/g)]);
      expect(commands.map((command) => `${command[1]} -> ${command[2]}`)).toEqual(['flow_checkToOk -> flow_intoAudit']);
      const followed = await applyToXml(result.xml, commands.map((command) => ({ op: 'set', id: command[1]!, values: { id: command[2]! } })), { keepFlowIds: true });
      expect(followed.xml).toContain('<bpmn:sequenceFlow id="flow_intoAudit" sourceRef="task_check" targetRef="task_audit" />');
    }
    // by default the flow follows its ends and W_OPTION_IGNORED names the one rename, as before
    const renamed = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Audit', flow: 'flow_checkToOk', flowId: 'flow_intoAudit' }]);
    expect(renamed.result.warnings.added.map((warning) => `${warning.code}: ${warning.hint}`)).toEqual([
      'W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); rename the existing one with `bpmn set <file> flow_checkToAudit id=flow_intoAudit`.',
    ]);
  });

  it('--flow-id with ids kept: a taken id, a later splice into the same flow or a flow that does not name its ends give the id its ends give, or the old command', async () => {
    // taken: the speaking id
    const taken = await kept([{ op: 'add', kind: 'task', name: 'Audit', flow: 'flow_checkToOk', flowId: 'flow_startToCheck' }]);
    expect(staleLines(taken.warnings)).toEqual(['flow_checkToOk task_check->task_audit => flow_checkToAudit']);
    // the flow no longer ends at Audit: Log was put in between, so --flow-id no longer describes it
    const later = await kept([
      { op: 'add', kind: 'task', name: 'Audit', flow: 'flow_checkToOk', flowId: 'flow_intoAudit' },
      { op: 'add', kind: 'task', name: 'Log', after: 'task_check' },
    ]);
    expect(staleLines(later.warnings)).toEqual(['flow_checkToOk task_check->task_log => flow_checkToLog']);
    // a hashed flow keeps its id without going stale: W_OPTION_IGNORED keeps its own command
    const hashed = await kept([{ op: 'add', kind: 'task', name: 'Pack', after: 'Activity_0k3x9qa', flowId: 'flow_intoPack' }], MODELER);
    expect(hashed.warnings.map((warning) => `${warning.code}: ${warning.hint}`)).toEqual([
      'W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); rename the existing one with `bpmn set <file> Flow_1q2w3e4 id=flow_intoPack`.',
    ]);
  });

  it('--flow-id with ids kept where no W_FLOW_ID_STALE comes: W_OPTION_IGNORED names its own command, or none where it could not be followed', async () => {
    const hints = (ws: readonly Finding[]): string[] => ws.map((warning) => `${warning.code}: ${warning.hint}`);
    const own = (flow: string, id: string): string =>
      `W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); rename the existing one with \`bpmn set <file> ${flow} id=${id}\`.`;
    const none = 'W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node).';
    // the kept flow still names its new ends: a task named Ok before the gateway Ok?, an unnamed gateway before the unnamed Gateway_1
    expect(hints((await kept([{ op: 'add', kind: 'task', name: 'Ok', flow: 'flow_checkToOk', flowId: 'flow_intoOk' }])).warnings)).toEqual([own('flow_checkToOk', 'flow_intoOk')]);
    const unnamed = CHAIN.replace('<bpmn:exclusiveGateway id="gateway_ok" name="Ok?"', '<bpmn:exclusiveGateway id="Gateway_1"').replace(/gateway_ok/g, 'Gateway_1').replace(/flow_checkToOk/g, 'flow_checkToGateway');
    expect(hints((await kept([{ op: 'add', kind: 'parallelGateway', flow: 'flow_checkToGateway', flowId: 'flow_intoFork' }], unnamed)).warnings)).toEqual([own('flow_checkToGateway', 'flow_intoFork')]);
    // a later op puts the flow back between its old ends (it was not made stale)
    const putBack = await kept([
      { op: 'add', kind: 'task', name: 'Audit', flow: 'flow_checkToOk', flowId: 'flow_intoAudit', as: '$a' },
      { op: 'remove', ids: ['$a'] },
    ]);
    expect(hints(putBack.warnings)).toEqual([own('flow_checkToOk', 'flow_intoAudit')]);
    // a later op renames the flow, or takes the --flow-id: no command that would fail
    const renamed = await kept([
      { op: 'add', kind: 'task', name: 'Audit', flow: 'flow_checkToOk', flowId: 'flow_intoAudit' },
      { op: 'set', id: 'flow_checkToOk', values: { id: 'flow_review' } },
    ]);
    expect(hints(renamed.warnings)).toEqual([none]);
    const taken = await kept([
      { op: 'add', kind: 'task', name: 'Ok', flow: 'flow_checkToOk', flowId: 'flow_intoOk' },
      { op: 'add', kind: 'task', id: 'flow_intoOk', name: 'X', in: 'Process_1' },
    ]);
    expect(hints(taken.warnings).filter((hint) => hint.startsWith('W_OPTION_IGNORED'))).toEqual([none]);
  });
});

/** LINE where B -> C has a label and a condition. */
const NAMED_LINE = LINE.replace(
  '<bpmn:sequenceFlow id="flow_bToC" sourceRef="task_b" targetRef="task_c" />',
  '<bpmn:sequenceFlow id="flow_bToC" name="approved" sourceRef="task_b" targetRef="task_c"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>',
);

/** Start -> T -> Sub (SubStart -> Inner -> SubEnd) -> Done. */
const WITH_SUB = definitionsXml(`
    <bpmn:startEvent id="startEvent_start"><bpmn:outgoing>flow_startToT</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_t" name="T"><bpmn:incoming>flow_startToT</bpmn:incoming><bpmn:outgoing>flow_tToSub</bpmn:outgoing></bpmn:task>
    <bpmn:subProcess id="subProcess_sub" name="Sub"><bpmn:incoming>flow_tToSub</bpmn:incoming><bpmn:outgoing>flow_subToDone</bpmn:outgoing>
      <bpmn:startEvent id="startEvent_subStart"><bpmn:outgoing>flow_subStartToInner</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="task_inner" name="Inner"><bpmn:incoming>flow_subStartToInner</bpmn:incoming><bpmn:outgoing>flow_innerToSubEnd</bpmn:outgoing></bpmn:task>
      <bpmn:endEvent id="endEvent_subEnd"><bpmn:incoming>flow_innerToSubEnd</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="flow_subStartToInner" sourceRef="startEvent_subStart" targetRef="task_inner" />
      <bpmn:sequenceFlow id="flow_innerToSubEnd" sourceRef="task_inner" targetRef="endEvent_subEnd" />
    </bpmn:subProcess>
    <bpmn:endEvent id="endEvent_done"><bpmn:incoming>flow_subToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToT" sourceRef="startEvent_start" targetRef="task_t" />
    <bpmn:sequenceFlow id="flow_tToSub" sourceRef="task_t" targetRef="subProcess_sub" />
    <bpmn:sequenceFlow id="flow_subToDone" sourceRef="subProcess_sub" targetRef="endEvent_done" />`);

/** Start -> A -> T -> Done; a timer on T leads to Remind -> Late. */
const WITH_TIMER = definitionsXml(`
    <bpmn:startEvent id="startEvent_start"><bpmn:outgoing>flow_startToA</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task_a" name="A"><bpmn:incoming>flow_startToA</bpmn:incoming><bpmn:outgoing>flow_aToT</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_t" name="T"><bpmn:incoming>flow_aToT</bpmn:incoming><bpmn:outgoing>flow_tToDone</bpmn:outgoing></bpmn:task>
    <bpmn:boundaryEvent id="event_timeout" attachedToRef="task_t"><bpmn:outgoing>flow_timeoutToRemind</bpmn:outgoing><bpmn:timerEventDefinition id="TimerEventDefinition_Timeout" /></bpmn:boundaryEvent>
    <bpmn:task id="task_remind" name="Remind"><bpmn:incoming>flow_timeoutToRemind</bpmn:incoming><bpmn:outgoing>flow_remindToLate</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done"><bpmn:incoming>flow_tToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="endEvent_late"><bpmn:incoming>flow_remindToLate</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToA" sourceRef="startEvent_start" targetRef="task_a" />
    <bpmn:sequenceFlow id="flow_aToT" sourceRef="task_a" targetRef="task_t" />
    <bpmn:sequenceFlow id="flow_tToDone" sourceRef="task_t" targetRef="endEvent_done" />
    <bpmn:sequenceFlow id="flow_timeoutToRemind" sourceRef="event_timeout" targetRef="task_remind" />
    <bpmn:sequenceFlow id="flow_remindToLate" sourceRef="task_remind" targetRef="endEvent_late" />`);

/** `<flow>: <detail>` of the changed sequence flows. */
const changedFlows = (cs: Pick<ChangeSet, 'changed'>): string[] => cs.changed.filter((change) => change.kind === 'sequenceFlow').map((change) => `${change.id}: ${change.detail}`);

describe('move: a chain anchored on its own nodes, nodes already in place, what the bridge took', () => {
  it('a chain whose --after anchor or --flow source is one of its later nodes, or inside one, is refused before anything changes, in both modes', async () => {
    const cases: Array<[string, EditCommand, string, string]> = [
      [JOINED, { op: 'move', ids: ['task_a', 'gateway_join', 'endEvent_done'], after: 'gateway_join' }, 'gateway_join cannot anchor the move of task_a, gateway_join, endEvent_done: it is one of the moved nodes', '`bpmn move <file> task_a --after gateway_join`'],
      [LINE, { op: 'move', ids: ['task_a', 'task_b'], flow: 'flow_bToC' }, 'flow_bToC cannot anchor the move of task_a, task_b: its source task_b is one of the moved nodes', '`bpmn move <file> task_a --flow flow_bToC`'],
      [LINE, { op: 'move', ids: ['task_b', 'task_c'], after: 'task_c' }, 'task_c cannot anchor the move of task_b, task_c: it is one of the moved nodes', '`bpmn move <file> task_b --after task_c`'],
      // C alone is already after B: the hint has the reorder instead
      [LINE, { op: 'move', ids: ['task_c', 'task_b'], after: 'task_b' }, 'task_b cannot anchor the move of task_c, task_b: it is one of the moved nodes', 'task_c is already after task_b. Pick an anchor outside the moved nodes, or put task_c before task_b: `bpmn move <file> task_c --before task_b`.'],
      [LINE, { op: 'move', ids: ['task_a', 'task_b'], after: 'task_b', before: 'task_c' }, 'task_b cannot anchor the move of task_a, task_b: it is one of the moved nodes', '`bpmn move <file> task_a --after task_b --before task_c`'],
      [WITH_SUB, { op: 'move', ids: ['task_t', 'subProcess_sub'], after: 'task_inner' }, 'task_inner cannot anchor the move of task_t, subProcess_sub: it is inside subProcess_sub, one of the moved nodes', '`bpmn move <file> task_t --after task_inner`'],
      // a --before anchor inside a later node: the chain would be placed inside itself
      [WITH_SUB, { op: 'move', ids: ['task_t', 'subProcess_sub'], before: 'task_inner' }, 'task_inner cannot anchor the move of task_t, subProcess_sub: it is inside subProcess_sub, one of the moved nodes', 'placed inside itself. Pick an anchor outside the moved nodes, or move task_t alone: `bpmn move <file> task_t --before task_inner`'],
      // a boundary event moves with its host
      [WITH_TIMER, { op: 'move', ids: ['task_a', 'task_t'], after: 'event_timeout' }, 'event_timeout cannot anchor the move of task_a, task_t: it is a boundary event of task_t, one of the moved nodes', '`bpmn move <file> task_a --after event_timeout`'],
      [WITH_TIMER, { op: 'move', ids: ['task_a', 'task_t'], flow: 'flow_timeoutToRemind' }, 'flow_timeoutToRemind cannot anchor the move of task_a, task_t: its source event_timeout is a boundary event of task_t, one of the moved nodes', '`bpmn move <file> task_a --flow flow_timeoutToRemind`'],
    ];
    for (const [xml, op, message, command] of cases) {
      for (const keepFlowIds of [true, false]) {
        const what = `${JSON.stringify(op)} keep=${keepFlowIds}`;
        const err = await applyToXml(xml, [op], { keepFlowIds, layout: false }).then(() => undefined, (error: unknown) => error as { code: string; message: string; details: { hint?: string } });
        expect(err, what).toMatchObject({ code: 'E_INVALID_PLACEMENT', message });
        expect(err!.details.hint, what).toContain(command);
        // refused before the first node moved: the document is as it was
        const doc = await Doc.fromXml(xml);
        doc.followFlowEnds = !keepFlowIds;
        const flowsBefore = [...doc.byId().values()].filter((element) => element.$type === 'bpmn:SequenceFlow').map((flow) => `${flow.get<string>('id')} ${flow.get<El>('sourceRef').get<string>('id')}->${flow.get<El>('targetRef').get<string>('id')}`);
        expect(() => runOp(doc, op), what).toThrow(message);
        expect([...doc.byId().values()].filter((element) => element.$type === 'bpmn:SequenceFlow').map((flow) => `${flow.get<string>('id')} ${flow.get<El>('sourceRef').get<string>('id')}->${flow.get<El>('targetRef').get<string>('id')}`), what).toEqual(flowsBefore);
      }
    }
    // the node itself as the anchor keeps its own message, and so does its own boundary event; a --before anchor in the chain is fine (it ends A -> Join)
    await expect(applyToXml(LINE, [{ op: 'move', ids: ['task_b'], after: 'task_b' }], { layout: false })).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: 'task_b cannot be moved relative to task_b: that is the node itself or one of its children' });
    await expect(applyToXml(WITH_TIMER, [{ op: 'move', ids: ['task_t'], after: 'event_timeout' }], { layout: false })).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: 'task_t cannot be moved relative to event_timeout: that is one of its boundary events, which move with it' });
    const afterTimer = await kept([{ op: 'move', ids: ['task_a'], after: 'event_timeout' }], WITH_TIMER);
    expect([flowBetween(afterTimer.doc, 'event_timeout', 'task_a'), flowBetween(afterTimer.doc, 'task_a', 'task_remind')]).toEqual(['flow_timeoutToRemind', 'flow_aToT']);
    const before = await kept([{ op: 'move', ids: ['task_a', 'gateway_join'], before: 'gateway_join' }], JOINED);
    expect(flowBetween(before.doc, 'task_a', 'gateway_join')).toBe('flow_aToJoin');
  });

  it('a move that leaves its nodes where they are changes nothing, in both modes: no write, no warning, the label and condition stay', async () => {
    const cases: Array<[EditCommand, string]> = [
      [{ op: 'move', ids: ['task_b'], after: 'task_a' }, 'task_b is already after task_a'],
      [{ op: 'move', ids: ['task_b', 'task_c'], after: 'task_a' }, 'task_b, task_c are already after task_a, in this order'],
      [{ op: 'move', ids: ['task_b'], before: 'task_c' }, 'task_b is already before task_c'],
      [{ op: 'move', ids: ['task_b', 'task_c'], before: 'endEvent_done' }, 'task_b, task_c are already before endEvent_done, in this order'],
      [{ op: 'move', ids: ['task_b'], after: 'task_a', before: 'task_c' }, 'task_b is already between task_a and task_c'],
      [{ op: 'move', ids: ['task_c', 'endEvent_done'], after: 'task_b' }, 'task_c, endEvent_done are already after task_b, in this order'],
    ];
    for (const [op, note] of cases) {
      for (const keepFlowIds of [true, false]) {
        const what = `${JSON.stringify(op)} keep=${keepFlowIds}`;
        const result = await applyToXml(NAMED_LINE, [op], { keepFlowIds, layout: false });
        expect(result.unchanged, what).toBe(true);
        expect([result.result.created, result.result.changed, result.result.removed, result.result.renamed], what).toEqual([[], [], [], undefined]);
        expect(result.result.warnings.added, what).toEqual([]);
        expect(result.result.notes, what).toEqual([note]);
      }
    }
    // a drawn file with its layout: nothing to write either
    const drawn = await drawnDefault();
    for (const keepFlowIds of [true, false]) {
      const result = await applyToXml(drawn, [{ op: 'move', ids: ['task_check'], after: 'startEvent_start' }], { keepFlowIds });
      expect(result.unchanged).toBe(true);
      expect(result.result.notes).toContain('task_check is already after startEvent_start');
    }
    // a hand-made drawing keeps every shape: the incremental layout places no node a move left where it was (--in its own scope too)
    const hand = readFileSync(join(join(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'fixtures', 'step1', 'far-label.bpmn'), 'utf8');
    for (const op of [{ op: 'move', ids: ['ST', 'SE'], after: 'SS' }, { op: 'move', ids: ['ST'], in: 'SUB' }] satisfies EditCommand[]) {
      const result = await applyToXml(hand, [op]);
      expect([result.unchanged, result.result.layout?.mode, result.result.layout?.moved], JSON.stringify(op)).toEqual([true, 'incremental', []]);
    }
    // flow options describe the flow into the first node, as on a splice: only that flow changes
    for (const keepFlowIds of [true, false]) {
      const result = await applyToXml(NAMED_LINE, [{ op: 'move', ids: ['task_b'], after: 'task_a', flowName: 'start' }], { keepFlowIds, layout: false });
      expect(changedFlows(result.result)).toEqual(['flow_aToB: task_a -> task_b']);
      expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_aToB" name="start" sourceRef="task_a" targetRef="task_b" />');
      expect(result.xml).toMatch(/<bpmn:sequenceFlow id="flow_bToC" name="approved" sourceRef="task_b" targetRef="task_c">\s*<bpmn:conditionExpression/);
    }
    // after a gateway the node is appended as a new branch: that move still runs
    const forked = await applyToXml(FORKED, [{ op: 'move', ids: ['task_b'], after: 'task_a' }], { layout: false });
    expect(forked.result.notes).toContain('appended after task_a');
  });

  it('a "flowId" on a move in place renames the flow into the first node, in both modes', async () => {
    for (const keepFlowIds of [true, false]) {
      const result = await applyToXml(LINE, [{ op: 'move', ids: ['endEvent_done'], after: 'task_c', flowId: 'flow_cToEnd' }], { keepFlowIds, layout: false });
      expect([result.result.created, result.result.removed, result.result.warnings.added], `keep=${keepFlowIds}`).toEqual([[], [], []]);
      expect(changedFlows(result.result)).toEqual(['flow_cToEnd: task_c -> endEvent_done (renamed from flow_cToDone)']);
      expect(result.result.notes).toEqual(['endEvent_done is already after task_c']);
      expect(result.xml).toContain('<bpmn:sequenceFlow id="flow_cToEnd" sourceRef="task_c" targetRef="endEvent_done" />');
      expect(result.xml).not.toContain('flow_cToDone');
      // with a name: one entry; the id of another element is refused
      const named = await applyToXml(NAMED_LINE, [{ op: 'move', ids: ['task_b'], after: 'task_a', flowId: 'flow_start', flowName: 'start' }], { keepFlowIds, layout: false });
      expect(changedFlows(named.result)).toEqual(['flow_start: task_a -> task_b (renamed from flow_aToB)']);
      expect(named.xml).toContain('<bpmn:sequenceFlow id="flow_start" name="start" sourceRef="task_a" targetRef="task_b" />');
      await expect(applyToXml(LINE, [{ op: 'move', ids: ['task_b'], after: 'task_a', flowId: 'flow_bToC' }], { keepFlowIds, layout: false })).rejects.toMatchObject({ code: 'E_DUPLICATE_ID' });
    }
  });

  it('with ids kept, the change of a bridged node\'s put-back out-flow names what the bridge took: its name, condition and annotations', async () => {
    const move: EditCommand[] = [{ op: 'move', ids: ['task_b'], after: 'task_c' }];
    const both = await applyToXml(NAMED_LINE, move, { keepFlowIds: true, layout: false });
    expect(changedFlows(both.result)).toEqual([
      'flow_aToB: task_a -> task_c (bridged task_b)',
      'flow_cToDone: task_c -> task_b (was -> endEvent_done)',
      'flow_bToC: task_b -> endEvent_done (was -> task_c; its name and condition stay with the bridge flow_aToB)',
    ]);
    expect(both.xml).toMatch(/<bpmn:sequenceFlow id="flow_aToB" name="approved" sourceRef="task_a" targetRef="task_c">\s*<bpmn:conditionExpression/);
    expect(renderMutation(both.result)).toContain('changed sequenceFlow flow_bToC - task_b -> endEvent_done (was -> task_c; its name and condition stay with the bridge flow_aToB)');
    // an annotation goes with them; a name the bridge already had stays, so only the rest is named
    const annotated = NAMED_LINE.replace('<bpmn:sequenceFlow id="flow_aToB" sourceRef', '<bpmn:sequenceFlow id="flow_aToB" name="start" sourceRef')
      .replace('<bpmn:sequenceFlow id="flow_cToDone"', '<bpmn:textAnnotation id="TextAnnotation_Note"><bpmn:text>note</bpmn:text></bpmn:textAnnotation>\n    <bpmn:association id="Association_Note" sourceRef="flow_bToC" targetRef="TextAnnotation_Note" />\n    <bpmn:sequenceFlow id="flow_cToDone"');
    const some = await applyToXml(annotated, move, { keepFlowIds: true, layout: false });
    expect(changedFlows(some.result)).toContain('flow_bToC: task_b -> endEvent_done (was -> task_c; its condition and annotation stay with the bridge flow_aToB)');
    expect(some.result.warnings.added.map((warning) => warning.code)).toContain('W_LABEL_DROPPED');
    // the bridge is the default flow of A: the condition is dropped there (W_CONDITION_DROPPED), so only the name is named
    const byDefault = NAMED_LINE.replace('<bpmn:task id="task_a" name="A">', '<bpmn:task id="task_a" name="A" default="flow_aToB">');
    const named = await applyToXml(byDefault, move, { keepFlowIds: true, layout: false });
    expect(changedFlows(named.result)).toContain('flow_bToC: task_b -> endEvent_done (was -> task_c; its name stays with the bridge flow_aToB)');
    // put back between its old ends (before the join, a prepend): the clause alone
    const join = JOINED.replace('<bpmn:sequenceFlow id="flow_aToJoin" sourceRef', '<bpmn:sequenceFlow id="flow_aToJoin" name="done" sourceRef');
    const back = await applyToXml(join, [{ op: 'move', ids: ['task_a'], before: 'gateway_join' }], { keepFlowIds: true, layout: false });
    expect(changedFlows(back.result)).toContain('flow_aToJoin: task_a -> gateway_join (its name stays with the bridge flow_okToA)');
    // nothing to name: as before; by default the out-flow is removed with its label, as before
    expect(changedFlows(await applyToXml(LINE, move, { keepFlowIds: true, layout: false }).then((result) => result.result))).toContain('flow_bToC: task_b -> endEvent_done (was -> task_c)');
    const renamed = await applyToXml(NAMED_LINE, move, { layout: false });
    expect(renamed.result.removed).toContainEqual({ id: 'flow_bToC', kind: 'sequenceFlow', name: 'approved', detail: 'task_b -> task_c' });
    expect(changedFlows(renamed.result).join('\n')).not.toContain('stay');
  });

  it('with ids kept, the clause is decided once the chain is placed: a bridge a later node removed, renamed or took it back from', async () => {
    // A's bridge T -> Done takes "done", then Done's detach (an end event) removes it: flow_aToDone, back between A and Done, gets it back
    const branched = definitionsXml(`
    <bpmn:startEvent id="startEvent_start"><bpmn:outgoing>flow_startToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gateway_ok"><bpmn:incoming>flow_startToOk</bpmn:incoming><bpmn:outgoing>flow_okToT</bpmn:outgoing><bpmn:outgoing>flow_okToU</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="task_t"><bpmn:incoming>flow_okToT</bpmn:incoming><bpmn:outgoing>flow_tToA</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_a"><bpmn:incoming>flow_tToA</bpmn:incoming><bpmn:outgoing>flow_aToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_done"><bpmn:incoming>flow_aToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="task_u"><bpmn:incoming>flow_okToU</bpmn:incoming><bpmn:outgoing>flow_uToOther</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="endEvent_other"><bpmn:incoming>flow_uToOther</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_startToOk" sourceRef="startEvent_start" targetRef="gateway_ok" />
    <bpmn:sequenceFlow id="flow_okToT" sourceRef="gateway_ok" targetRef="task_t" />
    <bpmn:sequenceFlow id="flow_tToA" sourceRef="task_t" targetRef="task_a" />
    <bpmn:sequenceFlow id="flow_aToDone" name="done" sourceRef="task_a" targetRef="endEvent_done"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${done}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="flow_okToU" sourceRef="gateway_ok" targetRef="task_u" />
    <bpmn:sequenceFlow id="flow_uToOther" sourceRef="task_u" targetRef="endEvent_other" />`);
    const removed = await applyToXml(branched, [{ op: 'move', ids: ['task_a', 'endEvent_done'], after: 'gateway_ok' }], { keepFlowIds: true, layout: false });
    expect(removed.xml).toMatch(/<bpmn:sequenceFlow id="flow_aToDone" name="done" sourceRef="task_a" targetRef="endEvent_done">\s*<bpmn:conditionExpression/);
    expect(changedFlows(removed.result)).toEqual(['flow_tToA: task_t -> endEvent_done (bridged task_a)', 'flow_aToDone: task_a -> endEvent_done']);
    expect(removed.result.removed.map((change) => change.id)).toEqual(['flow_tToA']);
    expect(removed.result.warnings.added.filter((warning) => warning.code.endsWith('_DROPPED'))).toEqual([]);
    // T's bridge Ok -> A takes "next", then Ok's detach (a split: not bridged) removes it, and T -> A ends at Ok now: the label is dropped, and said so
    const named = branched.replace('id="flow_tToA" sourceRef', 'id="flow_tToA" name="next" sourceRef');
    const lost = await applyToXml(named, [{ op: 'move', ids: ['task_t', 'gateway_ok'], after: 'task_u' }], { keepFlowIds: true, layout: false });
    expect(lost.xml).not.toContain('"next"');
    expect(lost.result.warnings.added.filter((warning) => warning.code === 'W_LABEL_DROPPED').map((warning) => warning.message)).toEqual([
      'Flow label "next" of flow_tToA was dropped while moving task_t: the bridge flow_okToT took it, and a later node of the move removed flow_okToT',
    ]);
    expect(changedFlows(lost.result).join('\n')).not.toContain('stay');
    // a bridge a later node renamed (a flow the batch created follows its ends): the clause names the id it has now
    const long = NAMED_LINE.replace('<bpmn:outgoing>flow_cToDone</bpmn:outgoing></bpmn:task>', '<bpmn:outgoing>flow_cToD</bpmn:outgoing></bpmn:task>\n    <bpmn:task id="task_d" name="D"><bpmn:incoming>flow_cToD</bpmn:incoming><bpmn:outgoing>flow_dToDone</bpmn:outgoing></bpmn:task>')
      .replace('<bpmn:incoming>flow_cToDone</bpmn:incoming>', '<bpmn:incoming>flow_dToDone</bpmn:incoming>')
      .replace('<bpmn:sequenceFlow id="flow_cToDone" sourceRef="task_c" targetRef="endEvent_done" />', '<bpmn:sequenceFlow id="flow_cToD" sourceRef="task_c" targetRef="task_d" />\n    <bpmn:sequenceFlow id="flow_dToDone" sourceRef="task_d" targetRef="endEvent_done" />');
    const batch = await applyToXml(long, [{ op: 'add', kind: 'task', name: 'X', after: 'task_a' }, { op: 'move', ids: ['task_b', 'task_c'], after: 'task_d' }], { keepFlowIds: true, layout: false });
    expect(batch.xml).toMatch(/<bpmn:sequenceFlow id="flow_xToD" name="approved" sourceRef="task_x" targetRef="task_d">/);
    expect(changedFlows(batch.result).filter((flowLine) => flowLine.includes('stay'))).toEqual(['flow_bToC: task_b -> task_c (was -> endEvent_done; its name and condition stay with the bridge flow_xToD)']);
    // B and A swap places: the second bridge takes the label back to flow_bToC, so nothing is said, and each entry is listed once
    const swap = await applyToXml(NAMED_LINE, [{ op: 'move', ids: ['task_b', 'task_a'], after: 'startEvent_start' }], { keepFlowIds: true, layout: false });
    expect(changedFlows(swap.result)).toEqual([
      'flow_aToB: task_a -> task_c (bridged task_b)',
      'flow_startToA: startEvent_start -> task_b (was -> task_a)',
      'flow_bToC: task_b -> task_a (was -> task_c)',
      'flow_bToC: task_b -> task_c (bridged task_a)',
      'flow_aToB: task_a -> task_c',
    ]);
    expect(swap.xml).toMatch(/<bpmn:sequenceFlow id="flow_bToC" name="approved" sourceRef="task_b" targetRef="task_a">\s*<bpmn:conditionExpression/);
  });
});

describe('`set id=` takes a DI id derived from the old id along', () => {
  /** DI id by element id. */
  const diOf = (xml: string): Map<string, string> => new Map([...xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge) id="([^"]+)" bpmnElement="([^"]+)"/g)].map((match) => [match[2]!, match[1]!]));
  const RENAMES: EditCommand[] = [
    { op: 'set', id: 'flow_checkToOk', values: { id: 'flow_checkToAudit' } },
    { op: 'set', id: 'task_check', values: { id: 'task_audit' } },
  ];

  it('on a flow and a task, in the `<id>_di` and `BPMN<Kind>_` styles, with ids kept too; the result is unchanged', async () => {
    for (const style of ['suffix', 'bpmn'] as const) {
      for (const keepFlowIds of [false, true]) {
        const result = await applyToXml(await drawnDefault(style), RENAMES, { keepFlowIds });
        const di = diOf(result.xml);
        expect(di.get('flow_checkToAudit')).toBe(style === 'suffix' ? 'flow_checkToAudit_di' : 'BPMNEdge_flow_checkToAudit');
        expect(di.get('task_audit')).toBe(style === 'suffix' ? 'task_audit_di' : 'BPMNShape_task_audit');
        expect(result.xml).not.toMatch(/task_check|flow_checkToOk/);
        expect(result.result.changed.map((change) => `${change.id}: ${change.detail}`)).toEqual(['flow_checkToAudit: renamed from flow_checkToOk', 'task_audit: renamed from task_check']);
      }
    }
  });

  it('a DI id not derived from the old id stays; one whose new id is taken gets _2', async () => {
    const xml = (await drawnDefault()).replace('id="task_check_di"', 'id="Shape_0abc123"').replace('id="task_book_di"', 'id="endEvent_archive_di"');
    const result = await applyToXml(xml, [
      { op: 'set', id: 'task_check', values: { id: 'task_audit' } },
      { op: 'set', id: 'endEvent_done', values: { id: 'endEvent_archive' } },
    ]);
    const di = diOf(result.xml);
    expect(di.get('task_audit')).toBe('Shape_0abc123');
    expect(di.get('endEvent_archive')).toBe('endEvent_archive_di_2');
    expect(di.get('task_book')).toBe('endEvent_archive_di');
  });

  it('a derived DI id with a collision suffix (_2) follows too', async () => {
    const xml = (await drawnDefault('bpmn')).replace('id="BPMNShape_task_book"', 'id="BPMNShape_task_book_2"').replace('id="BPMNEdge_flow_checkToOk"', 'id="BPMNEdge_flow_checkToOk_3"');
    const result = await applyToXml(xml, RENAMES);
    expect(diOf(result.xml).get('task_audit')).toBe('BPMNShape_task_audit');
    expect(diOf(result.xml).get('flow_checkToAudit')).toBe('BPMNEdge_flow_checkToAudit');
    const book = await applyToXml(xml, [{ op: 'set', id: 'task_book', values: { id: 'task_post' } }]);
    expect(diOf(book.xml).get('task_post')).toBe('BPMNShape_task_post');
  });

  it('in a batch, a DI id of an element removed before is free for the rename, as in two commands', async () => {
    const ops: EditCommand[] = [
      { op: 'remove', ids: ['task_book'] },
      { op: 'set', id: 'task_check', values: { id: 'task_book' } },
    ];
    for (const style of ['suffix', 'bpmn'] as const) {
      for (const layout of [undefined, false] as const) {
        const opts = layout === false ? { layout } : {};
        const batch = await applyToXml(await drawnDefault(style), ops, opts);
        const first = await applyToXml(await drawnDefault(style), [ops[0]!], opts);
        const second = await applyToXml(first.xml, [ops[1]!], opts);
        expect(diOf(batch.xml).get('task_book')).toBe(style === 'suffix' ? 'task_book_di' : 'BPMNShape_task_book');
        expect(batch.xml).toBe(second.xml);
      }
    }
  });

  it('the renamed element\'s DI element is written anew: a comment inside it is dropped, and the result says so', async () => {
    const xml = (await drawnDefault()).replace(/(<bpmndi:BPMNShape id="task_check_di" bpmnElement="task_check">)/, '$1\n        <!-- reviewed -->');
    expect(xml).toContain('<!-- reviewed -->');
    for (const layout of [undefined, false] as const) {
      const result = await applyToXml(xml, [{ op: 'set', id: 'task_check', values: { id: 'task_audit' } }], layout === false ? { layout } : {});
      expect(diOf(result.xml).get('task_audit')).toBe('task_audit_di');
      expect(result.xml).not.toContain('<!-- reviewed -->');
      expect(result.result.notes).toContain('1 XML comment(s) dropped: they were inside or next to elements the change removed or rewrote');
    }
  });

  it('following W_FLOW_ID_STALE with its `bpmn set` gives the file the default rename gives', async () => {
    const splice: EditCommand[] = [{ op: 'add', kind: 'task', name: 'Review', flow: 'flow_okToBook' }];
    for (const style of ['suffix', 'bpmn'] as const) {
      const renamed = await applyToXml(await drawnDefault(style), splice);
      const keptIds = await applyToXml(await drawnDefault(style), splice, { keepFlowIds: true });
      const command = /`bpmn set <file> (\S+) id=(\S+)`/.exec(stale(keptIds.result.warnings.added)[0]!.hint!)!;
      const followed = await applyToXml(keptIds.xml, [{ op: 'set', id: command[1]!, values: { id: command[2]! } }], { keepFlowIds: true });
      expect(diOf(followed.xml).get('flow_okToReview')).toBe(style === 'suffix' ? 'flow_okToReview_di' : 'BPMNEdge_flow_okToReview');
      expect(followed.xml).toBe(renamed.xml);
    }
  });
});

describe('--no-layout with ids kept: a flow whose ends changed loses its stale edge', () => {
  /** The flows a drawing has a BPMNEdge for. */
  const drawnFlows = (xml: string): string[] => [...xml.matchAll(/<bpmndi:BPMNEdge [^>]*bpmnElement="([^"]+)"/g)].map((match) => match[1]!).sort();

  it('a move: every flow whose ends changed loses its edge and the note names them, like in the default mode; the next write draws them at their new ends', async () => {
    const drawn = (await layoutXml(LINE)).xml;
    expect(drawnFlows(drawn)).toEqual(['flow_aToB', 'flow_bToC', 'flow_cToDone', 'flow_startToA']);
    const result = await applyToXml(drawn, [{ op: 'move', ids: ['task_b'], after: 'task_c' }], { keepFlowIds: true, layout: false });
    expect(drawnFlows(result.xml)).toEqual(['flow_startToA']);
    expect(result.result.notes.filter((note) => note.startsWith('removed'))).toEqual(['removed 3 stale diagram element(s), among them the edge(s) of flow_aToB, flow_bToC, flow_cToDone (their ends changed; the next model edit without --no-layout draws them, or `bpmn route <file> <flowId>`)']);
    expect(result.result.layout?.metrics?.added.filter((problem) => problem.kind === 'missing').map((problem) => problem.ids[0]).sort()).toEqual(['flow_aToB', 'flow_bToC', 'flow_cToDone']);
    // the default mode: the bridge and the flow into B lose theirs, the removed flow's edge goes with it
    const followed = await applyToXml(drawn, [{ op: 'move', ids: ['task_b'], after: 'task_c' }], { layout: false });
    expect(drawnFlows(followed.xml)).toEqual(['flow_startToA']);
    expect(followed.result.notes.filter((note) => note.startsWith('removed'))).toEqual(['removed 3 stale diagram element(s), among them the edge(s) of flow_aToC, flow_cToB (their ends changed; the next model edit without --no-layout draws them, or `bpmn route <file> <flowId>`)']);
    const next = await applyToXml(result.xml, [{ op: 'set', id: 'task_a', values: { name: 'A2' } }], { keepFlowIds: true });
    expect(next.result.layout?.mode).toBe('incremental');
    expect([...(next.result.layout?.placed ?? [])].sort()).toEqual(['flow_aToB', 'flow_bToC', 'flow_cToDone']);
    expect(next.result.layout?.metrics?.after.counts.missing).toBe(0);
  });
});
