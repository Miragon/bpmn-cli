import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { RemoveOperationDefinition } from '../../../src/operations/model/RemoveOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['removes several elements and tells how the gap closes', { ids: ['a', 'b'], bridge: 'none', withBranch: true, ifExists: true }],
  ['bridges every predecessor of a join', { ids: ['a'], bridge: 'all' }],
  ['needs at least one id', { ids: [] }, '"ids" needs at least 1 entry'],
  ['refuses the old bridge flag', { ids: ['a'], bridge: false }, '"bridge" must be one of "none", "all"'],
  ['refuses bridgeAll', { ids: ['a'], bridgeAll: true }, 'unknown key "bridgeAll"'],
];

describe('RemoveOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new RemoveOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
