import { describe, expect, it } from 'vitest';
import { Artifacts } from '../../../src/edit/containers/Artifacts.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const ARTIFACTS = 'edit/containers-artifacts.bpmn';
const LANES = 'edit/containers-lanes.bpmn';

async function setUp(path = ARTIFACTS) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  return { session, artifacts: new Artifacts(session), changes: new ChangeSet() };
}

describe('Artifacts', () => {
  it('backs a new data object reference with a data object in the same scope', async () => {
    const { session, artifacts, changes } = await setUp();
    const scope = session.require('sub_notes');

    const reference = artifacts.createDataObject(scope, { name: 'Invoice' }, changes);

    expect(reference.parent).toBe(scope);
    expect(reference.get<BpmnElement>('dataObjectRef').parent).toBe(scope);
    expect(changes.created[0]).toMatchObject({ id: reference.id, kind: 'dataObject', name: 'Invoice', detail: 'in sub_notes' });
    expect(changes.notes).toEqual([`backing dataObject ${reference.get<BpmnElement>('dataObjectRef').id} created for ${reference.id}`]);
  });

  it('keeps the id it is given and goes without a name', async () => {
    const { session, artifacts, changes } = await setUp();

    const reference = artifacts.createDataObject(session.require('Process_main'), { id: 'ref_mine' }, changes);

    expect(reference.id).toBe('ref_mine');
    expect(reference.name).toBeUndefined();
    expect(changes.created[0]).not.toHaveProperty('name');
  });

  it('refuses a data object or data store outside a process or sub-process', async () => {
    const { session, artifacts, changes } = await setUp();
    const task = session.require('write');

    expect(() => artifacts.createDataObject(task, {}, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_SCOPE' }));
    expect(() => artifacts.createDataStore(task, {}, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_SCOPE' }));
  });

  it('puts a data store at the root and its reference in the scope', async () => {
    const { session, artifacts, changes } = await setUp();
    const scope = session.require('Process_main');

    const reference = artifacts.createDataStore(scope, { name: 'Vault' }, changes);
    const store = reference.get<BpmnElement>('dataStoreRef');

    expect(store.parent).toBe(session.document.tree.definitions);
    expect(store.name).toBe('Vault');
    expect(reference.parent).toBe(scope);
    expect(changes.notes).toEqual([`root dataStore ${store.id} created for ${reference.id}`]);
  });

  it('adds a data store without a name', async () => {
    const { session, artifacts, changes } = await setUp();

    const reference = artifacts.createDataStore(session.require('Process_main'), {}, changes);

    expect(reference.get<BpmnElement>('dataStoreRef').name).toBeUndefined();
    expect(changes.created[0]).not.toHaveProperty('name');
  });

  it('holds a text annotation in the sub-process, process or collaboration it names', async () => {
    const { session, artifacts, changes } = await setUp();
    const scope = session.require('sub_notes');

    const annotation = artifacts.createTextAnnotation(scope, { text: 'Careful' }, changes);

    expect(scope.list('artifacts')).toContain(annotation);
    expect(annotation.get('text')).toBe('Careful');
    expect(changes.created[0]).toMatchObject({ kind: 'textAnnotation', name: 'Careful' });

    const pooled = await setUp(LANES);
    expect(pooled.artifacts.createTextAnnotation(pooled.session.require('Collaboration_orders'), {}, pooled.changes).parent?.id).toBe('Collaboration_orders');
    expect(pooled.changes.created[0]).not.toHaveProperty('name');
  });

  it('refuses a text annotation inside a task', async () => {
    const { session, artifacts, changes } = await setUp();

    expect(() => artifacts.createTextAnnotation(session.require('write'), {}, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_SCOPE' }));
  });

  it('draws a group in the innermost sub-process that holds all its members', async () => {
    const { session, artifacts, changes } = await setUp();

    const group = artifacts.createGroup({ name: 'Inner', members: ['inner_one', 'notes_task'] }, changes);

    expect(group.parent?.id).toBe('sub_notes');
    expect(group.get<BpmnElement>('categoryValueRef').get('value')).toBe('Inner');
    expect(session.require('inner_one').list('categoryValueRef')).toContain(group.get<BpmnElement>('categoryValueRef'));
    expect(changes.created[0]).toMatchObject({ kind: 'group', name: 'Inner', detail: 'around inner_one, notes_task' });
  });

  it('draws a group across a sub-process border in the process', async () => {
    const { artifacts, changes } = await setUp();

    expect(artifacts.createGroup({ members: ['inner_one', 'write'] }, changes).parent?.id).toBe('Process_main');
  });

  it('draws a group of a pool in the collaboration', async () => {
    const { artifacts, changes } = await setUp(LANES);

    expect(artifacts.createGroup({ members: ['check', 'pack'] }, changes).parent?.id).toBe('Collaboration_orders');
  });

  it('refuses a sequence flow as a group member', async () => {
    const { artifacts, changes } = await setUp(LANES);

    expect(() => artifacts.createGroup({ members: ['flow_startToCheck'] }, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', details: expect.objectContaining({ element: 'flow_startToCheck' }) }));
  });

  it('takes data references as group members and refuses a group of nothing', async () => {
    const { artifacts, changes } = await setUp();

    expect(artifacts.createGroup({ members: ['ref_note'] }, changes).parent?.id).toBe('Process_main');
    expect(() => artifacts.createGroup({}, changes)).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
    expect(() => artifacts.createGroup({ members: [] }, changes)).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
  });

  it('renames a group through its category value and clears the value for an empty name', async () => {
    const { session, artifacts } = await setUp();
    const group = session.require('group_review');

    artifacts.setGroupName(group, 'Second look');
    expect(group.get<BpmnElement>('categoryValueRef').get('value')).toBe('Second look');

    artifacts.setGroupName(group, '');
    expect(group.get<BpmnElement>('categoryValueRef').get('value')).toBeUndefined();
  });

  it('gives a group without a category value one when it gets a name, and only then', async () => {
    const { session, artifacts } = await setUp();
    const group = session.require('group_bare');

    artifacts.setGroupName(group, '');
    expect(group.get<BpmnElement>('categoryValueRef')).toBeUndefined();

    artifacts.setGroupName(group, 'Named');
    expect(group.get<BpmnElement>('categoryValueRef').get('value')).toBe('Named');
    expect(group.get<BpmnElement>('categoryValueRef').parent?.is('bpmn:Category')).toBe(true);
  });
});
