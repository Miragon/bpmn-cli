import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { ColorOperationDefinition } from '../../../src/operations/drawing/ColorOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['colours shapes', { ids: ['a'], color: 'red' }],
  ['colours a path', { path: ['a', 'b'], color: 'green' }],
  ['needs a colour', { ids: ['a'] }, 'missing required key "color"'],
  ['needs something to colour', { color: 'red' }, 'give "ids" and / or a selector'],
  ['refuses a colour the picker lacks', { ids: ['a'], color: 'pink' }, '"color" must be one of "blue"'],
  ['refuses kind', { kind: 'endEvent', color: 'red' }, 'unknown key "kind"'],
];

describe('ColorOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new ColorOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
