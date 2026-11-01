import { describe, expect, it } from 'vitest';
import { FeelError } from '../../../../src/checks/camunda/feel/FeelError.js';
import { FeelParser } from '../../../../src/checks/camunda/feel/FeelParser.js';

describe('FeelParser', () => {
  it.each(['a + b * 2', 'if a then b else c', 'for x in xs return x', 'some x in xs satisfies x > 1', 'a in [1..3]'])('reads %s', (expression) => {
    expect(() => new FeelParser(expression).run()).not.toThrow();
  });

  it('refuses an operator without its right side', () => {
    expect(() => new FeelParser('a +').run()).toThrow(FeelError);
  });
});
