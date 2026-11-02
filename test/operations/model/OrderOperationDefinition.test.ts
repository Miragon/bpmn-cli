import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { OrderOperationDefinition } from '../../../src/operations/model/OrderOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['orders the outgoing flows of a gateway', { id: 'gateway', flows: ['b', 'a'] }],
  ['orders the lanes of a pool', { id: 'pool', lanes: ['b', 'a'] }],
  ['orders the pools of a collaboration', { id: 'collaboration', pools: ['b', 'a'] }],
  ['needs one list', { id: 'gateway' }, 'give exactly one of'],
  ['refuses two lists', { id: 'gateway', flows: ['a'], lanes: ['b'] }, 'give exactly one of'],
];

describe('OrderOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new OrderOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
