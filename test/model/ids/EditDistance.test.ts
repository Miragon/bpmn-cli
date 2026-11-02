import { describe, expect, it } from 'vitest';
import { EditDistance } from '../../../src/model/ids/EditDistance.js';

describe('EditDistance', () => {
  it('counts a swap of two neighbours as two edits for levenshtein and as one when transposing', () => {
    expect(EditDistance.levenshtein('kitten', 'sitting')).toBe(3);
    expect(EditDistance.levenshtein('', 'abc')).toBe(3);
    expect(EditDistance.levenshtein('ab', 'ba')).toBe(2);
    expect(EditDistance.transposing('ab', 'ba')).toBe(1);
  });

  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [11, 1],
    [12, 2],
  ])('tolerates a typo of %i characters by %i edits', (length, tolerance) => {
    expect(EditDistance.typoTolerance(length)).toBe(tolerance);
  });

  it.each([
    ['USER_TASK', 'userTask'],
    ['user', 'userTask'],
    ['servicetaks', 'serviceTask'],
    ['statr', 'start'],
    ['usr', undefined],
    ['zzzzzz', undefined],
  ])('answers "%s" with the closest allowed key %j', (key, closest) => {
    expect(EditDistance.closestKey(key, ['start', 'userTask', 'serviceTask', 'end'])).toBe(closest);
  });
});
