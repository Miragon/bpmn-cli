import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { SplitNodeDefinition } from '../../../src/operations/model/SplitNodeDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['holds what add holds, without a placement', { kind: 'userTask', name: 'Check', lane: 'sales', as: '$check', set: { doc: 'Four eyes' } }],
  ['refuses a placement', { kind: 'task', after: 'a' }, 'unknown key "after"'],
  ['refuses timer outside set', { kind: 'boundaryEvent:timer', timer: 'P2D' }, 'unknown key "timer"'],
  ['refuses a default flow with a condition', { kind: 'task', default: true, condition: '=ok' }, 'mutually exclusive'],
];

describe('SplitNodeDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new SplitNodeDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
