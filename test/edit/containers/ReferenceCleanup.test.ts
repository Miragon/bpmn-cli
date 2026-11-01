import { describe, expect, it } from 'vitest';
import { ElementContainment } from '../../../src/edit/containers/ElementContainment.js';
import { ReferenceCleanup } from '../../../src/edit/containers/ReferenceCleanup.js';
import { ElementRemoval } from '../../../src/edit/ElementRemoval.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

const ARTIFACTS = 'edit/containers-artifacts.bpmn';
const LANES = 'edit/containers-lanes.bpmn';

async function setUp(path = ARTIFACTS) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  const removal = new ElementRemoval(session);
  const cleanup = new ReferenceCleanup(session, (element, changes) => removal.cascade(element, changes));
  const changes = new ChangeSet();
  const detach = (id: string) => {
    const element = session.require(id);
    const parent = new ElementContainment(element).detach();
    session.document.tree.invalidate();
    cleanup.afterDetach(element, parent, changes);
    return element;
  };
  return { session, cleanup, changes, detach, tree: session.document.tree };
}

describe('ReferenceCleanup', () => {
  it('tells an element in the tree from one taken out of it', async () => {
    const { session, cleanup } = await setUp();
    const task = session.require('write');

    expect(cleanup.isAttached(task)).toBe(true);
    new ElementContainment(task).detach();

    expect(cleanup.isAttached(task)).toBe(false);
  });

  it('drops a lane set when its last lane left, and frees its id', async () => {
    const { tree, detach, changes } = await setUp(LANES);

    detach('lane_other');

    expect(tree.require('Process_other').list('laneSets')).toEqual([]);
    expect(changes.notes).toEqual(['lane set LaneSet_other removed: no lanes left']);
    expect(tree.has('LaneSet_other')).toBe(false);
  });

  it('keeps a lane set that still has a lane', async () => {
    const { tree, detach, changes } = await setUp(LANES);

    detach('lane_idle');

    expect(tree.has('LaneSet_orders')).toBe(true);
    expect(changes.notes).toEqual([]);
  });

  it('drops the child lane set of a lane when its last child left', async () => {
    const { tree, detach } = await setUp(LANES);

    detach('lane_inbound');
    detach('lane_outbound');

    expect(tree.require('lane_ops').get<BpmnElement>('childLaneSet')).toBeUndefined();
  });

  it('drops the property only a removed data input led into', async () => {
    const { tree, session, detach } = await setUp();

    detach('input_note');

    expect(session.require('write').list('properties').map(({ id }) => id)).toEqual(['property_kept']);
    expect(tree.has('property_input')).toBe(false);
  });

  it('drops the data object only a removed reference pointed at', async () => {
    const { tree, detach, changes } = await setUp();

    detach('ref_single');

    expect(tree.has('DataObject_single')).toBe(false);
    expect(changes.removed.map(({ id }) => id)).toEqual(['DataObject_single']);
  });

  it('keeps a data object another reference still points at', async () => {
    const { tree, detach } = await setUp();

    detach('ref_noteCopy');

    expect(tree.has('DataObject_note')).toBe(true);
  });

  it('drops the data store only a removed reference pointed at', async () => {
    const { tree, detach } = await setUp();

    detach('ref_ledger');

    expect(tree.has('DataStore_ledger')).toBe(false);
  });

  it('drops the category value of a removed group, and the category with its last value', async () => {
    const { tree, detach } = await setUp();

    detach('group_review');
    expect(tree.has('CategoryValue_review')).toBe(false);
    expect(tree.has('Category_review')).toBe(true);

    detach('group_sharedOne');
    expect(tree.has('CategoryValue_shared')).toBe(true);

    detach('group_sharedTwo');
    expect(tree.has('Category_review')).toBe(false);
  });

  it('asks nothing of a group without a category value', async () => {
    const { detach, changes } = await setUp();

    detach('group_bare');

    expect(changes.removed).toEqual([]);
  });

  it('warns about a call activity that still calls a removed process', async () => {
    const { detach, changes } = await setUp();

    detach('Process_helper');

    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_DANGLING_CALLED_ELEMENT', element: 'call_helper', related: ['Process_helper'] })]);
  });

  it('lets a flow fall with the node it ran to', async () => {
    const { session, cleanup, changes, tree } = await setUp();
    const read = session.require('read');
    new ElementContainment(read).detach();

    cleanup.clearReferences(new Set([read]), changes);

    expect(tree.has('flow_writeToRead')).toBe(false);
    expect(tree.has('association_note')).toBe(false);
  });

  it('lets a boundary event fall with its host', async () => {
    const { session, cleanup, changes, tree } = await setUp(LANES);
    const check = session.require('check');
    new ElementContainment(check).detach();

    cleanup.clearReferences(new Set([check]), changes);

    expect(tree.has('timer_check')).toBe(false);
  });

  it('turns a pool into a black box when its process goes', async () => {
    const { session, cleanup, changes } = await setUp(LANES);
    const process = session.require('Process_other');
    new ElementContainment(process).detach();

    cleanup.clearReferences(new Set([process]), changes);

    expect(session.require('pool_other').get<BpmnElement>('processRef')).toBeUndefined();
    expect(changes.warnings[0]).toMatchObject({ code: 'W_BLACK_BOX', element: 'pool_other', related: ['Process_other'] });
  });

  it('takes a removed node off its lane and reports the lane', async () => {
    const { session, cleanup, changes } = await setUp(LANES);
    const pack = session.require('pack');
    new ElementContainment(pack).detach();

    cleanup.clearReferences(new Set([pack]), changes);

    expect(session.require('lane_inbound').list('flowNodeRef')).toEqual([]);
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'lane_inbound', detail: 'member pack removed' })]);
  });

  it('takes a removed value off the category references of a member without a report', async () => {
    const { session, cleanup, changes } = await setUp();
    const task = session.require('write');
    const value = session.require('CategoryValue_review');
    task.add('categoryValueRef', value);

    cleanup.clearReferences(new Set([value]), changes);

    expect(task.list('categoryValueRef')).toEqual([]);
    expect(changes.changed.map(({ id }) => id)).toEqual(['group_review']);
  });

  it('clears a default flow without a report and any other single reference with one', async () => {
    const { session, cleanup, changes } = await setUp();
    const write = session.require('write');
    const flow = session.require('flow_writeToRead');

    write.set('default', flow);
    cleanup.clearReferences(new Set([flow]), changes);
    expect(write.get('default')).toBeUndefined();
    expect(changes.changed).toEqual([]);

    const group = session.require('group_review');
    const value = group.get<BpmnElement>('categoryValueRef');
    cleanup.clearReferences(new Set([value]), changes);
    expect(group.get<BpmnElement>('categoryValueRef')).toBeUndefined();
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'group_review', detail: 'categoryValueRef cleared (CategoryValue_review removed)' })]);
  });

  it('drops the shape of a removed element from the diagram', async () => {
    const { session, cleanup, changes, tree } = await setUp('model/di-styles.bpmn');
    const shapes = () => [...tree.walk()].filter((element) => element.is('bpmndi:BPMNShape')).map(({ id }) => id);

    cleanup.clearReferences(new Set([session.require('task_b')]), changes);

    expect(shapes()).toEqual(expect.arrayContaining(['BPMNShape_task_a', 'Shape_task_c']));
    expect(shapes()).not.toContain('BPMNShape_task_b');
    expect(changes.changed).toEqual([]);
  });

  it('drops the whole diagram of a removed process', async () => {
    const { session, cleanup, changes, tree } = await setUp('model/di-styles.bpmn');

    expect(tree.definitions.list('diagrams')).toHaveLength(1);
    cleanup.clearReferences(new Set([session.require('Process_styles')]), changes);

    expect(tree.definitions.list('diagrams')).toEqual([]);
  });
});
