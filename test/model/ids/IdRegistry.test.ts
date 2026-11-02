import { describe, expect, it } from 'vitest';
import { IdRegistry } from '../../../src/model/ids/IdRegistry.js';

describe('IdRegistry', () => {
  it('knows the ids it was given and the ids claimed later, until they are released', () => {
    const registry = new IdRegistry(['task_a']);

    registry.claim('task_b');
    registry.release('task_a');

    expect([registry.has('task_a'), registry.has('task_b')]).toEqual([false, true]);
    expect([...registry.values()]).toEqual(['task_b']);
  });

  it('starts empty without ids to begin with', () => {
    expect([...new IdRegistry().values()]).toEqual([]);
  });

  it.each([
    ['serviceTask_a', true],
    ['userTask_a', true],
    ['task_a', true],
    ['gateway_b', false],
    ['q_c', false],
    ['noUnderscore', false],
  ])('judges the body of "%s" taken under another prefix: %s', (id, taken) => {
    const registry = new IdRegistry(['task_a', 'userTask_a', 'x', 'a_b_c']);

    expect(registry.bodyTaken(id)).toBe(taken);
  });
});
