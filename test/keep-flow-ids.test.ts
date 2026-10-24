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
import { applyToXml, layoutXml, newXml } from '../src/api.js';
import { Doc } from '../src/model/Doc.js';
import type { El } from '../src/model/utils/moddle.js';
import type { Warning } from '../src/shared/CliError.js';
import { idNamesEnds } from '../src/ops/flows.js';
import { runOp, runOps } from '../src/index.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, renderMutation } from '../src/index.js';
import type { ChangeSet } from '../src/model/ChangeSet.js';
import { definitionsXml, flowBetween } from './helpers.js';

/** A file of the default style with `<id>_di` DI (`bpmn`: the engine's `BPMNShape_<id>`): start -> Check -> Ok? -> Book (default) -> Done. */
async function drawnDefault(style: 'suffix' | 'bpmn' = 'suffix'): Promise<string> {
  const ops: Op[] = [
    { op: 'add', kind: 'startEvent', name: 'Start' },
    { op: 'add', kind: 'task', name: 'Check', after: 'Event_Start' },
    { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', after: 'Activity_Check' },
    { op: 'add', kind: 'task', name: 'Book', after: 'Gateway_Ok', default: true },
    { op: 'add', kind: 'endEvent', name: 'Done', after: 'Activity_Book' },
  ];
  const xml = (await applyToXml((await newXml({ processName: 'P' })).xml, ops)).xml;
  return style === 'bpmn' ? xml : xml.replace(/BPMN(Shape|Edge)_([A-Za-z0-9_]+)/g, '$2_di');
}

/** The same chain without DI, for the ops alone. */
const CHAIN = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToCheck</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_Check" name="Check"><bpmn:incoming>Flow_StartToCheck</bpmn:incoming><bpmn:outgoing>Flow_CheckToOk</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?" default="Flow_OkToBook"><bpmn:incoming>Flow_CheckToOk</bpmn:incoming><bpmn:outgoing>Flow_OkToBook</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_Book" name="Book"><bpmn:incoming>Flow_OkToBook</bpmn:incoming><bpmn:outgoing>Flow_BookToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_BookToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToCheck" sourceRef="Event_Start" targetRef="Activity_Check" />
    <bpmn:sequenceFlow id="Flow_CheckToOk" sourceRef="Activity_Check" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_OkToBook" sourceRef="Gateway_Ok" targetRef="Activity_Book" />
    <bpmn:sequenceFlow id="Flow_BookToDone" sourceRef="Activity_Book" targetRef="Event_Done" />`);

/** A split into A and B, joined before Done (remove --bridge-all of the join). */
const JOINED = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"><bpmn:incoming>Flow_StartToOk</bpmn:incoming><bpmn:outgoing>Flow_OkToA</bpmn:outgoing><bpmn:outgoing>Flow_OkToB</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_A" name="A"><bpmn:incoming>Flow_OkToA</bpmn:incoming><bpmn:outgoing>Flow_AToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_B" name="B"><bpmn:incoming>Flow_OkToB</bpmn:incoming><bpmn:outgoing>Flow_BToJoin</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_Join"><bpmn:incoming>Flow_AToJoin</bpmn:incoming><bpmn:incoming>Flow_BToJoin</bpmn:incoming><bpmn:outgoing>Flow_JoinToDone</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_JoinToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToOk" sourceRef="Event_Start" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_OkToA" sourceRef="Gateway_Ok" targetRef="Activity_A" />
    <bpmn:sequenceFlow id="Flow_OkToB" sourceRef="Gateway_Ok" targetRef="Activity_B" />
    <bpmn:sequenceFlow id="Flow_AToJoin" sourceRef="Activity_A" targetRef="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_BToJoin" sourceRef="Activity_B" targetRef="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_JoinToDone" sourceRef="Gateway_Join" targetRef="Event_Done" />`);

/** Start -> A -> B -> C -> Done, for a move of two nodes. */
const LINE = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToA</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_A" name="A"><bpmn:incoming>Flow_StartToA</bpmn:incoming><bpmn:outgoing>Flow_AToB</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_B" name="B"><bpmn:incoming>Flow_AToB</bpmn:incoming><bpmn:outgoing>Flow_BToC</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_C" name="C"><bpmn:incoming>Flow_BToC</bpmn:incoming><bpmn:outgoing>Flow_CToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_CToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToA" sourceRef="Event_Start" targetRef="Activity_A" />
    <bpmn:sequenceFlow id="Flow_AToB" sourceRef="Activity_A" targetRef="Activity_B" />
    <bpmn:sequenceFlow id="Flow_BToC" sourceRef="Activity_B" targetRef="Activity_C" />
    <bpmn:sequenceFlow id="Flow_CToDone" sourceRef="Activity_C" targetRef="Event_Done" />`);

/** LINE with A as an exclusive gateway: a move after it appends. */
const FORKED = LINE.replace(/<bpmn:task id="Activity_A"(.*?)<\/bpmn:task>/, '<bpmn:exclusiveGateway id="Activity_A"$1</bpmn:exclusiveGateway>');

/** LINE with a second flow out of B (B -> Done): B is not bridged, so a move has no out-flow of B to put back. */
const TWO_OUT = LINE.replace('<bpmn:outgoing>Flow_BToC</bpmn:outgoing>', '<bpmn:outgoing>Flow_BToC</bpmn:outgoing><bpmn:outgoing>Flow_BToDone</bpmn:outgoing>')
  .replace('<bpmn:incoming>Flow_CToDone</bpmn:incoming>', '<bpmn:incoming>Flow_CToDone</bpmn:incoming><bpmn:incoming>Flow_BToDone</bpmn:incoming>')
  .replace('<bpmn:sequenceFlow id="Flow_CToDone"', '<bpmn:sequenceFlow id="Flow_BToDone" sourceRef="Activity_B" targetRef="Event_Done" />\n    <bpmn:sequenceFlow id="Flow_CToDone"');

/** LINE where B has a second flow in (A starts without one) and B -> C has a label and a condition: B is not bridged. */
const JOIN_B = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToB</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_A" name="A"><bpmn:outgoing>Flow_AToB</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_B" name="B"><bpmn:incoming>Flow_StartToB</bpmn:incoming><bpmn:incoming>Flow_AToB</bpmn:incoming><bpmn:outgoing>Flow_BToC</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_C" name="C"><bpmn:incoming>Flow_BToC</bpmn:incoming><bpmn:outgoing>Flow_CToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_CToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToB" sourceRef="Event_Start" targetRef="Activity_B" />
    <bpmn:sequenceFlow id="Flow_AToB" sourceRef="Activity_A" targetRef="Activity_B" />
    <bpmn:sequenceFlow id="Flow_BToC" name="approved" sourceRef="Activity_B" targetRef="Activity_C"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_CToDone" sourceRef="Activity_C" targetRef="Event_Done" />`);

/** Start -> X -> Done, and apart from it A -> B (A has no flow in, so it is not bridged) with a label and a condition. */
const APART = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToX</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_X" name="X"><bpmn:incoming>Flow_StartToX</bpmn:incoming><bpmn:outgoing>Flow_XToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_XToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="Activity_A" name="A"><bpmn:outgoing>Flow_AToB</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_B" name="B"><bpmn:incoming>Flow_AToB</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_StartToX" sourceRef="Event_Start" targetRef="Activity_X" />
    <bpmn:sequenceFlow id="Flow_XToDone" sourceRef="Activity_X" targetRef="Event_Done" />
    <bpmn:sequenceFlow id="Flow_AToB" name="approved" sourceRef="Activity_A" targetRef="Activity_B"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>`);

/** A split into A and B, both ending in Done: Done has two flows in. */
const SHARED_END = definitionsXml(`
    <bpmn:startEvent id="Event_Start" name="Start"><bpmn:outgoing>Flow_StartToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"><bpmn:incoming>Flow_StartToOk</bpmn:incoming><bpmn:outgoing>Flow_OkToA</bpmn:outgoing><bpmn:outgoing>Flow_OkToB</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_A" name="A"><bpmn:incoming>Flow_OkToA</bpmn:incoming><bpmn:outgoing>Flow_AToDone</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_B" name="B"><bpmn:incoming>Flow_OkToB</bpmn:incoming><bpmn:outgoing>Flow_BToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done" name="Done"><bpmn:incoming>Flow_AToDone</bpmn:incoming><bpmn:incoming>Flow_BToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToOk" sourceRef="Event_Start" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_OkToA" sourceRef="Gateway_Ok" targetRef="Activity_A" />
    <bpmn:sequenceFlow id="Flow_OkToB" sourceRef="Gateway_Ok" targetRef="Activity_B" />
    <bpmn:sequenceFlow id="Flow_AToDone" sourceRef="Activity_A" targetRef="Event_Done" />
    <bpmn:sequenceFlow id="Flow_BToDone" sourceRef="Activity_B" targetRef="Event_Done" />`);

/** A Camunda Modeler file: hashed flow ids say nothing about their ends. */
const MODELER = definitionsXml(`
    <bpmn:startEvent id="StartEvent_1" name="Order received"><bpmn:outgoing>Flow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Activity_0k3x9qa" name="Check order"><bpmn:incoming>Flow_0a1b2c3</bpmn:incoming><bpmn:outgoing>Flow_1q2w3e4</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="Event_0zz81aa" name="Order done"><bpmn:incoming>Flow_1q2w3e4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_0a1b2c3" sourceRef="StartEvent_1" targetRef="Activity_0k3x9qa" />
    <bpmn:sequenceFlow id="Flow_1q2w3e4" sourceRef="Activity_0k3x9qa" targetRef="Event_0zz81aa" />`);

const stale = (ws: readonly Warning[]): Warning[] => ws.filter((w) => w.code === 'W_FLOW_ID_STALE');
/** `<flow> <source>-><target> => <suggested id>` of each W_FLOW_ID_STALE. */
const staleLines = (ws: readonly Warning[]): string[] => stale(ws).map((w) => `${w.element} ${w.related!.join('->')} => ${/ id=(\S+)`/.exec(w.hint!)![1]}`);

/** Runs ops on CHAIN (or `xml`) with ids kept, without the pipeline. */
async function kept(ops: Op[], xml = CHAIN): Promise<{ doc: Doc; warnings: Warning[]; renames: number; cs: ChangeSet }> {
  const doc = await Doc.fromXml(xml);
  doc.followFlowEnds = false;
  const cs = runOps(doc, ops);
  return { doc, warnings: cs.warnings, renames: cs.renames.length, cs };
}

/** The sequence flows of a change set: `created` / `removed` ids. */
const flowIds = (changes: ChangeSet['created']): string[] => changes.filter((c) => c.kind === 'sequenceFlow').map((c) => c.id);

