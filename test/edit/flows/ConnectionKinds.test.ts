import { describe, expect, it } from 'vitest';
import { ConnectionKinds } from '../../../src/edit/flows/ConnectionKinds.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function endpoints() {
  const document = await Fixtures.readForWrite('edit/flows-endpoints.bpmn');
  const kinds = new ConnectionKinds(new EditSession(document));
  const element = (id: string) => document.tree.require(id);
  return { element, kinds };
}

describe('ConnectionKinds', () => {
  it.each([
    ['a task and a task of its process', 'a_task', 'a_guarded', 'sequenceFlow'],
    ['tasks of two pools', 'a_task', 'b_task', 'messageFlow'],
    ['a pool and a task', 'pool_a', 'b_task', 'messageFlow'],
    ['a note and a task', 'a_note', 'a_task', 'association'],
    ['a task and a note', 'a_task', 'a_note', 'association'],
    ['a compensation boundary event and its handler', 'a_compensate', 'a_undo', 'association'],
    ['a timer boundary event and a task', 'a_timer', 'a_undo', 'sequenceFlow'],
    ['a data object and a task', 'a_data', 'a_task', 'dataAssociation'],
    ['a task and a data store', 'a_task', 'a_store', 'dataAssociation'],
  ])('joins %s', async (_case, source, target, kind) => {
    const { element, kinds } = await endpoints();

    expect(kinds.kindOf(element(source), element(target))).toBe(kind);
  });

  it('refuses to connect what no connection of BPMN joins', async () => {
    const { element, kinds } = await endpoints();

    expect(() => kinds.kindOf(element('f_a1'), element('a_task'))).toThrow(expect.objectContaining({ code: 'E_INVALID_ENDPOINT', details: expect.objectContaining({ related: ['a_task'] }) }));
  });

  it.each([
    ['sequenceFlow', 'a_start', 'a_task', 'f_a1'],
    ['messageFlow', 'a_send', 'b_receive', 'm_existing'],
    ['association', 'a_note', 'a_task', 'association_existing'],
    ['association', 'a_task', 'a_note', 'association_existing'],
    ['dataAssociation', 'a_data', 'a_reader', 'in_read'],
    ['dataAssociation', 'a_reader', 'a_store', 'out_read'],
  ] as const)('finds the %s that joins %s and %s', async (kind, source, target, id) => {
    const { element, kinds } = await endpoints();

    expect(kinds.existingConnection(kind, element(source), element(target))?.id).toBe(id);
  });

  it.each([
    ['sequenceFlow', 'a_task', 'a_end'],
    ['messageFlow', 'b_receive', 'a_send'],
    ['association', 'a_note', 'a_guarded'],
    ['dataAssociation', 'a_data', 'a_task'],
  ] as const)('finds no %s where none joins %s and %s', async (kind, source, target) => {
    const { element, kinds } = await endpoints();

    expect(kinds.existingConnection(kind, element(source), element(target))).toBeUndefined();
  });
});
