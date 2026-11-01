import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { RouteOperationDefinition } from '../../../src/operations/drawing/RouteOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['routes a flow out of the top into the left', { id: 'flow', exit: 'top', entry: 'left' }],
  ['needs the flow as id', {}, 'missing required key "id"'],
  ['refuses flowId and asks for id', { flowId: 'flow' }, 'unknown key "flowId" (did you mean "id"?)'],
  ['refuses a side that does not exist', { id: 'flow', exit: 'up' }, '"exit" must be one of "right"'],
];

describe('RouteOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new RouteOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
