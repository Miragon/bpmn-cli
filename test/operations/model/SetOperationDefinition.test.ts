import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { SetOperationDefinition } from '../../../src/operations/model/SetOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['sets keys and removes one with an empty value', { id: 'task', set: { name: 'Check', doc: '' } }],
  ['names the message it references', { id: 'event', set: { message: 'Order' }, refAs: '$message' }],
  ['needs set', { id: 'task' }, 'missing required key "set"'],
  ['refuses an empty set', { id: 'task', set: {} }, 'nothing to do'],
  ['refuses values, which became set', { id: 'task', values: { name: 'Check' } }, 'unknown key "values"'],
  ['refuses unset, which is an empty value', { id: 'task', set: { name: 'a' }, unset: ['doc'] }, 'unknown key "unset"'],
  ['refuses a key at the top level and shows it under set', { id: 'task', name: 'Check' }, 'unknown key "name" (did you mean "set"?)'],
  ['refuses elementId and asks for id', { elementId: 'task', set: { name: 'Check' } }, 'unknown key "elementId" (did you mean "id"?)'],
];

describe('SetOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new SetOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
