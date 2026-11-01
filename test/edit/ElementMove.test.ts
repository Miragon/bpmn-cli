import { describe, expect, it } from 'vitest';
import { ElementMove } from '../../src/edit/ElementMove.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import type { BpmnDocument, BpmnElement } from '../../src/model/index.js';
import type { MoveOperation } from '../../src/operations/index.js';
import { Fixtures } from '../support/Fixtures.js';
import { DocumentWriter } from '../support/ModelValues.js';

const moved = (document: BpmnDocument, operation: Omit<MoveOperation, 'op'>) => new ElementMove(new EditSession(document)).move({ op: 'move', ...operation });

const shop = () => Fixtures.readForWrite('edit/shop-full.bpmn');

function pathFrom(document: BpmnDocument, id: string, steps: number): string[] {
  const path = [id];
  while (path.length < steps) {
    const next = document.flows.outgoing(document.tree.require(path.at(-1)!))[0];
    if (!next) {
      break;
    }
    path.push(next.get<BpmnElement>('targetRef').id);
  }
  return path;
}

function lanesOf(document: BpmnDocument, id: string): string[] {
  return document.scopes.lanesOf(document.tree.require(id)).map((lane) => lane.id);
}

describe('ElementMove', () => {
  it('splices a task behind its anchor and removes the flow that led to it', async () => {
    const document = await shop();

    const changes = moved(document, { ids: ['Task_Remind'], after: 'Task_B' });

    expect(pathFrom(document, 'Task_B', 3)).toEqual(['Task_B', 'Task_Remind', 'Sub']);
    expect(document.tree.has('F_T')).toBe(false);
    expect(changes.removed.map(({ id }) => id)).toEqual(['F_T']);
    expect(changes.notes).toContain('inserted between Task_B and Sub');
    expect(changes.changed.find(({ id }) => id === 'Task_Remind')?.detail).toBe('moved after Task_B');
    expect(changes.relocated).toEqual(['Task_Remind']);
  });

  it('chains several tasks behind the anchor and bridges the gaps they leave', async () => {
    const document = await shop();

    moved(document, { ids: ['Task_B', 'Task_Send'], after: 'Start' });

    expect(pathFrom(document, 'Start', 5)).toEqual(['Start', 'Task_B', 'Task_Send', 'Task_A', 'Gw']);
    expect(document.tree.require('F_yes').get<BpmnElement>('targetRef').id).toBe('Sub');
    expect(document.tree.require('F_no').get<BpmnElement>('targetRef').id).toBe('Sub');
  });

  it('takes the lane of the anchor when a task crosses into another process', async () => {
    const document = await shop();

    moved(document, { ids: ['C_Task'], before: 'End' });

    expect(document.scopes.scopeOf(document.tree.require('C_Task'))?.id).toBe('Process_1');
    expect(pathFrom(document, 'Call', 3)).toEqual(['Call', 'C_Task', 'End']);
    expect(lanesOf(document, 'C_Task')).toEqual(['Lane_Ops']);
  });

  it('splices a task into the flow it names', async () => {
    const document = await shop();

    const changes = moved(document, { ids: ['Task_Remind'], flow: 'F1' });

    expect(pathFrom(document, 'Start', 3)).toEqual(['Start', 'Task_Remind', 'Task_A']);
    expect(changes.changed.find(({ id }) => id === 'Task_Remind')?.detail).toBe('moved into flow F1');
  });

  it('keeps the lane of a task and notes that the flow it went into runs between two other lanes', async () => {
    const document = await Fixtures.readForWrite('edit/lanes-crossing.bpmn');

    const changes = moved(document, { ids: ['low'], after: 'first' });

    expect(lanesOf(document, 'low')).toEqual(['lane_low']);
    expect(changes.notes.join()).toContain('low stays in its lane lane_low');
  });

  it('gives a task without a lane, and its boundary event, the lane of the anchor, and warns when the flow crosses lanes', async () => {
    const document = await Fixtures.readForWrite('edit/lanes-crossing.bpmn');

    const changes = moved(document, { ids: ['loose'], after: 'first' });

    expect(lanesOf(document, 'loose')).toEqual(['lane_top']);
    expect(lanesOf(document, 'loose_timer')).toEqual(['lane_top']);
    expect(changes.warnings.map(({ code }) => code)).toContain('W_LANE_INHERITED');
  });

  it('assigns the lane it is told, with or without a placement, and an empty lane takes the task out of its lane', async () => {
    const document = await shop();

    moved(document, { ids: ['Task_Send'], after: 'Task_A', lane: 'Lane_Ops' });
    expect(lanesOf(document, 'Task_Send')).toEqual(['Lane_Ops']);

    moved(document, { ids: ['Task_B'], lane: 'Lane_Sales' });
    expect(lanesOf(document, 'Task_B')).toEqual(['Lane_Sales']);

    moved(document, { ids: ['Task_B'], lane: '' });
    expect(lanesOf(document, 'Task_B')).toEqual([]);
  });

  it('moves tasks into a sub-process, keeps the flows between them and drops those that would cross', async () => {
    const document = await shop();

    const changes = moved(document, { ids: ['Task_A', 'Gw'], in: 'Sub' });

    const sub = document.tree.require('Sub');
    expect(sub.list('flowElements').map(({ id }) => id)).toEqual(['SubStart', 'SF1', 'SubTask', 'SF2', 'SubEnd', 'Task_A', 'F2', 'Timer_A', 'Gw']);
    expect(document.scopes.scopeOf(document.tree.require('Timer_A'))).toBe(sub);
    expect(changes.warnings.filter(({ code }) => code === 'W_FLOW_DROPPED').map(({ element }) => element).sort()).toEqual(['F1', 'F_T', 'F_no', 'F_yes']);
    expect(lanesOf(document, 'Task_A')).toEqual([]);
    expect(changes.changed.filter(({ detail }) => detail?.startsWith('moved into')).map(({ id }) => id)).toEqual(['Task_A', 'Gw']);
  });

  it('bridges around a single task it moves into a sub-process', async () => {
    const document = await shop();

    moved(document, { ids: ['Task_B'], in: 'Sub' });

    expect(document.flows.outgoing(document.tree.require('Gw')).map((flow) => flow.get<BpmnElement>('targetRef').id)).toEqual(['Sub', 'Task_Send']);
  });

  it.each([
    [{ ids: ['Task_A'], in: 'Process_1' }, 'Task_A is already in Process_1'],
    [{ ids: ['Timer_A'], on: 'Task_A' }, 'Timer_A is already attached to Task_A'],
  ])('notes a node that already sits where it is moved: $ids', async (operation, note) => {
    const changes = moved(await shop(), operation);

    expect(changes.notes).toEqual([note]);
    expect(changes.relocated).toEqual([]);
  });

  it('moves a task out of its pool into another, and the lane stays behind', async () => {
    const document = await shop();

    moved(document, { ids: ['Task_Remind'], in: 'P_Customer' });

    expect(document.scopes.scopeOf(document.tree.require('Task_Remind'))?.id).toBe('Process_2');
    expect(lanesOf(document, 'Task_Remind')).toEqual([]);
  });

  it.each([
    ['a sub-process into itself', { ids: ['Sub'], in: 'Sub' }, 'E_INVALID_PLACEMENT'],
    ['a boundary event by --in', { ids: ['Timer_A'], in: 'Process_1' }, 'E_INVALID_PLACEMENT'],
    ['a task --on an activity', { ids: ['Task_B'], on: 'Task_A' }, 'E_INVALID_PLACEMENT'],
    ['a boundary event --after a task', { ids: ['Timer_A'], after: 'Task_B' }, 'E_INVALID_PLACEMENT'],
    ['a flow', { ids: ['F1'], after: 'Task_B' }, 'E_WRONG_KIND'],
  ])('refuses to place %s', async (_case, operation, code) => {
    await expect(shop().then((document) => moved(document, operation))).rejects.toMatchObject({ code });
  });

  it('re-attaches a boundary event to another activity and keeps its flow in the same scope', async () => {
    const document = await shop();

    const changes = moved(document, { ids: ['Timer_A'], on: 'Task_B' });

    expect(document.tree.require('Timer_A').get<BpmnElement>('attachedToRef').id).toBe('Task_B');
    expect(document.tree.has('F_T')).toBe(true);
    expect(changes.changed.at(-1)?.detail).toBe('moved onto Task_B (was Task_A)');
  });

  it('drops the flow of a boundary event it attaches inside a sub-process, and takes no lane there', async () => {
    const document = await shop();

    const changes = moved(document, { ids: ['Timer_A'], on: 'SubTask' });

    expect(document.tree.has('F_T')).toBe(false);
    expect(changes.warnings.map(({ code }) => code)).toContain('W_FLOW_DROPPED');
    expect(lanesOf(document, 'Timer_A')).toEqual([]);
  });

  it('gives a boundary event the lane of the activity it moves onto, if the activity has one', async () => {
    const document = await Fixtures.readForWrite('edit/lanes-crossing.bpmn');

    moved(document, { ids: ['loose_timer'], on: 'unassigned' });
    expect(lanesOf(document, 'loose_timer')).toEqual([]);

    moved(document, { ids: ['loose_timer'], on: 'first' });
    expect(lanesOf(document, 'loose_timer')).toEqual(['lane_top']);
  });

  it('refuses a boundary event on an event sub-process, and it stays on its host', async () => {
    const document = await Fixtures.readForWrite('edit/event-sub-host.bpmn');

    expect(() => moved(document, { ids: ['boundary_shipTimeout'], on: 'cancelOrder' })).toThrow(expect.objectContaining({ code: 'E_INVALID_HOST' }));
    expect(document.tree.require('boundary_shipTimeout').get<BpmnElement>('attachedToRef').id).toBe('ship');
  });

  it.each([
    ['its last node as anchor', { ids: ['Call', 'End'], after: 'End' }, 'End cannot anchor the move of Call, End: it is one of the moved nodes'],
    ['its middle node as anchor', { ids: ['Task_A', 'Gw', 'Task_B'], after: 'Gw' }, 'Gw cannot anchor the move of Task_A, Gw, Task_B: it is one of the moved nodes'],
    ['a flow out of its own node', { ids: ['Task_A', 'Call'], flow: 'F6' }, 'F6 cannot anchor the move of Task_A, Call: its source Call is one of the moved nodes'],
    ['a task inside its own sub-process', { ids: ['Task_B', 'Sub'], after: 'SubTask' }, 'SubTask cannot anchor the move of Task_B, Sub: it is inside Sub, one of the moved nodes'],
  ])('refuses a chain anchored on %s before anything changes', async (_case, operation, message) => {
    const document = await shop();
    const before = await new DocumentWriter().plain(document);

    expect(() => moved(document, operation)).toThrow(expect.objectContaining({ code: 'E_INVALID_PLACEMENT', message: expect.stringContaining(message) }));
    expect(await new DocumentWriter().plain(document)).toBe(before);
  });

  it.each([
    [{ ids: ['Call'], after: 'Sub' }, 'Call is already after Sub'],
    [{ ids: ['Call', 'End'], after: 'Sub' }, 'Call, End are already after Sub, in this order'],
    [{ ids: ['Task_B'], before: 'Sub' }, 'Task_B is already before Sub'],
    [{ ids: ['Task_B'], after: 'Gw', before: 'Sub' }, 'Task_B is already between Gw and Sub'],
  ])('changes nothing for a move that leaves its nodes where they are: $ids', async (operation, note) => {
    const document = await shop();

    const changes = moved(document, operation);

    expect([changes.created, changes.changed, changes.removed, changes.warnings, changes.notes]).toEqual([[], [], [], [], [note]]);
  });

  it('appends a new branch for the successor of a gateway moved after that gateway', async () => {
    const document = await shop();

    const changes = moved(document, { ids: ['Task_B'], after: 'Gw' });

    expect(changes.notes).toEqual(['bridged: Gw -> Sub', 'appended after Gw']);
    expect(document.tree.require('F_yes').get<BpmnElement>('targetRef').id).toBe('Sub');
    expect(document.flows.outgoing(document.tree.require('Task_B'))).toEqual([]);
  });

  it('never reuses the id of a flow it removed for the flow it creates', async () => {
    const document = await Fixtures.readForWrite('edit/plain-chain.bpmn');

    const changes = moved(document, { ids: ['X'], after: 'B' });

    expect(changes.removed.map(({ id }) => id)).toEqual(['Flow_4']);
    expect(changes.created.map(({ id }) => id)).toEqual(['flow_xToC']);
    expect(document.tree.require('Flow_1').get<BpmnElement>('targetRef').id).toBe('A');
  });
});
