import { describe, expect, it } from 'vitest';
import { Associations } from '../../../src/edit/flows/Associations.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet } from '../../support/ModelValues.js';

async function endpoints() {
  const document = await Fixtures.readForWrite('edit/flows-endpoints.bpmn');
  const element = (id: string) => document.tree.require(id);
  return { associations: new Associations(new EditSession(document)), changes: new ChangeSet(), document, element };
}

describe('Associations', () => {
  it('ties a note to a task, in the process of the note', async () => {
    const { associations, changes, document, element } = await endpoints();

    const association = associations.createAssociation(element('a_note2'), element('a_task'), { id: 'association_new' }, changes);

    expect(association.parent).toBe(document.tree.require('Process_a'));
    expect(association.get('associationDirection')).toBeUndefined();
    expect(changes.created).toEqual([{ id: 'association_new', kind: 'association', detail: 'a_note2 -> a_task' }]);
  });

  it('keeps the association of a note on a task inside a sub-process', async () => {
    const { associations, changes, element } = await endpoints();

    const association = associations.createAssociation(element('a_inner'), element('a_innerNote'), {}, changes);

    expect(association.parent).toBe(element('a_sub'));
  });

  it('holds the association of a note on a pool in the collaboration', async () => {
    const { associations, changes, document, element } = await endpoints();

    const association = associations.createAssociation(element('pool_b'), element('a_note'), {}, changes);

    expect([document.tree.require('Process_a'), document.tree.collaboration()]).toContain(association.parent);
  });

  it('marks the target of a compensation boundary event as its handler, and names the change', async () => {
    const { associations, changes, element } = await endpoints();

    const association = associations.createAssociation(element('a_compensate'), element('a_undo'), {}, changes);

    expect(association.get('associationDirection')).toBe('One');
    expect(element('a_undo').get('isForCompensation')).toBe(true);
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'a_undo', detail: 'isForCompensation=true (compensation handler)' })]);
  });

  it('leaves a handler that already is one unreported', async () => {
    const { associations, changes, element } = await endpoints();

    associations.createAssociation(element('a_compensate'), element('a_handler'), {}, changes);

    expect(changes.changed).toEqual([]);
  });

  it('refuses two notes, and an association without a note or compensation', async () => {
    const { associations, changes, element } = await endpoints();

    expect(() => associations.createAssociation(element('a_note'), element('a_note2'), {}, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_ENDPOINT', message: expect.stringContaining('two text annotations') }));
    expect(() => associations.createAssociation(element('a_task'), element('a_guarded'), {}, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_ENDPOINT', message: expect.stringContaining('text annotation on one side') }));
  });

  it('reads a data object into a task through a placeholder property', async () => {
    const { associations, changes, element } = await endpoints();

    const association = associations.createDataAssociation(element('a_data'), element('a_task'), { id: 'in_new' }, changes);

    expect(element('a_task').list('dataInputAssociations')).toEqual([association]);
    expect(association.list('sourceRef')).toEqual([element('a_data')]);
    expect(association.get<{ name: string }>('targetRef').name).toBe('__targetRef_placeholder');
    expect(changes.created).toEqual([{ id: 'in_new', kind: 'dataAssociation', detail: 'a_data -> a_task' }]);
  });

  it('shares the placeholder property of a task that reads a second data object', async () => {
    const { associations, changes, element } = await endpoints();

    associations.createDataAssociation(element('a_data2'), element('a_reader'), {}, changes);

    expect(element('a_reader').list('properties').map(({ id }) => id)).toEqual(['property_slot']);
  });

  it('writes a task into a data store', async () => {
    const { associations, changes, element } = await endpoints();

    const association = associations.createDataAssociation(element('a_task'), element('a_store'), {}, changes);

    expect(element('a_task').list('dataOutputAssociations')).toEqual([association]);
    expect(association.get('targetRef')).toBe(element('a_store'));
  });

  it.each([
    ['no data on either side', 'a_task', 'a_guarded', 'exactly one side'],
    ['data on both sides', 'a_data', 'a_data2', 'exactly one side'],
    ['a gateway that reads data', 'a_data', 'a_gateway', 'only activities and throw events'],
    ['a gateway that writes data', 'a_gateway', 'a_data', 'only activities and catch events'],
  ])('refuses %s', async (_case, source, target, message) => {
    const { associations, changes, element } = await endpoints();

    expect(() => associations.createDataAssociation(element(source), element(target), {}, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_ENDPOINT', message: expect.stringContaining(message) }));
  });

  it('takes a throw event that reads and a catch event that writes', async () => {
    const { associations, changes, element } = await endpoints();

    associations.createDataAssociation(element('a_data'), element('a_throwMessage'), {}, changes);
    associations.createDataAssociation(element('a_catchMessage'), element('a_data'), {}, changes);

    expect(changes.created.map(({ kind }) => kind)).toEqual(['dataAssociation', 'dataAssociation']);
  });

  it('removes a read and the placeholder only it used', async () => {
    const { associations, document, element } = await endpoints();

    associations.removeDataAssociation(document.tree.require('in_read'));

    expect(element('a_reader').list('dataInputAssociations')).toEqual([]);
    expect(element('a_reader').list('properties')).toEqual([]);
    expect(document.tree.has('in_read')).toBe(false);
  });

  it('keeps a placeholder another read still uses', async () => {
    const { associations, changes, document, element } = await endpoints();
    associations.createDataAssociation(element('a_data2'), element('a_reader'), {}, changes);

    associations.removeDataAssociation(document.tree.require('in_read'));

    expect(element('a_reader').list('properties').map(({ id }) => id)).toEqual(['property_slot']);
  });

  it('removes a write', async () => {
    const { associations, document, element } = await endpoints();

    associations.removeDataAssociation(document.tree.require('out_read'));

    expect(element('a_reader').list('dataOutputAssociations')).toEqual([]);
  });
});
