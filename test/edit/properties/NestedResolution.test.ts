import { describe, expect, it } from 'vitest';
import { NestedResolution } from '../../../src/edit/properties/NestedResolution.js';
import { Fixtures } from '../../support/Fixtures.js';

type Ref = ConstructorParameters<typeof NestedResolution>[1];

async function resolve(id: string, ref: Ref, example?: (prefix: string) => string) {
  const document = await Fixtures.readForWrite('edit/properties-nested.bpmn');
  return new NestedResolution(document.tree.require(id), ref, `${ref.text}.name`, example).resolve();
}

describe('NestedResolution', () => {
  it('finds the only event definition of an event', async () => {
    expect((await resolve('throw_link', { slot: 'definition', text: 'definition' }))?.id).toBe('link_out');
  });

  it('finds nothing on an event without a trigger', async () => {
    expect(await resolve('throw_none', { slot: 'definition', text: 'definition' })).toBeUndefined();
  });

  it('finds the condition of a flow', async () => {
    expect((await resolve('flow_juel', { slot: 'condition', text: 'condition' }))?.is('bpmn:FormalExpression')).toBe(true);
  });

  it('finds a definition by its position and by its trigger', async () => {
    expect((await resolve('end_mixed', { slot: 'definition', text: 'definition[1]', index: 1 }))?.id).toBe('signal_mixed');
    expect((await resolve('end_mixed', { slot: 'definition', text: 'definition[message]', trigger: 'message' }))?.id).toBe('message_mixed');
  });

  it('refuses to guess between two definitions and names them with both selectors', async () => {
    await expect(resolve('end_mixed', { slot: 'definition', text: 'definition' })).rejects.toMatchObject({
      code: 'E_AMBIGUOUS_NESTED',
      message: expect.stringContaining('definition[0] = '),
      details: { candidates: ['definition[0]', 'definition[1]'], hint: expect.stringContaining("bpmn set <file> end_mixed 'definition[signal].name=<value>'") },
    });
  });

  it('refuses two definitions of the selected trigger, without a trigger to suggest', async () => {
    await expect(resolve('catch_timers', { slot: 'definition', text: 'definition[timer]', trigger: 'timer' })).rejects.toMatchObject({
      code: 'E_AMBIGUOUS_NESTED',
      message: expect.stringContaining('2 timer event definitions'),
      details: { hint: expect.not.stringContaining('definition[timer]') },
    });
  });

  it('shows the command its caller names in the hint', async () => {
    await expect(resolve('end_mixed', { slot: 'definition', text: 'definition' }, (prefix) => `bpmn ext add ${prefix}`)).rejects.toMatchObject({ details: { hint: expect.stringContaining('bpmn ext add definition[1]') } });
  });

  it('refuses a position past the last definition and lists them', async () => {
    await expect(resolve('end_mixed', { slot: 'definition', text: 'definition[5]', index: 5 })).rejects.toMatchObject({ code: 'E_NO_NESTED_ELEMENT', details: { hint: expect.stringContaining('Its event definitions:') } });
  });

  it('refuses a selector on an event without a trigger and says how to give it one', async () => {
    await expect(resolve('throw_none', { slot: 'definition', text: 'definition[0]', index: 0 })).rejects.toMatchObject({ code: 'E_NO_NESTED_ELEMENT', details: { hint: expect.stringContaining('trigger=<trigger>') } });
  });

  it.each<[string, Ref]>([
    ['a position', { slot: 'loop', text: 'loop[0]', index: 0 }],
    ['a trigger', { slot: 'condition', text: 'condition[timer]', trigger: 'timer' }],
    ['a selector it cannot read', { slot: 'loop', text: 'loop[x]', invalid: 'x' }],
  ])('refuses %s on anything but a definition', async (_case, ref) => {
    await expect(resolve('task_multi', ref)).rejects.toMatchObject({ code: 'E_UNKNOWN_KEY', message: expect.stringContaining('only definition. takes a selector') });
  });

  it('refuses a selector that is neither a position nor a trigger', async () => {
    await expect(resolve('end_mixed', { slot: 'definition', text: 'definition[x]', invalid: 'x' })).rejects.toMatchObject({ code: 'E_UNKNOWN_KEY', message: expect.stringContaining('"x" in definition[x]') });
  });
});
