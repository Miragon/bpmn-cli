import { describe, expect, it } from 'vitest';
import { IdRename } from '../../../src/edit/properties/IdRename.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

type Conventions = EditSession['document']['conventions'];

const DECLARED: Conventions = { prefixes: { 'bpmn:Task': 'task_', 'bpmn:UserTask': 'userTask_', 'bpmn:EndEvent': 'endEvent_' }, source: '.bpmnlintrc' };

async function open(conventions?: Conventions) {
  const document = await Fixtures.readForWrite('edit/properties-ids.bpmn');
  document.conventions = conventions;
  const edit = new EditSession(document);
  return { document, edit, ids: new IdRename(edit), shapeIds: () => document.tree.definitions.list<BpmnElement>('diagrams')[0]!.get<BpmnElement>('plane').list<BpmnElement>('planeElement').map(({ id }) => id) };
}

function vendorValues(host: BpmnElement, key: string) {
  return host.get<BpmnElement>('extensionElements').list<BpmnElement>('values').map((value) => value.peek(key));
}

describe('IdRename', () => {
  it('tells the state of an element from its type and trigger', async () => {
    const { document } = await open();

    expect(IdRename.stateOf(document.tree.require('task_suffix'))).toEqual({ type: 'bpmn:Task' });
    expect(IdRename.stateOf(document.tree.require('startEvent_daily'))).toEqual({ type: 'bpmn:StartEvent', trigger: 'timer' });
  });

  describe('rename', () => {
    it('changes the id and frees the old one', async () => {
      const { document, ids } = await open();
      const task = document.tree.require('task_suffix');

      ids.rename(task, 'task_new');

      expect(document.tree.require('task_new')).toBe(task);
      expect(document.ids.registry.has('task_suffix')).toBe(false);
    });

    it('leaves everything as it is for the id the element already has', async () => {
      const { document, ids, shapeIds } = await open();

      ids.rename(document.tree.require('task_suffix'), 'task_suffix');

      expect(shapeIds()).toContain('task_suffix_di');
    });

    it('refuses an id another element has', async () => {
      const { document, ids } = await open();

      expect(() => ids.rename(document.tree.require('task_suffix'), 'task_bpmn')).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_ID' }));
    });

    it('takes a DI id derived from the old id along, in the suffix and the engine style', async () => {
      const { document, ids, shapeIds } = await open();

      ids.rename(document.tree.require('task_suffix'), 'task_one');
      ids.rename(document.tree.require('task_bpmn'), 'task_two');

      expect(shapeIds()).toEqual(expect.arrayContaining(['task_one_di', 'BPMNShape_task_two']));
    });

    it('leaves a DI id that is not derived from the old id', async () => {
      const { document, ids, shapeIds } = await open();

      ids.rename(document.tree.require('task_handmade'), 'task_one');

      expect(shapeIds()).toContain('Shape_0abc123');
    });

    it('gives a derived DI id whose new id is taken the suffix _2', async () => {
      const { document, ids, shapeIds } = await open();

      ids.rename(document.tree.require('task_suffix'), 'task_taken_x');
      ids.rename(document.tree.require('task_bpmn'), 'task_bpmn');
      document.ids.registry.claim('task_one_di');
      ids.rename(document.tree.require('task_taken'), 'task_one');

      expect(shapeIds()).toContain('task_one_di_2');
    });

    it('follows a renamed process into the call activities that call it', async () => {
      const { document, ids } = await open();

      ids.rename(document.tree.require('Process_sub'), 'Process_renamed');

      expect(document.tree.require('call_camunda').get('calledElement')).toBe('Process_renamed');
      expect(document.tree.require('call_other').get('calledElement')).toBe('Process_elsewhere');
      expect(vendorValues(document.tree.require('call_zeebe'), 'processId')).toEqual(['Process_renamed']);
      expect(vendorValues(document.tree.require('call_zeebeOther'), 'processId')).toEqual(['Process_elsewhere']);
    });

    it('follows a renamed error into the Camunda error definitions that name it', async () => {
      const { document, ids } = await open();

      ids.rename(document.tree.require('Error_late'), 'Error_renamed');

      expect(vendorValues(document.tree.require('task_handler'), 'errorRef')).toEqual(['Error_renamed', 'Error_other', undefined]);
    });
  });

  describe('recordState', () => {
    it('remembers nothing about an id of the file without declared conventions', async () => {
      const { document, edit, ids } = await open();

      ids.recordState(document.tree.require('task_suffix'), { type: 'bpmn:UserTask' }, 'user task');

      expect(edit.journal.takeIdStates().size).toBe(0);
    });

    it('keeps an id of the file under declared conventions and remembers what it was', async () => {
      const { document, edit, ids } = await open(DECLARED);

      ids.recordState(document.tree.require('task_suffix'), { type: 'bpmn:UserTask' }, 'user task');

      expect(edit.journal.takeIdStates().get('task_suffix')).toEqual({ before: { type: 'bpmn:UserTask' }, wasLabel: 'user task' });
    });

    it('regenerates an id it generated when the element became something else', async () => {
      const { document, edit, ids } = await open();
      const end = document.tree.require('task_finished');
      edit.allocator.markGenerated('task_finished', 'task_finished');

      ids.recordState(end, { type: 'bpmn:Task' }, 'task');

      expect(end.id).toBe('endEvent_finished');
      expect(edit.allocator.generatedBase('endEvent_finished')).toBe('endEvent_finished');
      expect(edit.journal.takeRenames()).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'task_finished', to: 'endEvent_finished', regenerated: true })]));
    });

    it('keeps a flow whose name still names both ends of a regenerated id', async () => {
      const { document, edit, ids } = await open();
      const end = document.tree.require('task_finished');
      edit.allocator.markGenerated('task_finished', 'task_finished');

      ids.recordState(end, { type: 'bpmn:Task' }, 'task');

      expect(end.list<BpmnElement>('incoming').map(({ id }) => id)).toEqual(['flow_prepareToFinished']);
    });

    it('leaves a generated id that still fits', async () => {
      const { document, edit, ids } = await open();
      const task = document.tree.require('task_suffix');
      edit.allocator.markGenerated('task_suffix', 'task_suffix');

      ids.recordState(task, { type: 'bpmn:Task' }, 'task');

      expect(task.id).toBe('task_suffix');
      expect(edit.journal.takeRenames()).toEqual([]);
    });
  });

  describe('reportStalePrefixes', () => {
    async function report(id: string, before: { type: string }, label: string) {
      const { document, edit, ids } = await open(DECLARED);
      ids.recordState(document.tree.require(id), before, label);
      const changes = new ChangeSet();
      return { document, edit, ids, changes };
    }

    it('warns about an id that keeps the prefix of what the element was', async () => {
      const { ids, changes } = await report('task_0a1b2c3', { type: 'bpmn:Task' }, 'task');

      ids.reportStalePrefixes(changes);

      expect(changes.warnings).toEqual([expect.objectContaining({
        code: 'W_ID_PREFIX_STALE',
        element: 'task_0a1b2c3',
        message: 'task_0a1b2c3 keeps its id, whose prefix task_ is that of a task; element-id-naming (.bpmnlintrc) expects userTask_ for a userTask',
        hint: expect.stringContaining('bpmn set <file> task_0a1b2c3 id='),
      })]);
    });

    it('suggests the id of what the element is now for an id that did not pass the rule', async () => {
      const { document, ids, edit } = await open(DECLARED);
      const end = document.tree.require('task_finished');
      ids.recordState(end, { type: 'bpmn:StartEvent' }, 'end event');
      const changes = new ChangeSet();

      ids.reportStalePrefixes(changes);

      expect(changes.warnings[0]?.message).toBe('task_finished keeps its id, which element-id-naming (.bpmnlintrc) did not check on an end event; it expects endEvent_ for an endEvent:terminate');
      expect(edit.journal.takeIdStates().size).toBe(0);
    });

    it('names no source when the host declared the conventions', async () => {
      const { document, ids } = await open({ prefixes: { 'bpmn:UserTask': 'userTask_', 'bpmn:Task': 'task_' } });
      ids.recordState(document.tree.require('task_0a1b2c3'), { type: 'bpmn:Task' }, 'task');
      const changes = new ChangeSet();

      ids.reportStalePrefixes(changes);

      expect(changes.warnings[0]?.message).toContain('element-id-naming (the host)');
    });

    it('stays silent about an element the batch removed since, and one that fits', async () => {
      const { document, ids, changes } = await report('task_0a1b2c3', { type: 'bpmn:Task' }, 'task');
      ids.recordState(document.tree.require('Activity_0a1b2c3'), { type: 'bpmn:Task' }, 'task');
      document.tree.require('task_0a1b2c3').parent!.remove('flowElements', document.tree.require('task_0a1b2c3'));
      document.tree.invalidate();

      ids.reportStalePrefixes(changes);

      expect(changes.warnings).toEqual([]);
    });

    it('reports nothing when nothing was remembered', async () => {
      const { ids } = await open(DECLARED);
      const changes = new ChangeSet();

      ids.reportStalePrefixes(changes);

      expect(changes.warnings).toEqual([]);
    });
  });
});
