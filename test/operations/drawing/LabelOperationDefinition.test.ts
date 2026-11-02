import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { LabelOperationDefinition } from '../../../src/operations/drawing/LabelOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['puts a label above its element', { id: 'gateway', side: 'above' }],
  ['needs a side', { id: 'gateway' }, 'missing required key "side"'],
  ['refuses a side a label cannot take', { id: 'gateway', side: 'top' }, '"side" must be one of "above"'],
];

describe('LabelOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new LabelOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
