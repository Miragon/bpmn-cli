import { describe, expect, it } from 'vitest';
import { FeelTokenizer } from '../../../../src/checks/camunda/feel/FeelTokenizer.js';

describe('FeelTokenizer', () => {
  it('cuts an expression into names, operators and numbers', () => {
    const tokens = new FeelTokenizer('amount >= 100').tokens();

    expect(tokens.map(({ text }) => text).filter(Boolean)).toEqual(['amount', '>=', '100']);
  });

  it('finds the closing quote past an escaped one', () => {
    expect(FeelTokenizer.closingQuote('"a\\"b" rest', '"', 1)).toBe(5);
  });
});
