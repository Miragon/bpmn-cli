import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { ConnectOperationDefinition } from '../../../src/operations/model/ConnectOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['connects two nodes with an id and an alias', { source: 'a', target: 'b', id: 'flow', as: '$flow', ifAbsent: true }],
  ['holds name and condition of the flow under set', { source: 'a', target: 'b', set: { name: 'yes', condition: '=ok' } }],
  ['converts a default marker to the text of a key', { source: 'a', target: 'b', set: { default: true } }, undefined, { source: 'a', target: 'b', set: { default: 'true' } }],
  ['needs a target', { source: 'a' }, 'missing required key "target"'],
  ['refuses name outside set', { source: 'a', target: 'b', name: 'yes' }, 'unknown key "name"'],
  ['refuses message outside set', { source: 'a', target: 'b', message: 'Order' }, 'unknown key "message"'],
  ['refuses a default flow with a condition under set', { source: 'a', target: 'b', set: { default: true, condition: '=ok' } }, 'mutually exclusive'],
];

describe('ConnectOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new ConnectOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
