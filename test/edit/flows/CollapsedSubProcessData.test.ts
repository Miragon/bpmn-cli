import { describe, expect, it } from 'vitest';
import { CollapsedSubProcessData } from '../../../src/edit/flows/CollapsedSubProcessData.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet, LayoutRequests } from '../../support/ModelValues.js';

async function collapsedCrossScope() {
  const document = await Fixtures.readForWrite('layout/artifacts__04b-data-crossscope.bpmn');
  const edit = new EditSession(document);
  edit.begin();
  edit.requestExpansion(document.tree.require('Activity_Sub'), false, new LayoutRequests());
  return { edit, element: (id: string) => document.tree.require(id) };
}

const removing = () => {
  throw new Error('nothing to merge in this fixture');
};

describe('CollapsedSubProcessData', () => {
  it('moves a data input from inside onto the collapsed sub-process and drops the placeholder nothing reads into', async () => {
    const { edit, element } = await collapsedCrossScope();
    const changes = new ChangeSet();

    new CollapsedSubProcessData(edit).attachToCollapsed(element('Activity_Sub'), changes, removing);

    expect(element('Activity_Sub').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_4']);
    expect(element('Activity_Score').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_2']);
    expect(element('Activity_Score').list('properties').map(({ id }) => id)).toEqual(['Property_2']);
    expect(changes.changed).toEqual([{ id: 'DataInputAssociation_4', kind: 'dataAssociation', detail: 'moved from Activity_Score to Activity_Sub' }]);
  });

  it('keeps data associations that stay inside the sub-process', async () => {
    const { edit, element } = await collapsedCrossScope();

    new CollapsedSubProcessData(edit).attachToCollapsed(element('Activity_Sub'), new ChangeSet(), removing);

    expect(element('Activity_Score').list('dataOutputAssociations').map(({ id }) => id)).toEqual(['DataOutputAssociation_1']);
    expect(element('Activity_Review').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_1']);
  });

  it.each([
    ['data outside to a task inside', 'DataObjectReference_App', 'Activity_Review', 'Activity_Review'],
    ['a task outside to data inside', 'Activity_Inform', 'DataObjectReference_Score', 'DataObjectReference_Score'],
  ])('refuses to connect %s of a collapsed sub-process', async (_case, source, target, hidden) => {
    const { edit, element } = await collapsedCrossScope();

    expect(() => new CollapsedSubProcessData(edit).assertConnectable(element(source), element(target))).toThrow(expect.objectContaining({ code: 'E_INVALID_ENDPOINT', details: expect.objectContaining({ element: hidden }) }));
  });

  it('lets data and a task inside the same collapsed sub-process connect', async () => {
    const { edit, element } = await collapsedCrossScope();

    expect(() => new CollapsedSubProcessData(edit).assertConnectable(element('DataObjectReference_Score'), element('Activity_Review'))).not.toThrow();
  });
});
