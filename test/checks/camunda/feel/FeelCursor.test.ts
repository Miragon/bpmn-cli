import { describe, expect, it } from 'vitest';
import { FeelCursor } from '../../../../src/checks/camunda/feel/FeelCursor.js';
import { FeelError } from '../../../../src/checks/camunda/feel/FeelError.js';

describe('FeelCursor', () => {
  const cursorOver = (expression: string) => new FeelCursor(expression);

  it('reads the tokens in order and takes an expected operator', () => {
    const cursor = cursorOver('( a )');

    expect(cursor.eatOp('(')).toBe(true);
    expect(cursor.isWord('a')).toBe(true);
    expect(cursor.next().text).toBe('a');
    expect(cursor.isOp(')')).toBe(true);
  });

  it('refuses a keyword that is missing', () => {
    expect(() => cursorOver('x').expectKw('then', 'then')).toThrow(FeelError);
  });

  it('falls back when the first reading fails', () => {
    const cursor = cursorOver('a');
    const read: string[] = [];

    cursor.either(() => cursor.expectOp('('), () => read.push(cursor.next().text));

    expect(read).toEqual(['a']);
  });
});
