import { describe, expect, it } from 'vitest';
import { ImageText } from '../../../src/cli/output/ImageText.js';

const IMAGE = { svg: '', width: 7840, height: 100, scale: 0.746, plane: 'p', drawn: ['a'], notes: [], badges: [] };

const textOf = (image: object, options: object = {}) => new ImageText({ ...IMAGE, ...image } as never, 'a.png').lines(options);

describe('ImageText', () => {
  it('counts the image tokens of a size', () => {
    expect(ImageText.tokensOf({ width: 784, height: 2 })).toBe(2);
    expect(ImageText.tokensOf({ width: 785, height: 2 })).toBe(3);
  });

  it('says what it wrote', () => {
    expect(textOf({})).toEqual(['wrote a.png  7840x100 px  ~1,000 image tokens  scale 0.74  plane p']);
    expect(new ImageText({ ...IMAGE, plane: undefined } as never, '-').lines({})[0]).toContain('wrote <stdout>');
  });

  it('says the crop and the depth it used', () => {
    expect(textOf({ depth: 1 }, { around: 'a' })[1]).toBe('crop: around a (depth 1): 1 element');
    expect(textOf({ drawn: ['a', 'b'] }, { path: ['a', 'b'] })[1]).toBe('crop: path a -> b: 2 elements');
    expect(textOf({}, { ids: ['a', 'b'] })[1]).toBe('crop: 2 ids: 1 element');
  });

  it('lists the problems and tells which are not in the image', () => {
    expect(textOf({ problems: [{ n: 1, kind: 'overlaps', ids: ['a', 'b'], detail: 'x', drawn: false }, { n: 2, kind: 'crossings', ids: ['c'], drawn: true }] }, { problems: true }).slice(1)).toEqual(['problems (numbered in the image):', '  1 overlaps [a, b] x  (not in the image)', '  2 crossings [c]']);
  });

  it('turns the notes of the painter into words', () => {
    const kinds = ['no-diagram', 'undrawn', 'broken-coordinates', 'broken-labels', 'empty-plane', 'fit-on-other-plane', 'fit-not-drawn'];
    const lines = textOf({ notes: kinds.map((kind) => ({ kind, ids: ['a'] })) });

    expect(lines.slice(1).every((line) => line.startsWith('note: '))).toBe(true);
    expect(lines).toHaveLength(8);
  });
});
