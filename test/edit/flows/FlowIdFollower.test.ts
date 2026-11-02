import { describe, expect, it } from 'vitest';
import { FlowIdFollower } from '../../../src/edit/flows/FlowIdFollower.js';
import { MessageFlows } from '../../../src/edit/flows/MessageFlows.js';
import { SequenceFlows } from '../../../src/edit/flows/SequenceFlows.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet, DocumentWriter } from '../../support/ModelValues.js';

async function open(path = 'edit/flows-line.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const edit = new EditSession(document);
  edit.begin();
  const element = (id: string) => document.tree.require(id);
  return { document, edit, element, follower: new FlowIdFollower(edit) };
}

describe('FlowIdFollower', () => {
  describe('follow', () => {
    it('renames a flow whose id names its old ends, in the drawing too', async () => {
      const { document, edit, element, follower } = await open();
      const flow = element('flow_aToB');
      flow.set('targetRef', element('task_c'));

      expect(follower.follow(flow, element('task_a'), element('task_b'))).toBe('flow_aToB');
      expect(flow.id).toBe('flow_aToC');
      expect(edit.journal.takeRenames()).toEqual([expect.objectContaining({ from: 'flow_aToB', to: 'flow_aToC', was: 'task_a -> task_b' })]);
      expect(await new DocumentWriter().write(document, new ChangeSet())).toContain('id="flow_aToC_di" bpmnElement="flow_aToC"');
    });

    it('keeps a flow whose id names no ends, or whose ends stayed', async () => {
      const { edit, element, follower } = await open('edit/flows-bridge.bpmn');
      const flow = element('f_aPlain');

      expect(new SequenceFlows(edit).redirect(flow, { target: element('t_named') })).toBeUndefined();
      expect(flow.id).toBe('f_aPlain');
      expect(follower.follow(flow, element('gw_a'), element('t_named'))).toBeUndefined();
    });

    it('keeps what is no sequence flow, or lost an old end', async () => {
      const { element, follower } = await open();

      expect(follower.follow(element('association_noteToFlow'), element('task_a'), element('task_b'))).toBeUndefined();
      expect(follower.follow(element('flow_aToB'), undefined, element('task_b'))).toBeUndefined();
    });

    it('keeps a flow whose new ends give it the id it has', async () => {
      const { element, follower } = await open();
      const flow = element('flow_aToB');
      flow.set('targetRef', element('Activity_0twin12'));

      expect(follower.follow(flow, element('task_a'), element('task_b'))).toBeUndefined();
      expect(flow.id).toBe('flow_aToB');
    });

    it('gives a flow the file left without an id one, the one asked for if any', async () => {
      const { document, element, follower } = await open();
      const flow = document.tree.processes()[0]!.list('flowElements').find((candidate) => candidate.is('bpmn:SequenceFlow') && !candidate.id)!;
      const oldTarget = element('task_c');
      flow.set('targetRef', element('endEvent_done'));

      expect(follower.follow(flow, element('Activity_0twin12'), oldTarget, 'flow_asked')).toBe('');
      expect(flow.id).toBe('flow_asked');
    });
  });

  describe('namesEnds', () => {
    it('tells an id that names the ends of a flow', async () => {
      const { element, follower } = await open();

      expect(follower.namesEnds('flow_aToB', element('task_a'), element('task_b'))).toBe(true);
      expect(follower.namesEnds('flow_aToC', element('task_a'), element('task_b'))).toBe(false);
    });

    it('takes no id for one that names nothing', async () => {
      const { element, follower } = await open();

      expect(follower.namesEnds(undefined, element('task_a'), element('task_b'))).toBe(false);
    });

    it('still knows the name an end had before it was renamed', async () => {
      const { edit, element, follower } = await open();
      const task = element('task_a');
      follower.recordFormerEnd(task);
      edit.document.tree.require('task_a').set('name', 'Verify');

      expect(follower.namesEnds('flow_aToB', task, element('task_b'))).toBe(true);
    });

    it('still knows an end whose id changed earlier in the batch', async () => {
      const { edit, element, follower } = await open();
      const task = element('task_a');
      follower.recordFormerEnd(task);
      task.set('id', 'task_verify');
      edit.document.tree.invalidate();

      expect(follower.namesEnds('flow_aToB', task, element('task_b'))).toBe(true);
    });
  });

  describe('recordFormerEnd', () => {
    it('remembers a node with flows, but not one without or an element that is no node', async () => {
      const { edit, element, follower } = await open('edit/flows-endpoints.bpmn');

      follower.recordFormerEnd(element('a_task'));
      follower.recordFormerEnd(element('a_guarded'));
      follower.recordFormerEnd(element('f_a1'));

      expect(edit.formerEndsOf(element('a_task'))).toEqual([expect.objectContaining({ id: 'a_task' })]);
      expect(edit.formerEndsOf(element('a_guarded'))).toEqual([]);
      expect(edit.formerEndsOf(element('f_a1'))).toEqual([]);
    });
  });

  describe('namedAfter', () => {
    it('lists the flows this batch made whose ids come from a node, not those of the file', async () => {
      const { edit, element, follower } = await open();
      const flow = new SequenceFlows(edit).create(element('task_a'), element('task_c'));
      new SequenceFlows(edit).create(element('task_a'), element('endEvent_done'), { id: 'flow_ownId' });

      expect(follower.namedAfter(element('task_a'))).toEqual([flow]);
    });

    it('lists a message flow this batch made, from either end', async () => {
      const { edit, element, follower } = await open('edit/two-pools.bpmn');
      const flow = new MessageFlows(edit).create(element('send_order'), element('pack'), {}, new ChangeSet());

      expect(follower.namedAfter(element('send_order'))).toEqual([flow]);
      expect(follower.namedAfter(element('pack'))).toEqual([flow]);
    });
  });

  describe('followRenamedEnd', () => {
    it('gives a flow the id of its renamed end and records what it was', async () => {
      const { document, edit, element, follower } = await open();
      const flow = element('flow_aToB');
      element('task_a').set('name', 'Verify');
      element('task_a').set('id', 'task_verify');
      document.tree.invalidate();

      follower.followRenamedEnd(flow, 'task_a -> task_b');

      expect(flow.id).toBe('flow_verifyToB');
      expect(edit.journal.takeRenames()).toEqual([expect.objectContaining({ from: 'flow_aToB', to: 'flow_verifyToB', was: 'task_a -> task_b', regenerated: true })]);
      expect(await new DocumentWriter().write(document, new ChangeSet())).toContain('id="flow_verifyToB_di"');
    });

    it('leaves a flow that already carries the id of its ends', async () => {
      const { edit, element, follower } = await open();

      follower.followRenamedEnd(element('flow_aToB'), 'task_a -> task_b');

      expect(element('flow_aToB').id).toBe('flow_aToB');
      expect(edit.journal.takeRenames()).toEqual([]);
    });

    it('leaves a flow this batch made from the same ends', async () => {
      const { edit, element, follower } = await open();
      const flow = new SequenceFlows(edit).create(element('task_a'), element('task_c'));

      follower.followRenamedEnd(flow, 'task_a -> task_c');

      expect(edit.journal.takeRenames()).toEqual([]);
    });
  });
});
