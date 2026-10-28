import { describe, expect, it } from 'vitest';
import { Doc } from '../../../src/domain/document/Doc.js';
import { runOps } from '../../../src/index.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import { definitionsXml } from '../../helpers/helpers.js';

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

async function renamesOf(ops: EditCommand[]): Promise<string[]> {
  return runOps(await Doc.fromXml(LINE), ops).renames.map((rename) => `${rename.from} -> ${rename.to}`);
}

describe('a flow whose id names its ends is always renamed after its new ends (#126)', () => {
  it.each<[string, EditCommand, string[]]>([
    ['add --after (splice)', { op: 'add', kind: 'task', name: 'X', after: 'task_a' }, ['flow_aToB -> flow_aToX']],
    ['add --before (splice)', { op: 'add', kind: 'task', name: 'X', before: 'task_b' }, ['flow_aToB -> flow_aToX']],
    ['add --flow (splice)', { op: 'add', kind: 'task', name: 'X', flow: 'flow_aToB' }, ['flow_aToB -> flow_aToX']],
    ['set target=', { op: 'set', id: 'flow_aToB', values: { target: 'task_c' } }, ['flow_aToB -> flow_aToC']],
    ['set source=', { op: 'set', id: 'flow_bToC', values: { source: 'task_a' } }, ['flow_bToC -> flow_aToC']],
    ['remove with bridging', { op: 'remove', ids: ['task_b'] }, ['flow_aToB -> flow_aToC']],
    ['split', { op: 'split', after: 'task_a', name: 'Ok?', branches: [{ nodes: [] }, { nodes: [{ kind: 'task', name: 'Y' }] }] }, ['flow_aToB -> flow_aToOk']],
    ['move --after (bridge and splice)', { op: 'move', ids: ['task_b'], after: 'task_c' }, ['flow_aToB -> flow_aToC', 'flow_cToDone -> flow_cToB']],
    ['move of a chain', { op: 'move', ids: ['task_a', 'task_b'], after: 'task_c' }, ['flow_startToA -> flow_startToB', 'flow_cToDone -> flow_cToA', 'flow_startToB -> flow_startToC', 'flow_aToDone -> flow_aToB2']],
    ['move --before (bridge and splice)', { op: 'move', ids: ['task_c'], before: 'task_b' }, ['flow_bToC -> flow_bToDone', 'flow_aToB -> flow_aToC']],
  ])('%s', async (_command, op, expected) => {
    expect(await renamesOf([op])).toEqual(expected);
  });

  it('an id in another form keeps it', async () => {
    const xml = LINE.replaceAll('flow_aToB', 'Flow_0yq6cfd');
    const changes = runOps(await Doc.fromXml(xml), [{ op: 'add', kind: 'task', name: 'X', after: 'task_a' }]);
    expect(changes.renames).toEqual([]);
  });
});
