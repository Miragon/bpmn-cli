import { describe, expect, it } from 'vitest';
import { BranchSplit } from '../../src/edit/BranchSplit.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import { Fixtures } from '../support/Fixtures.js';
import type { BpmnElement } from '../support/ModelValues.js';

async function split(operation: Record<string, unknown>, path = 'edit/order-check.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const edit = new EditSession(document);
  edit.begin();
  const parsed = Fixtures.operations([{ op: 'split', ...operation }]).model[0]!;
  const changes = new BranchSplit(edit).split(parsed as Parameters<BranchSplit['split']>[0]);
  const element = (id: string) => document.tree.require(id);
  const between = (source: string, target: string) => document.flows.outgoing(element(source)).find((flow) => flow.get<BpmnElement>('targetRef') === element(target));
  return { between, changes, document, element };
}

const TWO_TASKS = [{ nodes: [{ kind: 'task', name: 'Pay' }] }, { nodes: [{ kind: 'task', name: 'Ask' }] }];
const ENDING = { nodes: [{ kind: 'endEvent', name: 'Stop' }] };

describe('BranchSplit', () => {
  it('spreads a task into a gateway, its branches and a join that runs on to the old successor', async () => {
    const { between, changes, element } = await split({ after: 'ship', name: 'Express?', branches: TWO_TASKS });

    expect(element('gateway_express').is('bpmn:ExclusiveGateway')).toBe(true);
    expect(between('ship', 'gateway_express')).toBeDefined();
    expect(between('gateway_express', 'task_pay')).toBeDefined();
    expect(between('task_pay', 'gateway_expressJoin')).toBeDefined();
    expect(between('task_ask', 'gateway_expressJoin')).toBeDefined();
    expect(between('gateway_expressJoin', 'gateway_join')).toBeDefined();
    expect(changes.created.find(({ id }) => id === 'gateway_express')?.detail).toBe('between ship and gateway_join');
    expect(changes.created.find(({ id }) => id === 'gateway_expressJoin')?.detail).toBe('join of gateway_express');
    expect(changes.notes).toEqual(expect.arrayContaining(['inserted gateway_express between ship and gateway_join', 'split gateway_express: 2 branch(es) ending at task_pay, task_ask, joined at gateway_expressJoin, continues to gateway_join']));
  });

  it('names the flow it spliced by its new id in the report', async () => {
    const { changes } = await split({ after: 'ship', name: 'Express?', branches: TWO_TASKS });

    expect(changes.changed).toEqual([expect.objectContaining({ id: 'flow_shipToExpress', detail: expect.stringMatching(/^ship -> gateway_express \(was -> gateway_join\).*flow_shipToJoin/) })]);
  });

  it('takes the gateway kind for the split and its join', async () => {
    const { element } = await split({ after: 'ship', kind: 'parallelGateway', id: 'fork', branches: TWO_TASKS });

    expect(element('fork').is('bpmn:ParallelGateway')).toBe(true);
    expect(element('gateway_forkJoin').is('bpmn:ParallelGateway')).toBe(true);
  });

  it('declares the gateway right behind the flow it splits', async () => {
    const { document, element } = await split({ after: 'ship', id: 'fork', branches: TWO_TASKS });
    const declared = document.tree.processes()[0]!.list('flowElements');

    expect(declared.indexOf(element('fork'))).toBe(declared.findIndex((candidate) => candidate.is('bpmn:SequenceFlow') && candidate.get('targetRef') === element('fork')) + 1);
  });

  it('appends behind a gateway that keeps its other branches', async () => {
    const { between, changes } = await split({ after: 'gateway_ok', id: 'fork', branches: TWO_TASKS });

    expect(between('gateway_ok', 'ship')).toBeDefined();
    expect(between('gateway_ok', 'fork')).toBeDefined();
    expect(changes.created.find(({ id }) => id === 'fork')?.detail).toBe('after gateway_ok');
    expect(changes.notes).toContain('appended fork after gateway_ok');
  });

  it('appends behind a task without a successor', async () => {
    const { between, changes } = await split({ after: 't_afterPlain', id: 'fork', branches: TWO_TASKS }, 'edit/flows-bridge.bpmn');

    expect(between('t_afterPlain', 'fork')).toBeDefined();
    expect(changes.notes.at(-1)).toBe('split fork: 2 branch(es) ending at task_pay, task_ask, joined at gateway_forkJoin');
  });

  it('puts the gateway and join in the lane of the anchor, and in its sub-process', async () => {
    const pools = await split({ after: 'pack', id: 'fork', branches: TWO_TASKS }, 'edit/two-pools.bpmn');
    expect(pools.document.scopes.laneOf(pools.element('fork'))).toBe(pools.document.scopes.laneOf(pools.element('pack')));
    expect(pools.document.scopes.laneOf(pools.element('gateway_forkJoin'))).toBe(pools.document.scopes.laneOf(pools.element('pack')));

    const nested = await split({ after: 'Sub_task', id: 'fork', branches: TWO_TASKS }, 'edit/sub-process.bpmn');
    expect(nested.element('fork').parent).toBe(nested.element('Sub'));
  });

  it('refuses a split behind a task with two ways out, and names the flows', async () => {
    await expect(split({ after: 't_taken2', branches: TWO_TASKS }, 'edit/flows-bridge.bpmn')).rejects.toMatchObject({ code: 'E_HAS_SUCCESSOR', details: { element: 't_taken2', candidates: ['f_task2In', 'f_takenDirect'] } });
  });

  it('puts the flow options of a branch on its first flow and those of a node on its own', async () => {
    const { between, element } = await split({
      after: 'ship',
      id: 'fork',
      branches: [
        { flowName: 'yes', condition: '${fast}', nodes: [{ kind: 'task', name: 'Pay', flowName: 'pay' }, { kind: 'task', name: 'Log', flowName: 'then' }] },
        { flowName: 'no', default: true, nodes: [{ kind: 'task', name: 'Ask' }] },
      ],
    });

    expect(between('fork', 'task_pay')?.name).toBe('pay');
    expect(between('fork', 'task_pay')?.get<BpmnElement>('conditionExpression').get('body')).toBe('${fast}');
    expect(between('task_pay', 'task_log')?.name).toBe('then');
    expect(element('fork').get('default')).toBe(between('fork', 'task_ask'));
  });

  it('records doc on a split node the way a set does', async () => {
    const { changes, element } = await split({ after: 'ship', branches: [{ nodes: [{ kind: 'task', name: 'Pay', set: { doc: 'By card.' } }] }, { nodes: [] }] });

    expect(element('task_pay').list('documentation')[0]!.get('text')).toBe('By card.');
    expect(changes.changed).toContainEqual(expect.objectContaining({ id: 'task_pay', detail: 'doc=By card.' }));
  });

  it('runs an empty branch straight from the gateway to the join, with its flow options', async () => {
    const { between, changes } = await split({ after: 'ship', id: 'fork', branches: [{ nodes: [{ kind: 'task', name: 'Pay' }] }, { flowName: 'skip', default: true, nodes: [] }, { nodes: [{ kind: 'task', name: 'Ask' }] }] });

    expect(between('fork', 'gateway_forkJoin')?.name).toBe('skip');
    expect(changes.notes.at(-1)).toContain('ending at task_pay, (direct), task_ask');
  });

  it('runs the branches into the old successor when told to make no join', async () => {
    const { between, changes, document } = await split({ after: 'ship', id: 'fork', join: false, branches: TWO_TASKS });

    expect(between('task_pay', 'gateway_join')).toBeDefined();
    expect(between('task_ask', 'gateway_join')).toBeDefined();
    expect(document.tree.has('gateway_forkJoin')).toBe(false);
    expect(changes.notes.at(-1)).toBe('split fork: 2 branch(es) ending at task_pay, task_ask, continues to gateway_join');
  });

  it('leaves the branch ends open with no join and no successor', async () => {
    const { changes, document } = await split({ after: 't_afterPlain', id: 'fork', join: false, branches: TWO_TASKS }, 'edit/flows-bridge.bpmn');

    expect(document.flows.outgoing(document.tree.require('task_pay'))).toEqual([]);
    expect(changes.notes.at(-1)).toBe('split fork: 2 branch(es) ending at task_pay, task_ask');
  });

  it('refuses an empty branch with neither a join nor a successor', async () => {
    await expect(split({ after: 't_afterPlain', join: false, branches: [{ nodes: [] }] }, 'edit/flows-bridge.bpmn')).rejects.toMatchObject({ code: 'E_INVALID_VALUE', message: expect.stringContaining('needs a join gateway or a successor') });
  });

  it('refuses an empty branch as the only one that continues, with no successor', async () => {
    await expect(split({ after: 't_afterPlain', branches: [{ nodes: [] }, ENDING] }, 'edit/flows-bridge.bpmn')).rejects.toMatchObject({ code: 'E_INVALID_VALUE', message: expect.stringContaining('another branch that continues') });
  });

  it('runs the one branch that continues on to the successor, and needs no join', async () => {
    const { between, changes, document } = await split({ after: 'ship', id: 'fork', branches: [{ nodes: [{ kind: 'task', name: 'Pay' }] }, ENDING] });

    expect(between('task_pay', 'gateway_join')).toBeDefined();
    expect(document.tree.has('gateway_forkJoin')).toBe(false);
    expect(changes.notes).toContain('only the branch ending at task_pay continues; no join gateway created (it runs on to gateway_join)');
    expect(changes.notes).toContain('branch ending at endEvent_stop terminates (end event); not connected to gateway_join');
    expect(changes.notes.at(-1)).toContain('task_pay, endEvent_stop (end event), continues to gateway_join');
  });

  it('runs an empty branch that is the only one to continue straight to the successor', async () => {
    const { between, changes } = await split({ after: 'ship', id: 'fork', branches: [{ flowName: 'skip', nodes: [] }, ENDING] });

    expect(between('fork', 'gateway_join')?.name).toBe('skip');
    expect(changes.notes).toContain('only the branch ending at fork continues; no join gateway created (it runs on to gateway_join)');
  });

  it('notes a branch that continues behind a split without a successor', async () => {
    const { changes } = await split({ after: 't_afterPlain', id: 'fork', branches: [{ nodes: [{ kind: 'task', name: 'Pay' }] }, ENDING] }, 'edit/flows-bridge.bpmn');

    expect(changes.notes).toContain('only the branch ending at task_pay continues; no join gateway created');
    expect(changes.notes).toContain('branch ending at endEvent_stop terminates (end event)');
  });

  it('tells that the old successor is no longer reached when every branch ends', async () => {
    const { changes, document } = await split({ after: 'ship', id: 'fork', branches: [ENDING, { nodes: [{ kind: 'endEvent', name: 'Halt' }] }] });

    expect(document.tree.has('gateway_forkJoin')).toBe(false);
    expect(changes.notes).toContain('every branch ends in an end event; no join gateway created');
    expect(changes.notes).toContain('gateway_join is no longer reached: every branch terminates (connect it with `bpmn connect <file> <id> gateway_join` or remove it)');
  });

  it.each([
    ['no join is asked for', { join: false, branches: TWO_TASKS }, 'join is false'],
    ['every branch ends', { branches: [ENDING, { nodes: [{ kind: 'endEvent', name: 'Halt' }] }] }, 'every branch ends in an end event'],
    ['one branch continues', { branches: [ENDING, { nodes: [{ kind: 'task', name: 'Pay' }] }] }, 'only one branch continues'],
  ])('refuses joinAs when %s', async (_case, operation, why) => {
    await expect(split({ after: 'ship', joinAs: '$join', ...operation })).rejects.toMatchObject({ code: 'E_USAGE', message: expect.stringContaining(why) });
  });

  it('binds the aliases of gateway and join', async () => {
    const { changes, element } = await split({ after: 'ship', id: 'fork', as: '$fork', joinAs: '$join', branches: TWO_TASKS });

    expect(changes.bindings).toEqual(expect.arrayContaining([{ alias: '$fork', el: element('fork') }, { alias: '$join', el: element('gateway_forkJoin') }]));
  });

  it('takes the id and name the split gives its join', async () => {
    const { element } = await split({ after: 'ship', id: 'fork', joinId: 'merge', joinName: 'Both done', branches: TWO_TASKS });

    expect(element('merge').name).toBe('Both done');
  });

  it('suffixes a join id that is taken and warns', async () => {
    const { changes, element } = await split({ after: 'ship', id: 'fork', branches: TWO_TASKS }, 'edit/flows-join-taken.bpmn');

    expect(element(changes.warnings[0]!.element!).is('bpmn:ExclusiveGateway')).toBe(true);
    expect(changes.warnings).toContainEqual(expect.objectContaining({ code: 'W_ID_SUFFIXED', hint: 'Pass joinId to choose the join id yourself.' }));
  });

  it('checks the shape of the branches before anything changes', () => {
    expect(() => Fixtures.operations([{ op: 'split', after: 'ship', branches: [{ flowName: 'yes' }] }])).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
    expect(() => Fixtures.operations([{ op: 'split', after: 'ship', branches: 'oops' }])).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
    expect(() => Fixtures.operations([{ op: 'split', after: 'ship', branches: [{ nodes: [{ name: 'No kind' }] }] }])).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
  });
});
