import { describe, expect, it } from 'vitest';
import { XIndex } from '../../../../src/drawing/full/scopes/XIndex.js';

describe('XIndex', () => {
  it('returns every item in the range once, however many buckets it spans', () => {
    const index = new XIndex<string>();
    index.add('wide', 0, 1000);
    index.add('narrow', 10, 20);
    index.add('far', 5000, 5010);

    expect(index.near(0, 300).sort()).toEqual(['narrow', 'wide']);
    expect(index.size).toBe(3);
  });

  it('stops at the first visit that says so', () => {
    const index = new XIndex<number>();
    [1, 2, 3].forEach((item) => index.add(item, 0, 10));
    const seen: number[] = [];

    expect(index.each(0, 10, (item) => {
      seen.push(item);
      return item === 2;
    })).toBe(true);
    expect(seen).toEqual([1, 2]);
    expect(index.each(0, 10, () => false)).toBe(false);
  });

  it('skips the items before an id', () => {
    const index = new XIndex<string>();
    index.add('first', 0, 10);
    index.add('second', 0, 10);
    const seen: string[] = [];

    index.each(0, 10, (item) => {
      seen.push(item);
    }, 1);

    expect(seen).toEqual(['second']);
  });

  it('treats a range wider than its columns as everywhere', () => {
    const index = new XIndex<string>();
    index.add('huge', -1e9, 1e9);
    index.add('small', 0, 10);

    expect(index.near(500, 510)).toEqual(['huge']);
    expect(index.near(-1e9, 1e9).sort()).toEqual(['huge', 'small']);
  });
});
