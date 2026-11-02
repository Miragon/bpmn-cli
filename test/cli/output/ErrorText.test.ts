import { describe, expect, it } from 'vitest';
import { ErrorText } from '../../../src/cli/output/ErrorText.js';

const textOf = (details: object) => new ErrorText({ code: 'E_X', message: 'went wrong', details } as never).text();

describe('ErrorText', () => {
  it('prints the code and the message', () => {
    expect(textOf({})).toBe('error E_X: went wrong');
  });

  it('prints each detail on a line of its own', () => {
    const text = textOf({ element: 'a', related: ['b'], candidates: ['c', 'd'], errors: [{ code: 'E_Y', element: 'e', message: 'm', hint: 'h', validator: 'v' }, { code: 'E_Z', message: 'n' }], warnings: ['w'], op: 2, hint: 'do this' });

    expect(text.split('\n').slice(1)).toEqual(['  element: a', '  related: b', '  candidates: c, d', '  [v] E_Y e: m  (h)', '  E_Z: n', '  w', '  op: #2', '  hint: do this']);
  });
});
