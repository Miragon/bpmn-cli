/**
 * Flow ids kept (issue #32): where flow ids are API (generated code, process
 * tests), `keepFlowIds` (`--keep-flow-ids`, BPMN_KEEP_FLOW_IDS) keeps the id
 * of every flow the file had when an edit changes its ends, and the change
 * names each flow whose id no longer names its ends (W_FLOW_ID_STALE, with
 * the `bpmn set` that renames it). A flow the same change created still
 * follows its ends. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import type { El } from '../src/model.js';
import type { Warning } from '../src/errors.js';
import { runOp, runOps } from '../src/ops/index.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';
import { renderMutation } from '../src/report.js';
import type { ChangeSet } from '../src/result.js';
import { definitionsXml, flowBetween } from './helpers.js';

/** A file of the default style with `<id>_di` DI: start -> Check -> Ok? -> Book (default) -> Done. */
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
    // moving X where it is: the bridge runs Flow_AToB A -> B (the ends its id names), the splice A -> X again
    const again = await applyToXml(first.xml, [{ op: 'move', ids: ['Activity_X'], after: 'Activity_A' }], { keepFlowIds: true, layout: false });
    expect(stale(again.result.warnings.added)).toEqual([]);
    const doc = await Doc.fromXml(first.xml);
    doc.followFlowEnds = false;
    expect(stale(runOp(doc, { op: 'move', ids: ['Activity_X'], after: 'Activity_A' }).warnings)).toEqual([]);
    // a later op of the same change that gives it other ends again reports it
    const moved = await kept([{ op: 'move', ids: ['Activity_X'], after: 'Activity_A' }, { op: 'add', kind: 'task', name: 'Y', after: 'Activity_A' }], first.xml);
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
