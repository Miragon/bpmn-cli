import { describe, expect, it } from 'vitest';
import { ChangeEntries } from '../../../src/model/document/ChangeEntries.js';
import { ChangeSet } from '../../../src/model/document/ChangeSet.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ChangeSet', () => {
  const change = (id: string, detail?: string) => ({ id, kind: 'task', ...(detail ? { detail } : {}) });

  it('starts empty and records what a change did', () => {
    const changes = new ChangeSet();

    expect(changes.isEmpty).toBe(true);
    changes.create(change('a')).change(change('b')).remove(change('c')).warn({ code: 'W_X', message: 'M' }).note('n');

    expect(changes.isEmpty).toBe(false);
    expect(changes.touchedIds()).toEqual(['a', 'b']);
  });

  it('lists one changed element once per detail', () => {
    const changes = new ChangeSet().change(change('a', 'x')).change(change('a', 'x')).change(change('a', 'y'));

    expect(changes.changed).toHaveLength(2);
  });

  it('binds an alias only when both alias and element exist', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const task = tree.require('task_send');

    const changes = new ChangeSet().bind('$a', task).bind(undefined, task).bind('$b', undefined);

    expect(changes.bindings).toEqual([{ alias: '$a', el: task }]);
  });

  it('renames the entries of the renamed element', () => {
    const changes = new ChangeSet().create(change('old')).rename([{ from: 'old', to: 'new' }]);

    expect(changes.created[0]!.id).toBe('new');
    expect(changes.renames).toEqual([{ from: 'old', to: 'new' }]);
  });

  it('leaves the entries of an element that took the freed id', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const [renamed, other] = [tree.require('task_send'), tree.require('task_review')];
    const changes = new ChangeSet();
    changes.change(ChangeEntries.about(change('freed'), other));

    changes.rename([ChangeEntries.about({ from: 'freed', to: 'new' }, renamed)]);

    expect(changes.changed[0]!.id).toBe('freed');
  });

  it('turns a rename onto a removed id into a takeover, listing each id once', () => {
    const changes = new ChangeSet().remove({ id: 'flow_b', kind: 'sequenceFlow' }).change({ id: 'flow_b', kind: 'sequenceFlow', detail: 'x (renamed from flow_a: its id named its old ends)' });
    changes.renames.push({ from: 'flow_0', to: 'flow_a' });

    changes.rename([{ from: 'flow_a', to: 'flow_b', was: 'A -> B' }]);

    expect(changes.removed).toEqual([{ id: 'flow_0', kind: 'sequenceFlow' }]);
    expect(changes.renames.at(-1)).toEqual({ from: 'flow_a', to: 'flow_b', was: 'A -> B', takeover: true });
    expect(changes.changed[0]!.detail).toBe('x');
  });

  it('names the old ends of a takeover that has no earlier rename', () => {
    const changes = new ChangeSet().remove({ id: 'flow_b', kind: 'sequenceFlow' });

    changes.rename([{ from: 'flow_a', to: 'flow_b', was: 'A -> B' }]);

    expect(changes.removed).toEqual([{ id: 'flow_a', kind: 'sequenceFlow', detail: 'A -> B' }]);
  });

  it('keeps a rename onto an id a created element holds', () => {
    const changes = new ChangeSet().create(change('flow_b')).remove({ id: 'flow_b', kind: 'sequenceFlow' });

    changes.rename([{ from: 'flow_a', to: 'flow_b' }]);

    expect(changes.renames).toEqual([{ from: 'flow_a', to: 'flow_b' }]);
    expect(changes.removed).toHaveLength(1);
  });

  it('follows a regenerated id through details, notes and warnings', () => {
    const changes = new ChangeSet()
      .create(change('task_a', 'after task_a'))
      .note('see task_a, not task_ab')
      .warn({ code: 'W_ID_SUFFIXED', message: 'taken', element: 'task_a' })
      .warn({ code: 'W_X', message: 'on task_a', hint: 'fix task_a', element: 'task_a' })
      .warn({ code: 'W_Y', message: 'on task_b', element: 'task_b' });

    changes.rename([{ from: 'task_a', to: 'task_b', regenerated: true }]);

    expect(changes.created[0]).toEqual(change('task_b', 'after task_b'));
    expect(changes.notes).toEqual(['see task_b, not task_ab']);
    expect(changes.warnings).toEqual([{ code: 'W_X', message: 'on task_b', hint: 'fix task_b', element: 'task_b' }, { code: 'W_Y', message: 'on task_b', element: 'task_b' }]);
  });

  it('merges another change, entries before renames', async () => {
    const { tree } = await Fixtures.read('model/events.bpmn');
    const task = tree.require('task_send');
    const other = new ChangeSet().create(change('b')).change(change('c')).remove(change('flow_z')).warn({ code: 'W', message: 'm' }).note('n').bind('$a', task);
    other.relocated.push('b');
    other.replaced.push({ from: task, to: task });
    other.renames.push({ from: 'a', to: 'flow_z' });
    other.expansions.expand('sub', false);

    const merged = new ChangeSet().create(change('a')).merge(other);

    expect(merged.created.map(({ id }) => id)).toEqual(['flow_z', 'b']);
    expect([merged.relocated, merged.notes, merged.bindings.length, merged.replaced.length, merged.warnings.length]).toEqual([['b'], ['n'], 1, 1, 1]);
    expect(merged.expansions.expansion().collapse).toContain('sub');
  });
});
