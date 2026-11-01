import { describe, expect, it } from 'vitest';
import { FeelError } from '../../../../src/checks/camunda/feel/FeelError.js';

describe('FeelError', () => {
  it('is an error that says what is wrong in the expression', () => {
    const error = new FeelError(3, 'an unclosed (');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('an unclosed (');
    expect(error.at).toBe(3);
  });
});
