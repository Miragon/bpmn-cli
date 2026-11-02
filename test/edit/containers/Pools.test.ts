import { describe, expect, it } from 'vitest';
import { Pools } from '../../../src/edit/containers/Pools.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import type { AddOperation } from '../../../src/operations/index.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

function operation(fields: object): AddOperation {
  return Fixtures.operations([{ op: 'add', kind: 'participant', ...fields }]).model[0] as AddOperation;
}

async function create(path: string, fields: object) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  const changes = new ChangeSet();
  const participant = new Pools(session).createParticipant(operation(fields), changes);
  return { session, participant, changes, tree: session.document.tree };
}

describe('Pools', () => {
  it('wraps the only process in the first pool, in a collaboration it creates', async () => {
    const { participant, changes, tree } = await create('edit/order-check.bpmn', { name: 'Shop' });

    expect(participant.get<BpmnElement>('processRef').id).toBe('Process_orderCheck');
    expect(tree.definitions.list('rootElements')[0]).toBe(tree.collaboration());
    expect(changes.created.map(({ kind }) => kind)).toEqual(['collaboration', 'participant']);
    expect(changes.created[1]?.detail).toBe('wraps process Process_orderCheck');
    expect(changes.notes[0]).toContain('wraps the existing process Process_orderCheck');
  });

  it('gives a further pool a new process that does not run', async () => {
    const { participant, changes, tree } = await create('edit/two-pools.bpmn', { name: 'Courier' });
    const process = participant.get<BpmnElement>('processRef');

    expect(process.get('isExecutable')).toBe(false);
    expect(tree.definitions.list('rootElements').at(-1)).toBe(process);
    expect(changes.created.map(({ kind }) => kind)).toEqual(['process', 'participant']);
    expect(changes.created[1]?.detail).toBe(`process ${process.id}`);
  });

  it('draws a black box without a process', async () => {
    const { participant, changes } = await create('edit/two-pools.bpmn', { blackBox: true });

    expect(participant.get<BpmnElement>('processRef')).toBeUndefined();
    expect(participant.name).toBeUndefined();
    expect(changes.created[0]?.detail).toBe('black box (no process)');
  });

  it('binds the process it names to a pool', async () => {
    const { participant, changes } = await create('edit/containers-artifacts.bpmn', { name: 'Helper', process: 'Process_helper' });

    expect(participant.get<BpmnElement>('processRef').id).toBe('Process_helper');
    expect(changes.created.at(-1)?.detail).toBe('process Process_helper');
  });

  it('refuses a black box with a process', async () => {
    await expect(create('edit/containers-artifacts.bpmn', { blackBox: true, process: 'Process_helper' })).rejects.toMatchObject({ code: 'E_INVALID_VALUE' });
  });

  it('refuses a process that has its pool already', async () => {
    await expect(create('edit/two-pools.bpmn', { process: 'Process_shop' })).rejects.toMatchObject({ code: 'E_PROCESS_BOUND', details: { element: 'Process_shop', related: ['participant_shop'] } });
  });

  it('refuses to guess which of two processes a first pool wraps', async () => {
    await expect(create('edit/containers-artifacts.bpmn', {})).rejects.toMatchObject({ code: 'E_AMBIGUOUS_SCOPE', details: { candidates: ['Process_main', 'Process_helper'] } });
  });

  it('starts a file without a process with a pool that has a new one', async () => {
    const { participant, tree } = await create('edit/containers-no-process.bpmn', {});

    expect(tree.processes()).toEqual([participant.get<BpmnElement>('processRef')]);
    expect(tree.collaboration()?.list('participants')).toEqual([participant]);
  });
});
