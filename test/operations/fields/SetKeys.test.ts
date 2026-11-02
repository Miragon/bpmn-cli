import { describe, expect, it } from 'vitest';
import { SetKeys } from '../../../src/operations/fields/SetKeys.js';

describe('SetKeys', () => {
  it.each([
    ['boundaryEvent:timer', 'timer'],
    ['receiveTask', 'instantiate'],
    ['callActivity', 'calledElement'],
    ['userTask', 'camunda:assignee'],
  ])('takes what set takes on a %s: %s', (kind, key) => {
    expect(SetKeys.ofKind(kind).takes(key)).toBe(true);
  });

  it.each([
    ['userTask', 'timer'],
    ['userTask', 'nam'],
    ['task', 'instantiate'],
  ])('refuses on a %s what set does not take there: %s', (kind, key) => {
    expect(SetKeys.ofKind(kind).takes(key)).toBe(false);
  });

  it.each([undefined, 'nope'])('takes what set takes on any element when the kind is %s', (kind) => {
    const keys = SetKeys.ofKind(kind);

    expect([keys.takes('timer'), keys.takes('condition'), keys.takes('instantiate'), keys.takes('sourc')]).toEqual([true, true, true, false]);
  });
});
