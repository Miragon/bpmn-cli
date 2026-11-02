import { describe, expect, it } from 'vitest';
import { InapplicableContent } from '../../../src/edit/properties/InapplicableContent.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function warningOn(id: string) {
  const document = await Fixtures.readForWrite('edit/properties-retyped.bpmn');
  const target = { kind: 'serviceTask' } as Parameters<InapplicableContent['warningFor']>[1];
  return new InapplicableContent(new EditSession(document)).warningFor(document.tree.require(id), target);
}

describe('InapplicableContent', () => {
  it.each(['task_clean', 'note_other'])('finds nothing on %s, whose vendor content still applies or is no engine\'s', async (id) => {
    expect(await warningOn(id)).toBeUndefined();
  });

  it('names one attribute the element no longer takes and how to remove it', async () => {
    expect(await warningOn('task_oneAttribute')).toEqual({
      code: 'W_PROPERTY_INAPPLICABLE',
      element: 'task_oneAttribute',
      message: 'camunda:assignee of task_oneAttribute has no effect on a serviceTask (kept as it is)',
      hint: 'The Camunda descriptor does not allow it on a serviceTask; remove with `bpmn set <file> task_oneAttribute camunda:assignee=`, or retype back.',
    });
  });

  it('names several attributes in one warning', async () => {
    const warning = await warningOn('task_twoAttributes');

    expect(warning?.message).toBe('camunda:assignee, camunda:candidateGroups of task_twoAttributes have no effect on a serviceTask (kept as they are)');
    expect(warning?.hint).toContain('allow them on a serviceTask');
  });

  it('names a repeated extension element once', async () => {
    const warning = await warningOn('task_listeners');

    expect(warning?.message).toContain('camunda:taskListener of task_listeners has');
    expect(warning?.hint).toContain('`bpmn ext remove <file> task_listeners camunda:taskListener`');
  });

  it('says Zeebe when only Zeebe content is misplaced', async () => {
    expect((await warningOn('task_zeebe'))?.hint).toContain('The Zeebe (Camunda 8) descriptor');
  });

  it('says both engines when both are misplaced, and lists a fix for each', async () => {
    const warning = await warningOn('task_mixed');

    expect(warning?.hint).toContain('The Camunda 7 and Zeebe descriptor');
    expect(warning?.hint).toContain('camunda:assignee=` and `bpmn ext remove');
  });

  it('finds a Zeebe attribute of a host that does not take it', async () => {
    expect((await warningOn('note_template'))?.message).toContain('zeebe:modelerTemplate of note_template');
  });
});
