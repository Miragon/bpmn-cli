import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { RetypeOperationDefinition } from '../../../src/operations/model/RetypeOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['turns an event into a message event with its keys under set', { id: 'event', kind: 'boundaryEvent:message', set: { message: 'Order' }, refAs: '$message' }],
  ['refuses an unknown kind', { id: 'task', kind: 'nope' }, 'Unknown kind'],
  ['refuses timer outside set', { id: 'event', kind: 'startEvent:timer', timer: 'P2D' }, 'unknown key "timer"'],
  ['refuses timerKind', { id: 'event', kind: 'startEvent:timer', timerKind: 'date' }, 'unknown key "timerKind"'],
];

describe('RetypeOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new RetypeOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