describe('keepFlowIds: a flow the file had keeps its id and the change names it', () => {
  it('a splice keeps the flow id, its DI edge and the default reference; one W_FLOW_ID_STALE with the rename command, no renamed', async () => {
    const xml = await drawnDefault();
    const r = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Review', flow: 'Flow_OkToBook' }], { keepFlowIds: true });
    expect(r.result.created.map((c) => c.id)).toEqual(['Activity_Review', 'Flow_ReviewToBook']);
    expect(r.result.changed.map((c) => `${c.id}: ${c.detail}`)).toContain('Flow_OkToBook: Gateway_Ok -> Activity_Review (was -> Activity_Book)');
    expect(r.result.changed.some((c) => c.detail?.includes('renamed from'))).toBe(false);
    expect(r.result.renamed).toBeUndefined();
    expect(r.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?" default="Flow_OkToBook">');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_OkToBook" sourceRef="Gateway_Ok" targetRef="Activity_Review" />');
    expect(r.xml).toContain('<bpmndi:BPMNEdge id="Flow_OkToBook_di" bpmnElement="Flow_OkToBook">');
    expect(stale(r.result.warnings.added)).toEqual([
      {
        code: 'W_FLOW_ID_STALE',
        message: 'Flow Flow_OkToBook kept its id, which names its old ends Gateway_Ok -> Activity_Book; it now runs Gateway_Ok -> Activity_Review',
        element: 'Flow_OkToBook',
        related: ['Gateway_Ok', 'Activity_Review'],
        hint: 'Code and tests that use the id keep working; to rename it together with them: `bpmn set <file> Flow_OkToBook id=Flow_OkToReview`.',
      },
    ]);
    // the hint's command renames it deliberately; nothing is stale any more
    const renamed = await applyToXml(r.xml, [{ op: 'set', id: 'Flow_OkToBook', values: { id: 'Flow_OkToReview' } }], { keepFlowIds: true });
    expect(renamed.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?" default="Flow_OkToReview">');
    expect(stale(renamed.result.warnings.added)).toEqual([]);
  });

  it('every op that changes the ends of a flow: add --after / --before / --flow / --after --before, split, remove, set source= / target=', async () => {
    const cases: Array<[Op, string]> = [
      [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' }, 'Flow_CheckToOk Activity_Check->Activity_Review => Flow_CheckToReview'],
      [{ op: 'add', kind: 'task', name: 'Prepare', before: 'Activity_Check' }, 'Flow_StartToCheck Event_Start->Activity_Prepare => Flow_StartToPrepare'],
      [{ op: 'add', kind: 'task', name: 'Review', flow: 'Flow_OkToBook' }, 'Flow_OkToBook Gateway_Ok->Activity_Review => Flow_OkToReview'],
      [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check', before: 'Gateway_Ok' }, 'Flow_CheckToOk Activity_Check->Activity_Review => Flow_CheckToReview'],
      [{ op: 'split', after: 'Activity_Check', name: 'Valid?', branches: [{ nodes: [{ kind: 'task', name: 'Fix' }] }, { nodes: [] }] }, 'Flow_CheckToOk Activity_Check->Gateway_Valid => Flow_CheckToValid'],
      [{ op: 'remove', ids: ['Activity_Book'] }, 'Flow_OkToBook Gateway_Ok->Event_Done => Flow_OkToDone'],
      [{ op: 'set', id: 'Flow_BookToDone', values: { target: 'Activity_Check' } }, 'Flow_BookToDone Activity_Book->Activity_Check => Flow_BookToCheck'],
      [{ op: 'set', id: 'Flow_BookToDone', values: { source: 'Activity_Check' } }, 'Flow_BookToDone Activity_Check->Event_Done => Flow_CheckToDone'],
    ];
    for (const [op, line] of cases) {
      const r = await kept([op]);
      expect(staleLines(r.warnings), JSON.stringify(op)).toEqual([line]);
      expect(r.renames, JSON.stringify(op)).toBe(0);
      const flow = line.split(' ')[0]!;
      const [source, target] = line.split(' ')[1]!.split('->');
      expect(flowBetween(r.doc, source!, target!)).toBe(flow);
    }
  });

  it('a move keeps the bridge at its old place, the splice at its new one and the node\'s out-flow, put back there; remove --bridge-all one per predecessor', async () => {
    const moved = await kept([{ op: 'move', ids: ['Activity_Book'], before: 'Activity_Check' }]);
    expect(staleLines(moved.warnings).sort()).toEqual([
      'Flow_BookToDone Activity_Book->Activity_Check => Flow_BookToCheck',
      'Flow_OkToBook Gateway_Ok->Event_Done => Flow_OkToDone',
      'Flow_StartToCheck Event_Start->Activity_Book => Flow_StartToBook',
    ]);
    // Book's out-flow is its out-flow at the new place: changed, neither removed nor created
    expect(flowBetween(moved.doc, 'Activity_Book', 'Activity_Check')).toBe('Flow_BookToDone');
    expect([flowIds(moved.cs.created), flowIds(moved.cs.removed)]).toEqual([[], []]);
    expect(moved.cs.changed.map((c) => `${c.id}: ${c.detail}`)).toContain('Flow_BookToDone: Activity_Book -> Activity_Check (was -> Event_Done)');
    const bridged = await kept([{ op: 'remove', ids: ['Gateway_Join'], bridgeAll: true }], JOINED);
    expect(staleLines(bridged.warnings)).toEqual(['Flow_AToJoin Activity_A->Event_Done => Flow_AToDone', 'Flow_BToJoin Activity_B->Event_Done => Flow_BToDone']);
  });

  it('nodes moved together keep the flow between them, also when they are appended; later ops of the batch use every id', async () => {
    const r = await applyToXml(LINE, [
      { op: 'move', ids: ['Activity_B', 'Activity_C'], after: 'Event_Start' },
      { op: 'set', id: 'Flow_BToC', values: { name: 'go' } },
    ], { keepFlowIds: true, layout: false });
    expect([flowIds(r.result.created), flowIds(r.result.removed)]).toEqual([[], []]);
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_BToC" name="go" sourceRef="Activity_B" targetRef="Activity_C" />');
    // B -> C runs between its old ends again: no warning for it
    expect(staleLines(r.result.warnings.added).sort()).toEqual([
      'Flow_AToB Activity_A->Event_Done => Flow_AToDone',
      'Flow_CToDone Activity_C->Activity_A => Flow_CToA',
      'Flow_StartToA Event_Start->Activity_B => Flow_StartToB',
    ]);
    // after a gateway B is appended (a new flow into it); C is appended to B through B's old out-flow, C's has no place
    const appended = await kept([{ op: 'move', ids: ['Activity_B', 'Activity_C'], after: 'Activity_A' }], FORKED);
    expect(flowBetween(appended.doc, 'Activity_B', 'Activity_C')).toBe('Flow_BToC');
    expect([flowIds(appended.cs.created), flowIds(appended.cs.removed)]).toEqual([['Flow_AToB_2'], ['Flow_CToDone']]);
    expect(staleLines(appended.warnings)).toEqual(['Flow_AToB Activity_A->Event_Done => Flow_AToDone']);
  });

  it('nodes moved together keep the flow between them when the second is not bridged: an end event, a join', async () => {
    // C is put back where it was, then Done: Done has no flow out, so C -> Done is taken out and put back by the append
    const tail = await applyToXml(LINE, [{ op: 'move', ids: ['Activity_C', 'Event_Done'], after: 'Activity_B' }], { keepFlowIds: true, layout: false });
    expect([flowIds(tail.result.created), flowIds(tail.result.removed)]).toEqual([[], []]);
    expect(tail.result.warnings.added.map((w) => w.code)).toEqual([]);
    expect(tail.xml).toContain('<bpmn:sequenceFlow id="Flow_CToDone" sourceRef="Activity_C" targetRef="Event_Done" />');
    // Done has two flows in: B -> Done is removed like every other flow of a node that is not bridged, A -> Done stays A's
    const shared = await kept([{ op: 'move', ids: ['Activity_A', 'Event_Done'], after: 'Activity_B' }], SHARED_END);
    expect(flowBetween(shared.doc, 'Activity_A', 'Event_Done')).toBe('Flow_AToDone');
    expect([flowIds(shared.cs.created), flowIds(shared.cs.removed)]).toEqual([[], ['Flow_OkToA']]);
    expect(shared.warnings.map((w) => w.code)).not.toContain('W_ID_SUFFIXED');
    // a gateway first: the next node is appended to it (a new branch), so its out-flow waits for that append
    const gateway = await kept([{ op: 'move', ids: ['Gateway_Ok', 'Activity_Book'], after: 'Event_Start' }]);
    expect(flowBetween(gateway.doc, 'Gateway_Ok', 'Activity_Book')).toBe('Flow_OkToBook');
    expect([flowIds(gateway.cs.created), flowIds(gateway.cs.removed)]).toEqual([['Flow_OkToCheck'], ['Flow_BookToDone']]);
    // the flow keeps what it had: the name the prepend gave A -> Join, before the join moves after A
    const named = await kept([{ op: 'move', ids: ['Activity_A', 'Gateway_Join'], before: 'Gateway_Join', flowName: 'done' }], JOINED);
    expect(flowBetween(named.doc, 'Activity_A', 'Gateway_Join')).toBe('Flow_AToJoin');
    expect(named.doc.get('Flow_AToJoin')!.get('name')).toBe('done');
    expect(flowIds(named.cs.created)).toEqual([]);
  });

  it('a moved node that is not bridged puts its out-flow back without the label and condition no bridge took, and says so; between its old ends it keeps them', async () => {
    const r = await applyToXml(JOIN_B, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_C' }], { keepFlowIds: true, layout: false });
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_BToC" sourceRef="Activity_B" targetRef="Event_Done" />');
    const dropped = r.result.warnings.added.filter((w) => w.code === 'W_LABEL_DROPPED' || w.code === 'W_CONDITION_DROPPED');
    expect(dropped.map((w) => `${w.code} ${w.element}: ${w.message}`)).toEqual([
      'W_LABEL_DROPPED Flow_BToC: Flow label "approved" of Flow_BToC was dropped while moving Activity_B: Activity_B was not bridged, so nothing at its old place took it, and Flow_BToC was put back at its new place without it',
      'W_CONDITION_DROPPED Flow_BToC: Condition of Flow_BToC was dropped while moving Activity_B: Activity_B was not bridged, so nothing at its old place took it, and Flow_BToC was put back at its new place without it',
    ]);
    // B before C: Flow_BToC is put back between its old ends, with its label and condition
    const same = await applyToXml(JOIN_B, [{ op: 'move', ids: ['Activity_B'], before: 'Activity_C' }], { keepFlowIds: true, layout: false });
    expect(same.xml).toMatch(/<bpmn:sequenceFlow id="Flow_BToC" name="approved" sourceRef="Activity_B" targetRef="Activity_C">\s*<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{approved\}<\/bpmn:conditionExpression>/);
    expect(same.result.warnings.added.map((w) => w.code)).not.toContain('W_LABEL_DROPPED');
    // a bridged node: the bridge takes both (A -> C), nothing is dropped
    const bridged = await applyToXml(LINE.replace('id="Flow_BToC" sourceRef', 'id="Flow_BToC" name="approved" sourceRef'), [{ op: 'move', ids: ['Activity_B'], after: 'Activity_C' }], { keepFlowIds: true, layout: false });
    expect(bridged.xml).toContain('<bpmn:sequenceFlow id="Flow_AToB" name="approved" sourceRef="Activity_A" targetRef="Activity_C" />');
    expect(bridged.result.warnings.added.map((w) => w.code)).not.toContain('W_LABEL_DROPPED');
    // by default the flow is removed and the change names it with its label, as before
    const renamed = await applyToXml(JOIN_B, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_C' }], { layout: false });
    expect(renamed.result.removed).toContainEqual({ id: 'Flow_BToC', kind: 'sequenceFlow', name: 'approved', detail: 'Activity_B -> Activity_C' });
    expect(renamed.result.warnings.added.map((w) => w.code)).not.toContain('W_LABEL_DROPPED');
  });

  it('a chain whose first node is not bridged: the flow to the next node, put back elsewhere and then between its old ends again, gets its label back', async () => {
    // A's splice puts A -> B back as A -> Done, B's splice after A ends it at B again
    const r = await applyToXml(APART, [{ op: 'move', ids: ['Activity_A', 'Activity_B'], after: 'Activity_X' }], { keepFlowIds: true, layout: false });
    expect(r.xml).toMatch(/<bpmn:sequenceFlow id="Flow_AToB" name="approved" sourceRef="Activity_A" targetRef="Activity_B">\s*<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{approved\}<\/bpmn:conditionExpression>/);
    expect(r.result.warnings.added.map((w) => w.code)).toEqual(['W_FLOW_ID_STALE']);
    expect(r.result.changed.filter((c) => c.id === 'Flow_AToB')).toEqual([{ id: 'Flow_AToB', kind: 'sequenceFlow', name: 'approved', detail: 'Activity_A -> Activity_B' }]);
    // its default marker comes back the same way
    const marked = APART.replace('<bpmn:task id="Activity_A" name="A">', '<bpmn:task id="Activity_A" name="A" default="Flow_AToB">').replace(/<bpmn:conditionExpression.*?<\/bpmn:conditionExpression>/, '');
    const def = await kept([{ op: 'move', ids: ['Activity_A', 'Activity_B'], after: 'Activity_X' }], marked);
    expect(def.doc.get('Activity_A')!.get<El>('default')).toBe(def.doc.get('Flow_AToB'));
    expect(def.warnings.map((w) => w.code)).toEqual(['W_FLOW_ID_STALE']);
  });

  it('a put-back default flow never carries a condition, and a default the placement gave wins over the marker the flow had', async () => {
    // B (two flows in, not bridged) before C, its old target: the prepend makes Flow_BToC the default flow, so its condition stays dropped
    const r = await applyToXml(JOIN_B, [{ op: 'move', ids: ['Activity_B'], before: 'Activity_C', default: true }], { keepFlowIds: true, layout: false });
    expect(r.xml).toContain('<bpmn:task id="Activity_B" name="B" default="Flow_BToC">');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_BToC" name="approved" sourceRef="Activity_B" targetRef="Activity_C" />');
    expect(r.result.warnings.added.filter((w) => w.code === 'W_CONDITION_DROPPED').map((w) => w.message)).toEqual([
      'Condition of Flow_BToC was dropped while moving Activity_B: Flow_BToC is now the default flow of Activity_B',
    ]);
    // the join's default flow comes back to Done, but the prepend made Join -> Archive the default, as asked (as by default)
    const archive = JOINED.replace('<bpmn:exclusiveGateway id="Gateway_Join">', '<bpmn:exclusiveGateway id="Gateway_Join" default="Flow_JoinToDone">')
      .replace('<bpmn:endEvent id="Event_Done"', '<bpmn:task id="Activity_Archive" name="Archive" />\n    <bpmn:endEvent id="Event_Done"');
    const ops: Op[] = [{ op: 'move', ids: ['Gateway_Join', 'Event_Done'], before: 'Activity_Archive', default: true }];
    const wins = await kept(ops, archive);
    expect(flowBetween(wins.doc, 'Gateway_Join', 'Event_Done')).toBe('Flow_JoinToDone');
    expect(wins.doc.get('Gateway_Join')!.get<El>('default')).toBe(wins.doc.get('Flow_JoinToArchive'));
    expect(wins.cs.changed.filter((c) => c.id === 'Flow_JoinToDone').map((c) => c.detail)).toEqual(['Gateway_Join -> Event_Done (no longer the default flow of Gateway_Join)']);
    expect((await applyToXml(archive, ops, { layout: false })).xml).toContain('<bpmn:exclusiveGateway id="Gateway_Join" default="Flow_JoinToArchive">');
  });

  it('none for a hashed id, an id that did not name its ends, ends a later op restored, or a flow a later op removed', async () => {
    const hashed = await kept([{ op: 'add', kind: 'task', name: 'Pack', after: 'Activity_0k3x9qa' }], MODELER);
    expect(stale(hashed.warnings)).toEqual([]);
    expect(flowBetween(hashed.doc, 'Activity_0k3x9qa', 'Activity_Pack')).toBe('Flow_1q2w3e4');
    const own = await kept([
      { op: 'connect', source: 'Gateway_Ok', target: 'Event_Done', id: 'Flow_Shortcut', name: 'skip' },
      { op: 'add', kind: 'task', name: 'Log', flow: 'Flow_Shortcut' },
    ]);
    expect(stale(own.warnings)).toEqual([]);
    // add, then remove the new node: the bridge puts the flow back between its old ends
    const restored = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'remove', ids: ['Activity_Review'] },
    ]);
    expect(stale(restored.warnings)).toEqual([]);
    expect(flowBetween(restored.doc, 'Activity_Check', 'Gateway_Ok')).toBe('Flow_CheckToOk');
    // Flow_CheckToOk goes stale, then goes with Activity_Check; the bridge of that remove makes Flow_StartToCheck stale
    const gone = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'remove', ids: ['Activity_Check'] },
    ]);
    expect(staleLines(gone.warnings)).toEqual(['Flow_StartToCheck Event_Start->Activity_Review => Flow_StartToReview']);
  });

  it('a flow created earlier in the same change follows its ends; one warning per flow, against its final ends', async () => {
    const r = await applyToXml(await drawnDefault(), [
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'add', kind: 'task', name: 'Approve', after: 'Activity_Review' },
      { op: 'add', kind: 'task', name: 'Archive', before: 'Activity_Review' },
    ], { keepFlowIds: true });
    // Flow_ReviewToOk (made by the first op) was spliced by the second: renamed after its new ends, listed under its final id
    expect(r.result.created.map((c) => c.id)).toEqual(['Activity_Review', 'Flow_ReviewToApprove', 'Activity_Approve', 'Flow_ApproveToOk', 'Activity_Archive', 'Flow_ArchiveToReview']);
    expect(r.result.renamed).toBeUndefined();
    // Flow_CheckToOk was spliced twice (Check -> Review, then Check -> Archive): one warning, its first ends and its last
    expect(stale(r.result.warnings.added).map((w) => w.message)).toEqual(['Flow Flow_CheckToOk kept its id, which names its old ends Activity_Check -> Gateway_Ok; it now runs Activity_Check -> Activity_Archive']);
  });

  it('a flow the same change renames with `set id=` takes that id; a later splice names the ends that id named', async () => {
    const chosen = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'set', id: 'Flow_CheckToOk', values: { id: 'Flow_ToReview' } },
    ]);
    expect(stale(chosen.warnings)).toEqual([]);
    const spliced = await kept([
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'set', id: 'Flow_CheckToOk', values: { id: 'Flow_CheckToReview' } },
      { op: 'add', kind: 'task', name: 'Archive', after: 'Activity_Check' },
    ]);
    expect(stale(spliced.warnings).map((w) => w.message)).toEqual(['Flow Flow_CheckToReview kept its id, which names its old ends Activity_Check -> Activity_Review; it now runs Activity_Check -> Activity_Archive']);
  });

  it('the default renames as before and never warns', async () => {
    const r = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' }]);
    expect(r.result.renamed).toEqual({ Flow_CheckToOk: 'Flow_CheckToReview' });
    expect(stale(r.result.warnings.added)).toEqual([]);
    const off = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' }], { keepFlowIds: false });
    expect(off.result.renamed).toEqual({ Flow_CheckToOk: 'Flow_CheckToReview' });
  });
});

