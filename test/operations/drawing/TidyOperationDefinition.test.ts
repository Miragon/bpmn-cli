import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { TidyOperationDefinition } from '../../../src/operations/drawing/TidyOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['tidies the whole drawing', {}],
  ['tidies some shapes', { ids: ['a'] }],
  ['refuses path', { path: ['a', 'b'] }, 'unknown key "path"'],
  ['refuses via', { via: ['a'] }, 'unknown key "via"'],
  ['refuses kind', { kind: 'task' }, 'unknown key "kind"'],
  ['refuses branch', { branch: 'a' }, 'unknown key "branch"'],
];

describe('TidyOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new TidyOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
