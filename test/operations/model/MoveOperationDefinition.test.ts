import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { MoveOperationDefinition } from '../../../src/operations/model/MoveOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['moves nodes behind an anchor', { ids: ['a'], after: 'b' }],
  ['moves a node between lanes and out of a lane with an empty name', { ids: ['a'], lane: '' }],
  ['needs a place or a lane', { ids: ['a'] }, 'nothing to do'],
  ['refuses two places', { ids: ['a'], in: 'b', flow: 'c' }, '"flow" and "in" cannot be combined'],
  ['refuses flow fields, which set does after the move', { ids: ['a'], after: 'b', flowName: 'yes' }, 'unknown key "flowName"'],
];

describe('MoveOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new MoveOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
