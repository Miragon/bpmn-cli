import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { SpaceOperationDefinition } from '../../../src/operations/drawing/SpaceOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['makes two columns of room', { after: 'a', by: '2col' }],
  ['closes pixels with a negative amount', { below: 'a', by: -80 }],
  ['reads a number in a string as pixels', { after: 'a', by: '-40' }, undefined, { after: 'a', by: -40 }],
  ['reads rows in capitals and pixels with leading zeros', { after: 'a', by: '05PX' }],
  ['needs a place', { by: 'row' }, 'give "after"'],
  ['refuses both places', { after: 'a', below: 'b' }, '"after" and "below" cannot be combined'],
  ['refuses an amount it cannot read', { after: 'a', by: '2x' }, '"by" must be "column", "row"'],
  ['refuses zero', { after: 'a', by: 0 }, '"by" must be "column", "row"'],
];

describe('SpaceOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new SpaceOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
