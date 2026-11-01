import { describe, expect, it } from 'vitest';
import { RenderError } from '../../src/read/RenderError.js';

describe('RenderError', () => {
  it('carries the code and the element a host turns into its own error', () => {
    const error = new RenderError('E_NOT_FOUND', 'No element', 'Task_A');
    expect(error).toBeInstanceOf(Error);
    expect([error.name, error.code, error.element, error.message]).toEqual(['RenderError', 'E_NOT_FOUND', 'Task_A', 'No element']);
  });
});
