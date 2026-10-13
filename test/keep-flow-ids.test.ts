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
