import { describe, expect, it } from 'vitest';
import { DataIntoCollapsedSubProcess } from '../../../src/edit/consequences/DataIntoCollapsedSubProcess.js';
import { ElementRemoval } from '../../../src/edit/ElementRemoval.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet, LayoutRequests } from '../../support/ModelValues.js';

async function collapsedCrossScope() {
  const document = await Fixtures.readForWrite('layout/artifacts__04b-data-crossscope.bpmn');
  const edit = new EditSession(document);
  edit.begin();
  edit.requestExpansion(document.tree.require('Activity_Sub'), false, new LayoutRequests());
  const consequence = new DataIntoCollapsedSubProcess(edit, new ElementRemoval(edit));
  return { consequence, element: (id: string) => document.tree.require(id) };
}

describe('DataIntoCollapsedSubProcess', () => {
  it('finds the data association that reaches from outside into the collapsed sub-process', async () => {
    const { consequence } = await collapsedCrossScope();

    expect([...consequence.findProblems()].map(({ id }) => id)).toEqual(['DataInputAssociation_4']);
  });

  it('moves a data input from inside onto the collapsed sub-process and drops the placeholder nothing reads into', async () => {
    const { consequence, element } = await collapsedCrossScope();
    const changes = new ChangeSet();

    consequence.repair(element('DataInputAssociation_4'), changes);

    expect(element('Activity_Sub').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_4']);
    expect(element('Activity_Score').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_2']);
    expect(element('Activity_Score').list('properties').map(({ id }) => id)).toEqual(['Property_2']);
    expect(changes.changed).toEqual([{ id: 'DataInputAssociation_4', kind: 'dataAssociation', detail: 'moved from Activity_Score to Activity_Sub' }]);
  });

  it('repairs a crossing that was there at the start when the batch collapses its sub-process', async () => {
    const { consequence, element } = await collapsedCrossScope();
    consequence.findProblemsAtStart();

    consequence.repairNewProblems(new ChangeSet());

    expect(element('Activity_Sub').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_4']);
  });
});
