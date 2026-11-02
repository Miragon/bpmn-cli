import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { ExtOperationDefinition } from '../../../src/operations/model/ExtOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['adds an extension element with its attributes and body', { id: 'task', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'check', retries: '3' }, body: 'text', replace: true }],
  ['adds a raw snippet', { id: 'task', action: 'add', xml: '<zeebe:header />', slot: 'loop' }],
  ['removes by type', { id: 'task', action: 'remove', type: 'zeebe:taskDefinition' }],
  ['removes by index', { id: 'task', action: 'remove', index: 0 }],
  ['needs a known action', { id: 'task', action: 'edit' }, '"action" must be one of "add", "remove"'],
  ['needs a type or a snippet to add', { id: 'task', action: 'add' }, 'ext add needs "type"'],
  ['refuses an index on add', { id: 'task', action: 'add', type: 'a', index: 1 }, '"index" only applies to action "remove"'],
  ['refuses a snippet with attributes', { id: 'task', action: 'add', xml: '<a />', attrs: { a: 'b' } }, '"xml" cannot be combined'],
  ['refuses add keys on remove', { id: 'task', action: 'remove', type: 'a', body: 'b' }, '"body" only apply to action "add"'],
  ['refuses type and index together', { id: 'task', action: 'remove', type: 'a', index: 1 }, 'exactly one of "type" or "index"'],
  ['refuses a negative index', { id: 'task', action: 'remove', index: -1 }, '"index" must be a non-negative integer'],
];

describe('ExtOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new ExtOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
