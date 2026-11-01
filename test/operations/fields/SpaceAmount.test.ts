import { describe, expect, it } from 'vitest';
import { SpaceAmount } from '../../../src/operations/fields/SpaceAmount.js';

describe('SpaceAmount', () => {
  it.each([
    ['2col', { count: 2, unit: 'column' }],
    ['2 columns', { count: 2, unit: 'column' }],
    ['column', { count: 1, unit: 'column' }],
    ['-2col', { count: -2, unit: 'column' }],
    ['3rows', { count: 3, unit: 'row' }],
    ['-row', { count: -1, unit: 'row' }],
    ['80px', { count: 80, unit: 'px' }],
    [80, { count: 80, unit: 'px' }],
    ['12', { count: 12, unit: 'px' }],
  ])('reads %s as a distance', (value, amount) => {
    expect(SpaceAmount.parse(value)).toEqual(amount);
  });

  it.each(['0', 0, '2x', 'px', '', 'lots', 1.5, null])('reads %s as no distance', (value) => {
    expect(SpaceAmount.parse(value)).toBeUndefined();
  });
});
