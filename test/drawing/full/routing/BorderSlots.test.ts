import { describe, expect, it } from 'vitest';
import { BorderSlots } from '../../../../src/drawing/full/routing/BorderSlots.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('BorderSlots', () => {
  const sketch = new ScopeSketch().node('gateway', 'join', 0, 0).node('task', 'task', 100, 0);

  it('holds a slot of a task for entries and exits alike', () => {
    const slots = new BorderSlots();
    slots.take(sketch.at('task'), 50, false);

    expect(slots.taken(sketch.at('task'), 50.5)).toBe(true);
    expect(slots.taken(sketch.at('task'), 50, true)).toBe(true);
    expect(slots.taken(sketch.at('task'), 60)).toBe(false);
  });

  it('lets the entries of a join share its vertex, but not with an exit', () => {
    const slots = new BorderSlots();
    slots.take(sketch.at('join'), 25, false);
    expect(slots.taken(sketch.at('join'), 25, true)).toBe(false);

    slots.take(sketch.at('join'), 25, true);

    expect(slots.taken(sketch.at('join'), 25, true)).toBe(true);
  });
});
