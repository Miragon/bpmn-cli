import { describe, expect, it } from 'vitest';
import { SnippetError } from '../../../src/edit/extensions/SnippetError.js';

describe('SnippetError', () => {
  it('is an error that says what is wrong with an extension snippet', () => {
    const refusal = new SnippetError('unclosed element <camunda:field>');

    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.message).toBe('unclosed element <camunda:field>');
  });
});
