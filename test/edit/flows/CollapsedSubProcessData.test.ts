import { describe, expect, it } from 'vitest';
import { CollapsedSubProcessData } from '../../../src/edit/flows/CollapsedSubProcessData.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { LayoutRequests } from '../../support/ModelValues.js';

async function collapsedCrossScope() {
  const document = await Fixtures.readForWrite('layout/artifacts__04b-data-crossscope.bpmn');
  const edit = new EditSession(document);
  edit.begin();
  edit.requestExpansion(document.tree.require('Activity_Sub'), false, new LayoutRequests());
  return { edit, element: (id: string) => document.tree.require(id) };
}

describe('CollapsedSubProcessData', () => {
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
