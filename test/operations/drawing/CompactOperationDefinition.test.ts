import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { CompactOperationDefinition } from '../../../src/operations/drawing/CompactOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['compacts the whole drawing', {}],
  ['compacts one frame', { ids: ['pool'] }],
  ['refuses an empty list', { ids: [] }, '"ids" needs at least 1 entry'],
];

describe('CompactOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new CompactOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