describe('keepFlowIds in the library: the option, Doc.followFlowEnds and the report', () => {
  it('an explicit option wins over Doc.followFlowEnds, which is the caller\'s again afterwards (also after a refusal)', async () => {
    const doc = await Doc.fromXml(CHAIN);
    doc.followFlowEnds = false;
    const renamed = await mutateDoc(doc, [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' }], { keepFlowIds: false, layout: false });
    expect(renamed.changes.renames.map((r) => `${r.from} -> ${r.to}`)).toEqual(['Flow_CheckToOk -> Flow_CheckToReview']);
    expect(doc.followFlowEnds).toBe(false);
    // undefined: the field decides
    const keptDoc = await Doc.fromXml(CHAIN);
    keptDoc.followFlowEnds = false;
    const kept = await mutateDoc(keptDoc, [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' }], { layout: false });
    expect(stale(kept.changes.warnings).map((w) => w.element)).toEqual(['Flow_CheckToOk']);
    const fresh = await Doc.fromXml(CHAIN);
    await expect(mutateDoc(fresh, [{ op: 'add', kind: 'task', name: 'Review', after: 'Activity_Nope' }], { keepFlowIds: true, layout: false })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect(fresh.followFlowEnds).toBe(true);
  });

  it('runOp on its own reports the flow it kept, like a batch', async () => {
    const doc = await Doc.fromXml(CHAIN);
    doc.followFlowEnds = false;
    const cs = runOp(doc, { op: 'remove', ids: ['Activity_Book'] });
    expect(staleLines(cs.warnings)).toEqual(['Flow_OkToBook Gateway_Ok->Event_Done => Flow_OkToDone']);
  });

  it('a flow the op or an earlier op of the batch created follows its ends, with runOp on its own too', async () => {
    const move: Op = { op: 'move', ids: ['Activity_B', 'Activity_C'], after: 'Event_Start' };
    const alone = await Doc.fromXml(TWO_OUT);
    alone.followFlowEnds = false;
    const single = runOp(alone, move);
    // B had two out-flows (not bridged, removed): the move made Flow_BToA, then spliced it to B -> C
    expect(single.renames.map((r) => `${r.from} -> ${r.to}`)).toEqual(['Flow_BToA -> Flow_BToC_2']);
    expect(staleLines(single.warnings).sort()).toEqual(['Flow_CToDone Activity_C->Activity_A => Flow_CToA', 'Flow_StartToA Event_Start->Activity_B => Flow_StartToB']);
    const batch = await kept([move], TWO_OUT);
    expect(staleLines(batch.warnings).sort()).toEqual(staleLines(single.warnings).sort());
    // 0.6 kept every id with Doc.followFlowEnds = false; now only the flows the document had
    const doc = await Doc.fromXml(CHAIN);
    doc.followFlowEnds = false;
    const cs = runOps(doc, [
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'add', kind: 'task', name: 'Approve', after: 'Activity_Review' },
    ]);
    expect(cs.renames.map((r) => `${r.from} -> ${r.to}`)).toEqual(['Flow_ReviewToOk -> Flow_ReviewToApprove']);
    expect(cs.created.map((c) => c.id)).toContain('Flow_ReviewToApprove');
  });

  it('only the change reports it (warnings.added, never counted as the file\'s); text gives each stale flow its own line', async () => {
    const r = await applyToXml(await drawnDefault(), [
      { op: 'add', kind: 'task', name: 'Review', after: 'Activity_Check' },
      { op: 'add', kind: 'task', name: 'Prepare', before: 'Activity_Check' },
      { op: 'add', kind: 'task', name: 'Pay', after: 'Activity_Book' },
    ], { keepFlowIds: true });
    expect(staleLines(r.result.warnings.added).sort()).toEqual([
      'Flow_BookToDone Activity_Book->Activity_Pay => Flow_BookToPay',
      'Flow_CheckToOk Activity_Check->Activity_Review => Flow_CheckToReview',
      'Flow_StartToCheck Event_Start->Activity_Prepare => Flow_StartToPrepare',
    ]);
    expect(r.result.warnings.preexistingCount).toBe(0);
    const text = renderMutation(r.result);
    expect(text.match(/^warning W_FLOW_ID_STALE /gm)).toHaveLength(3);
    for (const cmd of ['id=Flow_BookToPay', 'id=Flow_CheckToReview', 'id=Flow_StartToPrepare']) expect(text).toContain(cmd);
    // the next, unrelated change does not repeat it
    const next = await applyToXml(r.xml, [{ op: 'set', id: 'Activity_Pay', values: { name: 'Pay invoice' } }], { keepFlowIds: true });
    expect(stale(next.result.warnings.added)).toEqual([]);
    expect(next.result.warnings.preexistingCount).toBe(0);
  });

  it('a later change that leaves a stale flow where it was does not repeat it, although the flow passes its old ends on the way', async () => {
    const first = await applyToXml(LINE, [{ op: 'add', kind: 'task', name: 'X', after: 'Activity_A' }], { keepFlowIds: true, layout: false });
    expect(staleLines(first.result.warnings.added)).toEqual(['Flow_AToB Activity_A->Activity_X => Flow_AToX']);
    // moving X away and back: the bridge runs Flow_AToB A -> B (the ends its id names), the splice A -> X again
    const away: Op[] = [{ op: 'move', ids: ['Activity_X'], after: 'Activity_C' }, { op: 'move', ids: ['Activity_X'], after: 'Activity_A' }];
    const again = await applyToXml(first.xml, away, { keepFlowIds: true, layout: false });
    expect(stale(again.result.warnings.added)).toEqual([]);
    const doc = await Doc.fromXml(first.xml);
    doc.followFlowEnds = false;
    expect(stale(runOps(doc, away).warnings)).toEqual([]);
    // a later op of the same change that gives it other ends again reports it
    const moved = await kept([...away, { op: 'add', kind: 'task', name: 'Y', after: 'Activity_A' }], first.xml);
    expect(staleLines(moved.warnings)).toEqual(['Flow_AToB Activity_A->Activity_Y => Flow_AToY']);
  });
});

describe('an end renamed or named earlier in the change, and --flow-id on a splice', () => {
  /** CHAIN with a Camunda Modeler id for Check (its id says nothing: it is named by its name) and an unnamed Done. */
  const HASHED = CHAIN.replace(/Activity_Check/g, 'Activity_0abc123').replace('<bpmn:endEvent id="Event_Done" name="Done">', '<bpmn:endEvent id="Event_Done">');

  /** `old -> new` of the renames by default, and `flow source->target => suggested id` of each W_FLOW_ID_STALE with ids kept. */
  async function bothModes(xml: string, ops: Op[]): Promise<{ renamed: string[]; stale: string[] }> {
    const follow = await Doc.fromXml(xml);
    const renamed = runOps(follow, ops).renames.map((r) => `${r.from} -> ${r.to}`);
    const keep = await kept(ops, xml);
    expect(keep.renames).toBe(0);
    return { renamed, stale: staleLines(keep.warnings) };
  }

  it('an end `set id=` gave another id earlier in the batch: its flows follow, or with ids kept are reported, by default and with ids kept', async () => {
    const renamedThenSpliced = await bothModes(CHAIN, [
      { op: 'set', id: 'Activity_Check', values: { id: 'Activity_Verify' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'Activity_Verify' },
    ]);
    expect(renamedThenSpliced).toEqual({ renamed: ['Flow_CheckToOk -> Flow_VerifyToLog'], stale: ['Flow_CheckToOk Activity_Verify->Activity_Log => Flow_VerifyToLog'] });
    // --flow names the flow by its id, the target end too
    expect(await bothModes(CHAIN, [
      { op: 'set', id: 'Gateway_Ok', values: { id: 'Gateway_Approved' } },
      { op: 'add', kind: 'task', name: 'Audit', flow: 'Flow_CheckToOk' },
    ])).toEqual({ renamed: ['Flow_CheckToOk -> Flow_CheckToAudit'], stale: ['Flow_CheckToOk Activity_Check->Activity_Audit => Flow_CheckToAudit'] });
    // an unnamed end: only the id it had tells (Flow_BookToDone, Done renamed Finished); a remove bridges to it
    expect(await bothModes(HASHED, [
      { op: 'set', id: 'Event_Done', values: { id: 'Event_Finished' } },
      { op: 'add', kind: 'task', name: 'Log', before: 'Event_Finished' },
    ])).toEqual({ renamed: ['Flow_BookToDone -> Flow_BookToLog'], stale: ['Flow_BookToDone Activity_Book->Activity_Log => Flow_BookToLog'] });
    expect(await bothModes(HASHED, [
      { op: 'set', id: 'Event_Done', values: { id: 'Event_Finished' } },
      { op: 'remove', ids: ['Activity_Book'] },
    ])).toEqual({ renamed: ['Flow_OkToBook -> Flow_OkToFinished'], stale: ['Flow_OkToBook Gateway_Ok->Event_Finished => Flow_OkToFinished'] });
  });

  it('an end `set name=` named again (its id says nothing), and `set id=` in a command before (the end keeps its name): the same', async () => {
    expect(await bothModes(HASHED, [
      { op: 'set', id: 'Activity_0abc123', values: { name: 'Verify' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'Activity_0abc123' },
    ])).toEqual({ renamed: ['Flow_CheckToOk -> Flow_VerifyToLog'], stale: ['Flow_CheckToOk Activity_0abc123->Activity_Log => Flow_VerifyToLog'] });
    // two commands: the first renames Check, the second splices after it; Check is still named Check
    const first = await applyToXml(await drawnDefault(), [{ op: 'set', id: 'Activity_Check', values: { id: 'Activity_Verify' } }]);
    expect(first.xml).toContain('<bpmn:sequenceFlow id="Flow_CheckToOk" sourceRef="Activity_Verify" targetRef="Gateway_Ok" />');
    const splice: Op[] = [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_Verify' }];
    const renamed = await applyToXml(first.xml, splice);
    expect(renamed.result.renamed).toEqual({ Flow_CheckToOk: 'Flow_VerifyToLog' });
    expect(renamed.xml).toContain('<bpmndi:BPMNEdge id="Flow_VerifyToLog_di" bpmnElement="Flow_VerifyToLog">');
    const keptIds = await applyToXml(first.xml, splice, { keepFlowIds: true });
    expect(staleLines(keptIds.result.warnings.added)).toEqual(['Flow_CheckToOk Activity_Verify->Activity_Log => Flow_VerifyToLog']);
    // the warning's command renames it; nothing is stale afterwards
    const followed = await applyToXml(keptIds.xml, [{ op: 'set', id: 'Flow_CheckToOk', values: { id: 'Flow_VerifyToLog' } }], { keepFlowIds: true });
    expect(stale(followed.result.warnings.added)).toEqual([]);
  });

  it('a retype between the `set` and the end change (a new element of the new type) keeps what the end was called', async () => {
    for (const retype of [{ op: 'retype', id: 'Activity_0abc123', kind: 'userTask' }, { op: 'retype', id: 'Activity_0abc123', kind: 'serviceTask' }] as Op[]) {
      expect(await bothModes(HASHED, [
        { op: 'set', id: 'Activity_0abc123', values: { name: 'Verify' } },
        retype,
        { op: 'add', kind: 'task', name: 'Log', after: 'Activity_0abc123' },
      ])).toEqual({ renamed: ['Flow_CheckToOk -> Flow_VerifyToLog'], stale: ['Flow_CheckToOk Activity_0abc123->Activity_Log => Flow_VerifyToLog'] });
    }
  });

  it('a renamed end changes nothing else: flows whose ends stay keep their ids, and a flow whose id names no ends stays', async () => {
    // Book is renamed, the splice is after Check: Flow_CheckToOk follows as always, Flow_OkToBook and Flow_BookToDone keep their ids
    const r = await bothModes(CHAIN, [
      { op: 'set', id: 'Activity_Book', values: { id: 'Activity_Post', name: 'Post' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'Activity_Check' },
    ]);
    expect(r).toEqual({ renamed: ['Flow_CheckToOk -> Flow_CheckToLog'], stale: ['Flow_CheckToOk Activity_Check->Activity_Log => Flow_CheckToLog'] });
    const own = await bothModes(CHAIN.replace(/Flow_CheckToOk/g, 'Flow_Review'), [
      { op: 'set', id: 'Activity_Check', values: { id: 'Activity_Verify' } },
      { op: 'add', kind: 'task', name: 'Log', after: 'Activity_Verify' },
    ]);
    expect(own).toEqual({ renamed: [], stale: [] });
  });

  it('--flow-id on a splice with ids kept: W_FLOW_ID_STALE suggests it, W_OPTION_IGNORED names no second command, and every hint can be followed', async () => {
    for (const placement of [{ flow: 'Flow_CheckToOk' }, { after: 'Activity_Check' }]) {
      const r = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Audit', ...placement, flowId: 'Flow_IntoAudit' }], { keepFlowIds: true });
      const ignored = r.result.warnings.added.filter((w) => w.code === 'W_OPTION_IGNORED');
      expect(ignored.map((w) => w.hint)).toEqual(['--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); W_FLOW_ID_STALE names the command that renames Flow_CheckToOk.']);
      expect(staleLines(r.result.warnings.added)).toEqual(['Flow_CheckToOk Activity_Check->Activity_Audit => Flow_IntoAudit']);
      // every command the warnings name, in order: one per flow, none fails
      const commands = r.result.warnings.added.flatMap((w) => [...(w.hint ?? '').matchAll(/`bpmn set <file> (\S+) id=(\S+)`/g)]);
      expect(commands.map((m) => `${m[1]} -> ${m[2]}`)).toEqual(['Flow_CheckToOk -> Flow_IntoAudit']);
      const followed = await applyToXml(r.xml, commands.map((m) => ({ op: 'set', id: m[1]!, values: { id: m[2]! } })), { keepFlowIds: true });
      expect(followed.xml).toContain('<bpmn:sequenceFlow id="Flow_IntoAudit" sourceRef="Activity_Check" targetRef="Activity_Audit" />');
    }
    // by default the flow follows its ends and W_OPTION_IGNORED names the one rename, as before
    const renamed = await applyToXml(await drawnDefault(), [{ op: 'add', kind: 'task', name: 'Audit', flow: 'Flow_CheckToOk', flowId: 'Flow_IntoAudit' }]);
    expect(renamed.result.warnings.added.map((w) => `${w.code}: ${w.hint}`)).toEqual([
      'W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); rename the existing one with `bpmn set <file> Flow_CheckToAudit id=Flow_IntoAudit`.',
    ]);
  });

  it('--flow-id with ids kept: a taken id, a later splice into the same flow or a flow that does not name its ends give the id its ends give, or the old command', async () => {
    // taken: the speaking id
    const taken = await kept([{ op: 'add', kind: 'task', name: 'Audit', flow: 'Flow_CheckToOk', flowId: 'Flow_StartToCheck' }]);
    expect(staleLines(taken.warnings)).toEqual(['Flow_CheckToOk Activity_Check->Activity_Audit => Flow_CheckToAudit']);
    // the flow no longer ends at Audit: Log was put in between, so --flow-id no longer describes it
    const later = await kept([
      { op: 'add', kind: 'task', name: 'Audit', flow: 'Flow_CheckToOk', flowId: 'Flow_IntoAudit' },
      { op: 'add', kind: 'task', name: 'Log', after: 'Activity_Check' },
    ]);
    expect(staleLines(later.warnings)).toEqual(['Flow_CheckToOk Activity_Check->Activity_Log => Flow_CheckToLog']);
    // a hashed flow keeps its id without going stale: W_OPTION_IGNORED keeps its own command
    const hashed = await kept([{ op: 'add', kind: 'task', name: 'Pack', after: 'Activity_0k3x9qa', flowId: 'Flow_IntoPack' }], MODELER);
    expect(hashed.warnings.map((w) => `${w.code}: ${w.hint}`)).toEqual([
      'W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); rename the existing one with `bpmn set <file> Flow_1q2w3e4 id=Flow_IntoPack`.',
    ]);
  });

  it('--flow-id with ids kept where no W_FLOW_ID_STALE comes: W_OPTION_IGNORED names its own command, or none where it could not be followed', async () => {
    const hints = (ws: readonly Warning[]): string[] => ws.map((w) => `${w.code}: ${w.hint}`);
    const own = (flow: string, id: string): string =>
      `W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node); rename the existing one with \`bpmn set <file> ${flow} id=${id}\`.`;
    const none = 'W_OPTION_IGNORED: --flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node).';
    // the kept flow still names its new ends: a task named Ok before the gateway Ok?, an unnamed gateway before the unnamed Gateway_1
    expect(hints((await kept([{ op: 'add', kind: 'task', name: 'Ok', flow: 'Flow_CheckToOk', flowId: 'Flow_IntoOk' }])).warnings)).toEqual([own('Flow_CheckToOk', 'Flow_IntoOk')]);
    const unnamed = CHAIN.replace('<bpmn:exclusiveGateway id="Gateway_Ok" name="Ok?"', '<bpmn:exclusiveGateway id="Gateway_1"').replace(/Gateway_Ok/g, 'Gateway_1').replace(/Flow_CheckToOk/g, 'Flow_CheckToGateway');
    expect(hints((await kept([{ op: 'add', kind: 'parallelGateway', flow: 'Flow_CheckToGateway', flowId: 'Flow_IntoFork' }], unnamed)).warnings)).toEqual([own('Flow_CheckToGateway', 'Flow_IntoFork')]);
    // a later op puts the flow back between its old ends (it was not made stale)
    const putBack = await kept([
      { op: 'add', kind: 'task', name: 'Audit', flow: 'Flow_CheckToOk', flowId: 'Flow_IntoAudit', as: '$a' },
      { op: 'remove', ids: ['$a'] },
    ]);
    expect(hints(putBack.warnings)).toEqual([own('Flow_CheckToOk', 'Flow_IntoAudit')]);
    // a later op renames the flow, or takes the --flow-id: no command that would fail
    const renamed = await kept([
      { op: 'add', kind: 'task', name: 'Audit', flow: 'Flow_CheckToOk', flowId: 'Flow_IntoAudit' },
      { op: 'set', id: 'Flow_CheckToOk', values: { id: 'Flow_Review' } },
    ]);
    expect(hints(renamed.warnings)).toEqual([none]);
    const taken = await kept([
      { op: 'add', kind: 'task', name: 'Ok', flow: 'Flow_CheckToOk', flowId: 'Flow_IntoOk' },
      { op: 'add', kind: 'task', id: 'Flow_IntoOk', name: 'X', in: 'Process_1' },
    ]);
    expect(hints(taken.warnings).filter((h) => h.startsWith('W_OPTION_IGNORED'))).toEqual([none]);
  });
});

/** LINE where B -> C has a label and a condition. */
const NAMED_LINE = LINE.replace(
  '<bpmn:sequenceFlow id="Flow_BToC" sourceRef="Activity_B" targetRef="Activity_C" />',
  '<bpmn:sequenceFlow id="Flow_BToC" name="approved" sourceRef="Activity_B" targetRef="Activity_C"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>',
);

/** Start -> T -> Sub (SubStart -> Inner -> SubEnd) -> Done. */
const WITH_SUB = definitionsXml(`
    <bpmn:startEvent id="Event_Start"><bpmn:outgoing>Flow_StartToT</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_T" name="T"><bpmn:incoming>Flow_StartToT</bpmn:incoming><bpmn:outgoing>Flow_TToSub</bpmn:outgoing></bpmn:task>
    <bpmn:subProcess id="Activity_Sub" name="Sub"><bpmn:incoming>Flow_TToSub</bpmn:incoming><bpmn:outgoing>Flow_SubToDone</bpmn:outgoing>
      <bpmn:startEvent id="Event_SubStart"><bpmn:outgoing>Flow_SubStartToInner</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="Activity_Inner" name="Inner"><bpmn:incoming>Flow_SubStartToInner</bpmn:incoming><bpmn:outgoing>Flow_InnerToSubEnd</bpmn:outgoing></bpmn:task>
      <bpmn:endEvent id="Event_SubEnd"><bpmn:incoming>Flow_InnerToSubEnd</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_SubStartToInner" sourceRef="Event_SubStart" targetRef="Activity_Inner" />
      <bpmn:sequenceFlow id="Flow_InnerToSubEnd" sourceRef="Activity_Inner" targetRef="Event_SubEnd" />
    </bpmn:subProcess>
    <bpmn:endEvent id="Event_Done"><bpmn:incoming>Flow_SubToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToT" sourceRef="Event_Start" targetRef="Activity_T" />
    <bpmn:sequenceFlow id="Flow_TToSub" sourceRef="Activity_T" targetRef="Activity_Sub" />
    <bpmn:sequenceFlow id="Flow_SubToDone" sourceRef="Activity_Sub" targetRef="Event_Done" />`);

/** Start -> A -> T -> Done; a timer on T leads to Remind -> Late. */
const WITH_TIMER = definitionsXml(`
    <bpmn:startEvent id="Event_Start"><bpmn:outgoing>Flow_StartToA</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Activity_A" name="A"><bpmn:incoming>Flow_StartToA</bpmn:incoming><bpmn:outgoing>Flow_AToT</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_T" name="T"><bpmn:incoming>Flow_AToT</bpmn:incoming><bpmn:outgoing>Flow_TToDone</bpmn:outgoing></bpmn:task>
    <bpmn:boundaryEvent id="Event_Timeout" attachedToRef="Activity_T"><bpmn:outgoing>Flow_TimeoutToRemind</bpmn:outgoing><bpmn:timerEventDefinition id="TimerEventDefinition_Timeout" /></bpmn:boundaryEvent>
    <bpmn:task id="Activity_Remind" name="Remind"><bpmn:incoming>Flow_TimeoutToRemind</bpmn:incoming><bpmn:outgoing>Flow_RemindToLate</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done"><bpmn:incoming>Flow_TToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="Event_Late"><bpmn:incoming>Flow_RemindToLate</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToA" sourceRef="Event_Start" targetRef="Activity_A" />
    <bpmn:sequenceFlow id="Flow_AToT" sourceRef="Activity_A" targetRef="Activity_T" />
    <bpmn:sequenceFlow id="Flow_TToDone" sourceRef="Activity_T" targetRef="Event_Done" />
    <bpmn:sequenceFlow id="Flow_TimeoutToRemind" sourceRef="Event_Timeout" targetRef="Activity_Remind" />
    <bpmn:sequenceFlow id="Flow_RemindToLate" sourceRef="Activity_Remind" targetRef="Event_Late" />`);

/** `<flow>: <detail>` of the changed sequence flows. */
const changedFlows = (cs: Pick<ChangeSet, 'changed'>): string[] => cs.changed.filter((c) => c.kind === 'sequenceFlow').map((c) => `${c.id}: ${c.detail}`);

describe('move: a chain anchored on its own nodes, nodes already in place, what the bridge took', () => {
  it('a chain whose --after anchor or --flow source is one of its later nodes, or inside one, is refused before anything changes, in both modes', async () => {
    const cases: Array<[string, Op, string, string]> = [
      [JOINED, { op: 'move', ids: ['Activity_A', 'Gateway_Join', 'Event_Done'], after: 'Gateway_Join' }, 'Gateway_Join cannot anchor the move of Activity_A, Gateway_Join, Event_Done: it is one of the moved nodes', '`bpmn move <file> Activity_A --after Gateway_Join`'],
      [LINE, { op: 'move', ids: ['Activity_A', 'Activity_B'], flow: 'Flow_BToC' }, 'Flow_BToC cannot anchor the move of Activity_A, Activity_B: its source Activity_B is one of the moved nodes', '`bpmn move <file> Activity_A --flow Flow_BToC`'],
      [LINE, { op: 'move', ids: ['Activity_B', 'Activity_C'], after: 'Activity_C' }, 'Activity_C cannot anchor the move of Activity_B, Activity_C: it is one of the moved nodes', '`bpmn move <file> Activity_B --after Activity_C`'],
      // C alone is already after B: the hint has the reorder instead
      [LINE, { op: 'move', ids: ['Activity_C', 'Activity_B'], after: 'Activity_B' }, 'Activity_B cannot anchor the move of Activity_C, Activity_B: it is one of the moved nodes', 'Activity_C is already after Activity_B. Pick an anchor outside the moved nodes, or put Activity_C before Activity_B: `bpmn move <file> Activity_C --before Activity_B`.'],
      [LINE, { op: 'move', ids: ['Activity_A', 'Activity_B'], after: 'Activity_B', before: 'Activity_C' }, 'Activity_B cannot anchor the move of Activity_A, Activity_B: it is one of the moved nodes', '`bpmn move <file> Activity_A --after Activity_B --before Activity_C`'],
      [WITH_SUB, { op: 'move', ids: ['Activity_T', 'Activity_Sub'], after: 'Activity_Inner' }, 'Activity_Inner cannot anchor the move of Activity_T, Activity_Sub: it is inside Activity_Sub, one of the moved nodes', '`bpmn move <file> Activity_T --after Activity_Inner`'],
      // a --before anchor inside a later node: the chain would be placed inside itself
      [WITH_SUB, { op: 'move', ids: ['Activity_T', 'Activity_Sub'], before: 'Activity_Inner' }, 'Activity_Inner cannot anchor the move of Activity_T, Activity_Sub: it is inside Activity_Sub, one of the moved nodes', 'placed inside itself. Pick an anchor outside the moved nodes, or move Activity_T alone: `bpmn move <file> Activity_T --before Activity_Inner`'],
      // a boundary event moves with its host
      [WITH_TIMER, { op: 'move', ids: ['Activity_A', 'Activity_T'], after: 'Event_Timeout' }, 'Event_Timeout cannot anchor the move of Activity_A, Activity_T: it is a boundary event of Activity_T, one of the moved nodes', '`bpmn move <file> Activity_A --after Event_Timeout`'],
      [WITH_TIMER, { op: 'move', ids: ['Activity_A', 'Activity_T'], flow: 'Flow_TimeoutToRemind' }, 'Flow_TimeoutToRemind cannot anchor the move of Activity_A, Activity_T: its source Event_Timeout is a boundary event of Activity_T, one of the moved nodes', '`bpmn move <file> Activity_A --flow Flow_TimeoutToRemind`'],
    ];
    for (const [xml, op, message, command] of cases) {
      for (const keepFlowIds of [true, false]) {
        const what = `${JSON.stringify(op)} keep=${keepFlowIds}`;
        const err = await applyToXml(xml, [op], { keepFlowIds, layout: false }).then(() => undefined, (e: unknown) => e as { code: string; message: string; details: { hint?: string } });
        expect(err, what).toMatchObject({ code: 'E_INVALID_PLACEMENT', message });
        expect(err!.details.hint, what).toContain(command);
        // refused before the first node moved: the document is as it was
        const doc = await Doc.fromXml(xml);
        doc.followFlowEnds = !keepFlowIds;
        const flowsBefore = [...doc.byId().values()].filter((e) => e.$type === 'bpmn:SequenceFlow').map((f) => `${f.get<string>('id')} ${f.get<El>('sourceRef').get<string>('id')}->${f.get<El>('targetRef').get<string>('id')}`);
        expect(() => runOp(doc, op), what).toThrow(message);
        expect([...doc.byId().values()].filter((e) => e.$type === 'bpmn:SequenceFlow').map((f) => `${f.get<string>('id')} ${f.get<El>('sourceRef').get<string>('id')}->${f.get<El>('targetRef').get<string>('id')}`), what).toEqual(flowsBefore);
      }
    }
    // the node itself as the anchor keeps its own message, and so does its own boundary event; a --before anchor in the chain is fine (it ends A -> Join)
    await expect(applyToXml(LINE, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_B' }], { layout: false })).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: 'Activity_B cannot be moved relative to Activity_B: that is the node itself or one of its children' });
    await expect(applyToXml(WITH_TIMER, [{ op: 'move', ids: ['Activity_T'], after: 'Event_Timeout' }], { layout: false })).rejects.toMatchObject({ code: 'E_INVALID_PLACEMENT', message: 'Activity_T cannot be moved relative to Event_Timeout: that is one of its boundary events, which move with it' });
    const afterTimer = await kept([{ op: 'move', ids: ['Activity_A'], after: 'Event_Timeout' }], WITH_TIMER);
    expect([flowBetween(afterTimer.doc, 'Event_Timeout', 'Activity_A'), flowBetween(afterTimer.doc, 'Activity_A', 'Activity_Remind')]).toEqual(['Flow_TimeoutToRemind', 'Flow_AToT']);
    const before = await kept([{ op: 'move', ids: ['Activity_A', 'Gateway_Join'], before: 'Gateway_Join' }], JOINED);
    expect(flowBetween(before.doc, 'Activity_A', 'Gateway_Join')).toBe('Flow_AToJoin');
  });

  it('a move that leaves its nodes where they are changes nothing, in both modes: no write, no warning, the label and condition stay', async () => {
    const cases: Array<[Op, string]> = [
      [{ op: 'move', ids: ['Activity_B'], after: 'Activity_A' }, 'Activity_B is already after Activity_A'],
      [{ op: 'move', ids: ['Activity_B', 'Activity_C'], after: 'Activity_A' }, 'Activity_B, Activity_C are already after Activity_A, in this order'],
      [{ op: 'move', ids: ['Activity_B'], before: 'Activity_C' }, 'Activity_B is already before Activity_C'],
      [{ op: 'move', ids: ['Activity_B', 'Activity_C'], before: 'Event_Done' }, 'Activity_B, Activity_C are already before Event_Done, in this order'],
      [{ op: 'move', ids: ['Activity_B'], after: 'Activity_A', before: 'Activity_C' }, 'Activity_B is already between Activity_A and Activity_C'],
      [{ op: 'move', ids: ['Activity_C', 'Event_Done'], after: 'Activity_B' }, 'Activity_C, Event_Done are already after Activity_B, in this order'],
    ];
    for (const [op, note] of cases) {
      for (const keepFlowIds of [true, false]) {
        const what = `${JSON.stringify(op)} keep=${keepFlowIds}`;
        const r = await applyToXml(NAMED_LINE, [op], { keepFlowIds, layout: false });
        expect(r.unchanged, what).toBe(true);
        expect([r.result.created, r.result.changed, r.result.removed, r.result.renamed], what).toEqual([[], [], [], undefined]);
        expect(r.result.warnings.added, what).toEqual([]);
        expect(r.result.notes, what).toEqual([note]);
      }
    }
    // a drawn file with its layout: nothing to write either
    const drawn = await drawnDefault();
    for (const keepFlowIds of [true, false]) {
      const r = await applyToXml(drawn, [{ op: 'move', ids: ['Activity_Check'], after: 'Event_Start' }], { keepFlowIds });
      expect(r.unchanged).toBe(true);
      expect(r.result.notes).toContain('Activity_Check is already after Event_Start');
    }
    // a hand-made drawing keeps every shape: the incremental layout places no node a move left where it was (--in its own scope too)
    const hand = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'step1', 'far-label.bpmn'), 'utf8');
    for (const op of [{ op: 'move', ids: ['ST', 'SE'], after: 'SS' }, { op: 'move', ids: ['ST'], in: 'SUB' }] satisfies Op[]) {
      const r = await applyToXml(hand, [op]);
      expect([r.unchanged, r.result.layout?.mode, r.result.layout?.moved], JSON.stringify(op)).toEqual([true, 'incremental', []]);
    }
    // flow options describe the flow into the first node, as on a splice: only that flow changes
    for (const keepFlowIds of [true, false]) {
      const r = await applyToXml(NAMED_LINE, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_A', flowName: 'start' }], { keepFlowIds, layout: false });
      expect(changedFlows(r.result)).toEqual(['Flow_AToB: Activity_A -> Activity_B']);
      expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_AToB" name="start" sourceRef="Activity_A" targetRef="Activity_B" />');
      expect(r.xml).toMatch(/<bpmn:sequenceFlow id="Flow_BToC" name="approved" sourceRef="Activity_B" targetRef="Activity_C">\s*<bpmn:conditionExpression/);
    }
    // after a gateway the node is appended as a new branch: that move still runs
    const forked = await applyToXml(FORKED, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_A' }], { layout: false });
    expect(forked.result.notes).toContain('appended after Activity_A');
  });

  it('a "flowId" on a move in place renames the flow into the first node, in both modes', async () => {
    for (const keepFlowIds of [true, false]) {
      const r = await applyToXml(LINE, [{ op: 'move', ids: ['Event_Done'], after: 'Activity_C', flowId: 'Flow_CToEnd' }], { keepFlowIds, layout: false });
      expect([r.result.created, r.result.removed, r.result.warnings.added], `keep=${keepFlowIds}`).toEqual([[], [], []]);
      expect(changedFlows(r.result)).toEqual(['Flow_CToEnd: Activity_C -> Event_Done (renamed from Flow_CToDone)']);
      expect(r.result.notes).toEqual(['Event_Done is already after Activity_C']);
      expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_CToEnd" sourceRef="Activity_C" targetRef="Event_Done" />');
      expect(r.xml).not.toContain('Flow_CToDone');
      // with a name: one entry; the id of another element is refused
      const named = await applyToXml(NAMED_LINE, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_A', flowId: 'Flow_Start', flowName: 'start' }], { keepFlowIds, layout: false });
      expect(changedFlows(named.result)).toEqual(['Flow_Start: Activity_A -> Activity_B (renamed from Flow_AToB)']);
      expect(named.xml).toContain('<bpmn:sequenceFlow id="Flow_Start" name="start" sourceRef="Activity_A" targetRef="Activity_B" />');
      await expect(applyToXml(LINE, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_A', flowId: 'Flow_BToC' }], { keepFlowIds, layout: false })).rejects.toMatchObject({ code: 'E_DUPLICATE_ID' });
    }
  });

  it('with ids kept, the change of a bridged node\'s put-back out-flow names what the bridge took: its name, condition and annotations', async () => {
    const move: Op[] = [{ op: 'move', ids: ['Activity_B'], after: 'Activity_C' }];
    const both = await applyToXml(NAMED_LINE, move, { keepFlowIds: true, layout: false });
    expect(changedFlows(both.result)).toEqual([
      'Flow_AToB: Activity_A -> Activity_C (bridged Activity_B)',
      'Flow_CToDone: Activity_C -> Activity_B (was -> Event_Done)',
      'Flow_BToC: Activity_B -> Event_Done (was -> Activity_C; its name and condition stay with the bridge Flow_AToB)',
    ]);
    expect(both.xml).toMatch(/<bpmn:sequenceFlow id="Flow_AToB" name="approved" sourceRef="Activity_A" targetRef="Activity_C">\s*<bpmn:conditionExpression/);
    expect(renderMutation(both.result)).toContain('changed sequenceFlow Flow_BToC - Activity_B -> Event_Done (was -> Activity_C; its name and condition stay with the bridge Flow_AToB)');
    // an annotation goes with them; a name the bridge already had stays, so only the rest is named
    const annotated = NAMED_LINE.replace('<bpmn:sequenceFlow id="Flow_AToB" sourceRef', '<bpmn:sequenceFlow id="Flow_AToB" name="start" sourceRef')
      .replace('<bpmn:sequenceFlow id="Flow_CToDone"', '<bpmn:textAnnotation id="TextAnnotation_Note"><bpmn:text>note</bpmn:text></bpmn:textAnnotation>\n    <bpmn:association id="Association_Note" sourceRef="Flow_BToC" targetRef="TextAnnotation_Note" />\n    <bpmn:sequenceFlow id="Flow_CToDone"');
    const some = await applyToXml(annotated, move, { keepFlowIds: true, layout: false });
    expect(changedFlows(some.result)).toContain('Flow_BToC: Activity_B -> Event_Done (was -> Activity_C; its condition and annotation stay with the bridge Flow_AToB)');
    expect(some.result.warnings.added.map((w) => w.code)).toContain('W_LABEL_DROPPED');
    // the bridge is the default flow of A: the condition is dropped there (W_CONDITION_DROPPED), so only the name is named
    const byDefault = NAMED_LINE.replace('<bpmn:task id="Activity_A" name="A">', '<bpmn:task id="Activity_A" name="A" default="Flow_AToB">');
    const named = await applyToXml(byDefault, move, { keepFlowIds: true, layout: false });
    expect(changedFlows(named.result)).toContain('Flow_BToC: Activity_B -> Event_Done (was -> Activity_C; its name stays with the bridge Flow_AToB)');
    // put back between its old ends (before the join, a prepend): the clause alone
    const join = JOINED.replace('<bpmn:sequenceFlow id="Flow_AToJoin" sourceRef', '<bpmn:sequenceFlow id="Flow_AToJoin" name="done" sourceRef');
    const back = await applyToXml(join, [{ op: 'move', ids: ['Activity_A'], before: 'Gateway_Join' }], { keepFlowIds: true, layout: false });
    expect(changedFlows(back.result)).toContain('Flow_AToJoin: Activity_A -> Gateway_Join (its name stays with the bridge Flow_OkToA)');
    // nothing to name: as before; by default the out-flow is removed with its label, as before
    expect(changedFlows(await applyToXml(LINE, move, { keepFlowIds: true, layout: false }).then((r) => r.result))).toContain('Flow_BToC: Activity_B -> Event_Done (was -> Activity_C)');
    const renamed = await applyToXml(NAMED_LINE, move, { layout: false });
    expect(renamed.result.removed).toContainEqual({ id: 'Flow_BToC', kind: 'sequenceFlow', name: 'approved', detail: 'Activity_B -> Activity_C' });
    expect(changedFlows(renamed.result).join('\n')).not.toContain('stay');
  });

  it('with ids kept, the clause is decided once the chain is placed: a bridge a later node removed, renamed or took it back from', async () => {
    // A's bridge T -> Done takes "done", then Done's detach (an end event) removes it: Flow_AToDone, back between A and Done, gets it back
    const branched = definitionsXml(`
    <bpmn:startEvent id="Event_Start"><bpmn:outgoing>Flow_StartToOk</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gateway_Ok"><bpmn:incoming>Flow_StartToOk</bpmn:incoming><bpmn:outgoing>Flow_OkToT</bpmn:outgoing><bpmn:outgoing>Flow_OkToU</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="Activity_T"><bpmn:incoming>Flow_OkToT</bpmn:incoming><bpmn:outgoing>Flow_TToA</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Activity_A"><bpmn:incoming>Flow_TToA</bpmn:incoming><bpmn:outgoing>Flow_AToDone</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Done"><bpmn:incoming>Flow_AToDone</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="Activity_U"><bpmn:incoming>Flow_OkToU</bpmn:incoming><bpmn:outgoing>Flow_UToOther</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="Event_Other"><bpmn:incoming>Flow_UToOther</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_StartToOk" sourceRef="Event_Start" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="Flow_OkToT" sourceRef="Gateway_Ok" targetRef="Activity_T" />
    <bpmn:sequenceFlow id="Flow_TToA" sourceRef="Activity_T" targetRef="Activity_A" />
    <bpmn:sequenceFlow id="Flow_AToDone" name="done" sourceRef="Activity_A" targetRef="Event_Done"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${done}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_OkToU" sourceRef="Gateway_Ok" targetRef="Activity_U" />
    <bpmn:sequenceFlow id="Flow_UToOther" sourceRef="Activity_U" targetRef="Event_Other" />`);
    const removed = await applyToXml(branched, [{ op: 'move', ids: ['Activity_A', 'Event_Done'], after: 'Gateway_Ok' }], { keepFlowIds: true, layout: false });
    expect(removed.xml).toMatch(/<bpmn:sequenceFlow id="Flow_AToDone" name="done" sourceRef="Activity_A" targetRef="Event_Done">\s*<bpmn:conditionExpression/);
    expect(changedFlows(removed.result)).toEqual(['Flow_TToA: Activity_T -> Event_Done (bridged Activity_A)', 'Flow_AToDone: Activity_A -> Event_Done']);
    expect(removed.result.removed.map((c) => c.id)).toEqual(['Flow_TToA']);
    expect(removed.result.warnings.added.filter((w) => w.code.endsWith('_DROPPED'))).toEqual([]);
    // T's bridge Ok -> A takes "next", then Ok's detach (a split: not bridged) removes it, and T -> A ends at Ok now: the label is dropped, and said so
    const named = branched.replace('id="Flow_TToA" sourceRef', 'id="Flow_TToA" name="next" sourceRef');
    const lost = await applyToXml(named, [{ op: 'move', ids: ['Activity_T', 'Gateway_Ok'], after: 'Activity_U' }], { keepFlowIds: true, layout: false });
    expect(lost.xml).not.toContain('"next"');
    expect(lost.result.warnings.added.filter((w) => w.code === 'W_LABEL_DROPPED').map((w) => w.message)).toEqual([
      'Flow label "next" of Flow_TToA was dropped while moving Activity_T: the bridge Flow_OkToT took it, and a later node of the move removed Flow_OkToT',
    ]);
    expect(changedFlows(lost.result).join('\n')).not.toContain('stay');
    // a bridge a later node renamed (a flow the batch created follows its ends): the clause names the id it has now
    const long = NAMED_LINE.replace('<bpmn:outgoing>Flow_CToDone</bpmn:outgoing></bpmn:task>', '<bpmn:outgoing>Flow_CToD</bpmn:outgoing></bpmn:task>\n    <bpmn:task id="Activity_D" name="D"><bpmn:incoming>Flow_CToD</bpmn:incoming><bpmn:outgoing>Flow_DToDone</bpmn:outgoing></bpmn:task>')
      .replace('<bpmn:incoming>Flow_CToDone</bpmn:incoming>', '<bpmn:incoming>Flow_DToDone</bpmn:incoming>')
      .replace('<bpmn:sequenceFlow id="Flow_CToDone" sourceRef="Activity_C" targetRef="Event_Done" />', '<bpmn:sequenceFlow id="Flow_CToD" sourceRef="Activity_C" targetRef="Activity_D" />\n    <bpmn:sequenceFlow id="Flow_DToDone" sourceRef="Activity_D" targetRef="Event_Done" />');
    const batch = await applyToXml(long, [{ op: 'add', kind: 'task', name: 'X', after: 'Activity_A' }, { op: 'move', ids: ['Activity_B', 'Activity_C'], after: 'Activity_D' }], { keepFlowIds: true, layout: false });
    expect(batch.xml).toMatch(/<bpmn:sequenceFlow id="Flow_XToD" name="approved" sourceRef="Activity_X" targetRef="Activity_D">/);
    expect(changedFlows(batch.result).filter((c) => c.includes('stay'))).toEqual(['Flow_BToC: Activity_B -> Activity_C (was -> Event_Done; its name and condition stay with the bridge Flow_XToD)']);
    // B and A swap places: the second bridge takes the label back to Flow_BToC, so nothing is said, and each entry is listed once
    const swap = await applyToXml(NAMED_LINE, [{ op: 'move', ids: ['Activity_B', 'Activity_A'], after: 'Event_Start' }], { keepFlowIds: true, layout: false });
    expect(changedFlows(swap.result)).toEqual([
      'Flow_AToB: Activity_A -> Activity_C (bridged Activity_B)',
      'Flow_StartToA: Event_Start -> Activity_B (was -> Activity_A)',
      'Flow_BToC: Activity_B -> Activity_A (was -> Activity_C)',
      'Flow_BToC: Activity_B -> Activity_C (bridged Activity_A)',
      'Flow_AToB: Activity_A -> Activity_C',
    ]);
    expect(swap.xml).toMatch(/<bpmn:sequenceFlow id="Flow_BToC" name="approved" sourceRef="Activity_B" targetRef="Activity_A">\s*<bpmn:conditionExpression/);
  });
});

describe('mixed id styles: a followed hint still names its ends on the next read, and the flow form stays put', () => {
  const fixture = (...path: string[]): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', ...path), 'utf8');

  /** Follows every W_FLOW_ID_STALE hint of `res` (`bpmn set <file> <flow> id=<suggested>`) and reads the result again. */
  async function follow(xml: string, warnings: readonly Warning[]): Promise<{ followed: string[]; naming: string[]; before: unknown; after: unknown }> {
    const ops: Op[] = stale(warnings).map((w) => ({ op: 'set', id: w.element!, values: { id: / id=(\S+)`/.exec(w.hint!)![1]! } }));
    const done = await applyToXml(xml, ops, { keepFlowIds: true, layout: false });
    const doc = await Doc.fromXml(done.xml);
    const naming = ops.flatMap((o) => {
      const id = (o as { values: { id: string } }).values.id;
      const flow = doc.get(id)!;
      return idNamesEnds(doc, id, flow.get<El>('sourceRef'), flow.get<El>('targetRef')) ? [id] : [];
    });
    return { followed: ops.map((o) => (o as { values: { id: string } }).values.id), naming, before: (await Doc.fromXml(xml)).idStyle.info().sequenceFlow, after: doc.idStyle.info().sequenceFlow };
  }

  // the five 'follow hints' violations of the keep-mode fuzz campaigns (seeds 1003, 9456, 9473, 7392, 7922): each followed
  // id named its ends no more on the next read, because the file's flow prefix flipped (f -> Flow_: bpmn-cli's glued flows
  // did not vote; G or F, tied: the first declared won)
  const CASES: Array<[string, string, Op]> = [
    ['polish-remove-9456.bpmn', 'fHandleTicketToFz6Archive', { op: 'add', kind: 'subProcess', name: 'Fz6 archive', before: 'Activity_Fz3Pay' }],
    ['expand-sibling-9473.bpmn', 'G_Fz6ArchiveToFz3Check G_Fz3CheckToThen', { op: 'move', ids: ['Activity_Fz3Check', 'T', 'P'], before: 'E' }],
    ['polish-lanes-7392.bpmn', 'fFz5CheckToReviewLarge', { op: 'move', ids: ['Gateway_Fz5Check', 'T2'], after: 'G1' }],
    ['pool-branch-7922.bpmn', 'F_CarrierToParcel', { op: 'move', ids: ['T_UP', 'T_LOW'], before: 'E1', flowName: 'fn4', default: true }],
  ];
  it.each(CASES)('%s: the followed ids (%s) name their ends on the next read', async (file, ids, op) => {
    const xml = fixture('mixed-styles', file);
    const res = await applyToXml(xml, [op], { keepFlowIds: true, layout: false });
    const { followed, naming, before, after } = await follow(res.xml, res.result.warnings.added);
    expect(followed.join(' ')).toBe(ids);
    expect(naming).toEqual(followed);
    expect(after).toEqual(before);
  });

  it('seed 1003: six commands on polish-remove.bpmn, the split hint followed, still names its ends', async () => {
    const ops: Op[] = [
      { op: 'move', ids: ['H'], after: 'M' },
      { op: 'add', kind: 'task', name: 'Fz2 check', after: 'S' },
      { op: 'move', ids: ['H'], before: 'E2' },
      { op: 'add', kind: 'userTask', name: 'Fz4 notify', before: 'H' },
      { op: 'add', kind: 'serviceTask', name: 'Fz5 review', after: 'S' },
      { op: 'split', after: 'Activity_Fz5Review', branches: [{ nodes: [{ kind: 'task', name: 'Fz6 a' }] }, { nodes: [{ kind: 'task', name: 'Fz6 b' }] }] },
    ];
    let xml = fixture('incremental', 'polish-remove.bpmn');
    let warnings: readonly Warning[] = [];
    for (const op of ops) {
      const res = await applyToXml(xml, [op], { keepFlowIds: true, layout: false });
      xml = res.xml;
      warnings = res.result.warnings.added;
    }
    const { followed, naming, after } = await follow(xml, warnings);
    expect(followed).toEqual(['fFz5ReviewToAfterFz5Review']);
    expect(naming).toEqual(followed);
    expect(after).toEqual({ form: 'named', prefix: 'f', sep: '' });
  });

  it('by default too: the flows of an f1 file keep f after a splice, and the next splice renames the flow it splits', async () => {
    const xml = fixture('mixed-styles', 'polish-remove-9456.bpmn');
    const first = await applyToXml(xml, [{ op: 'add', kind: 'subProcess', name: 'Fz6 archive', before: 'Activity_Fz3Pay' }], { layout: false });
    expect(first.result.renamed).toEqual({ fHandleTicketToFz3Pay: 'fHandleTicketToFz6Archive' });
    // before: the next read learned Flow_, created Flow_Fz7FileToFz3Pay and kept fFz6ArchiveToFz3Pay on Fz6Archive -> Fz7File
    const second = await applyToXml(first.xml, [{ op: 'add', kind: 'task', name: 'Fz7 file', after: 'Activity_Fz6Archive' }], { layout: false });
    expect(second.result.renamed).toEqual({ fFz6ArchiveToFz3Pay: 'fFz6ArchiveToFz7File' });
    expect(second.result.created.map((c) => c.id)).toEqual(['Activity_Fz7File', 'fFz7FileToFz3Pay']);
  });
});

describe('`set id=` takes a DI id derived from the old id along', () => {
  /** DI id by element id. */
  const diOf = (xml: string): Map<string, string> => new Map([...xml.matchAll(/<bpmndi:BPMN(?:Shape|Edge) id="([^"]+)" bpmnElement="([^"]+)"/g)].map((m) => [m[2]!, m[1]!]));
  const RENAMES: Op[] = [
    { op: 'set', id: 'Flow_CheckToOk', values: { id: 'Flow_CheckToAudit' } },
    { op: 'set', id: 'Activity_Check', values: { id: 'Activity_Audit' } },
  ];

  it('on a flow and a task, in the `<id>_di` and `BPMN<Kind>_` styles, with ids kept too; the result is unchanged', async () => {
    for (const style of ['suffix', 'bpmn'] as const) {
      for (const keepFlowIds of [false, true]) {
        const r = await applyToXml(await drawnDefault(style), RENAMES, { keepFlowIds });
        const di = diOf(r.xml);
        expect(di.get('Flow_CheckToAudit')).toBe(style === 'suffix' ? 'Flow_CheckToAudit_di' : 'BPMNEdge_Flow_CheckToAudit');
        expect(di.get('Activity_Audit')).toBe(style === 'suffix' ? 'Activity_Audit_di' : 'BPMNShape_Activity_Audit');
        expect(r.xml).not.toMatch(/Activity_Check|Flow_CheckToOk/);
        expect(r.result.changed.map((c) => `${c.id}: ${c.detail}`)).toEqual(['Flow_CheckToAudit: renamed from Flow_CheckToOk', 'Activity_Audit: renamed from Activity_Check']);
      }
    }
  });

  it('a DI id not derived from the old id stays; one whose new id is taken gets _2', async () => {
    const xml = (await drawnDefault()).replace('id="Activity_Check_di"', 'id="Shape_0abc123"').replace('id="Activity_Book_di"', 'id="Event_Archive_di"');
    const r = await applyToXml(xml, [
      { op: 'set', id: 'Activity_Check', values: { id: 'Activity_Audit' } },
      { op: 'set', id: 'Event_Done', values: { id: 'Event_Archive' } },
    ]);
    const di = diOf(r.xml);
    expect(di.get('Activity_Audit')).toBe('Shape_0abc123');
    expect(di.get('Event_Archive')).toBe('Event_Archive_di_2');
    expect(di.get('Activity_Book')).toBe('Event_Archive_di');
  });

  it('a derived DI id with a collision suffix (_2) follows too', async () => {
    const xml = (await drawnDefault('bpmn')).replace('id="BPMNShape_Activity_Book"', 'id="BPMNShape_Activity_Book_2"').replace('id="BPMNEdge_Flow_CheckToOk"', 'id="BPMNEdge_Flow_CheckToOk_3"');
    const r = await applyToXml(xml, RENAMES);
    expect(diOf(r.xml).get('Activity_Audit')).toBe('BPMNShape_Activity_Audit');
    expect(diOf(r.xml).get('Flow_CheckToAudit')).toBe('BPMNEdge_Flow_CheckToAudit');
    const book = await applyToXml(xml, [{ op: 'set', id: 'Activity_Book', values: { id: 'Activity_Post' } }]);
    expect(diOf(book.xml).get('Activity_Post')).toBe('BPMNShape_Activity_Post');
  });

  it('in a batch, a DI id of an element removed before is free for the rename, as in two commands', async () => {
    const ops: Op[] = [
      { op: 'remove', ids: ['Activity_Book'] },
      { op: 'set', id: 'Activity_Check', values: { id: 'Activity_Book' } },
    ];
    for (const style of ['suffix', 'bpmn'] as const) {
      for (const layout of [undefined, false] as const) {
        const opts = layout === false ? { layout } : {};
        const batch = await applyToXml(await drawnDefault(style), ops, opts);
        const first = await applyToXml(await drawnDefault(style), [ops[0]!], opts);
        const second = await applyToXml(first.xml, [ops[1]!], opts);
        expect(diOf(batch.xml).get('Activity_Book')).toBe(style === 'suffix' ? 'Activity_Book_di' : 'BPMNShape_Activity_Book');
        expect(batch.xml).toBe(second.xml);
      }
    }
  });

  it('the renamed element\'s DI element is written anew: a comment inside it is dropped, and the result says so', async () => {
    const xml = (await drawnDefault()).replace(/(<bpmndi:BPMNShape id="Activity_Check_di" bpmnElement="Activity_Check">)/, '$1\n        <!-- reviewed -->');
    expect(xml).toContain('<!-- reviewed -->');
    for (const layout of [undefined, false] as const) {
      const r = await applyToXml(xml, [{ op: 'set', id: 'Activity_Check', values: { id: 'Activity_Audit' } }], layout === false ? { layout } : {});
      expect(diOf(r.xml).get('Activity_Audit')).toBe('Activity_Audit_di');
      expect(r.xml).not.toContain('<!-- reviewed -->');
      expect(r.result.notes).toContain('1 XML comment(s) dropped: they were inside or next to elements the change removed or rewrote');
    }
  });

  it('following W_FLOW_ID_STALE with its `bpmn set` gives the file the default rename gives', async () => {
    const splice: Op[] = [{ op: 'add', kind: 'task', name: 'Review', flow: 'Flow_OkToBook' }];
    for (const style of ['suffix', 'bpmn'] as const) {
      const renamed = await applyToXml(await drawnDefault(style), splice);
      const keptIds = await applyToXml(await drawnDefault(style), splice, { keepFlowIds: true });
      const command = /`bpmn set <file> (\S+) id=(\S+)`/.exec(stale(keptIds.result.warnings.added)[0]!.hint!)!;
      const followed = await applyToXml(keptIds.xml, [{ op: 'set', id: command[1]!, values: { id: command[2]! } }], { keepFlowIds: true });
      expect(diOf(followed.xml).get('Flow_OkToReview')).toBe(style === 'suffix' ? 'Flow_OkToReview_di' : 'BPMNEdge_Flow_OkToReview');
      expect(followed.xml).toBe(renamed.xml);
    }
  });
});

describe('--no-layout with ids kept: a flow whose ends changed loses its stale edge', () => {
  /** The flows a drawing has a BPMNEdge for. */
  const drawnFlows = (xml: string): string[] => [...xml.matchAll(/<bpmndi:BPMNEdge [^>]*bpmnElement="([^"]+)"/g)].map((m) => m[1]!).sort();

  it('a move: every flow whose ends changed loses its edge and the note names them, like in the default mode; the next write draws them at their new ends', async () => {
    const drawn = (await layoutXml(LINE)).xml;
    expect(drawnFlows(drawn)).toEqual(['Flow_AToB', 'Flow_BToC', 'Flow_CToDone', 'Flow_StartToA']);
    const r = await applyToXml(drawn, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_C' }], { keepFlowIds: true, layout: false });
    expect(drawnFlows(r.xml)).toEqual(['Flow_StartToA']);
    expect(r.result.notes.filter((n) => n.startsWith('removed'))).toEqual(['removed 3 stale diagram element(s), among them the edge(s) of Flow_AToB, Flow_BToC, Flow_CToDone (their ends changed; the next model edit without --no-layout draws them, or `bpmn route <file> <flowId>`)']);
    expect(r.result.layout?.metrics?.added.filter((p) => p.kind === 'missing').map((p) => p.ids[0]).sort()).toEqual(['Flow_AToB', 'Flow_BToC', 'Flow_CToDone']);
    // the default mode: the bridge and the flow into B lose theirs, the removed flow's edge goes with it
    const followed = await applyToXml(drawn, [{ op: 'move', ids: ['Activity_B'], after: 'Activity_C' }], { layout: false });
    expect(drawnFlows(followed.xml)).toEqual(['Flow_StartToA']);
    expect(followed.result.notes.filter((n) => n.startsWith('removed'))).toEqual(['removed 3 stale diagram element(s), among them the edge(s) of Flow_AToC, Flow_CToB (their ends changed; the next model edit without --no-layout draws them, or `bpmn route <file> <flowId>`)']);
    const next = await applyToXml(r.xml, [{ op: 'set', id: 'Activity_A', values: { name: 'A2' } }], { keepFlowIds: true });
    expect(next.result.layout?.mode).toBe('incremental');
    expect([...(next.result.layout?.placed ?? [])].sort()).toEqual(['Flow_AToB', 'Flow_BToC', 'Flow_CToDone']);
    expect(next.result.layout?.metrics?.after.counts.missing).toBe(0);
  });
});
