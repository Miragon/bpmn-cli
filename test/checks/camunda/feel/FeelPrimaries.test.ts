import { describe, expect, it } from 'vitest';
import { FeelCursor } from '../../../../src/checks/camunda/feel/FeelCursor.js';
import { FeelPrimaries } from '../../../../src/checks/camunda/feel/FeelPrimaries.js';

describe('FeelPrimaries', () => {
  const primariesOver = (expression: string) => {
    const cursor = new FeelCursor(expression);
    return Object.assign(new FeelPrimaries(cursor, () => cursor.next()), { cursor });
  };

  it('takes a literal off the expression', () => {
    const primaries = primariesOver('1');
    primaries.primary();

    expect(primaries.cursor.peek().kind).toBe('end');
  });

  it('reads a type name of several words', () => {
    expect(() => primariesOver('years and months duration').typeName()).not.toThrow();
  });

  it('asks for a name where none is', () => {
    expect(() => primariesOver('1').expectName('a name')).toThrow('a name');
  });
});
