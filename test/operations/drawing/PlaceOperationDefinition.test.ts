import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { PlaceOperationDefinition } from '../../../src/operations/drawing/PlaceOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['moves shapes onto a row and a column', { ids: ['a', 'b'], rowOf: 'c', columnOf: 'd' }],
  ['moves a branch below an element', { branch: 'flow', below: 'c' }],
  ['moves a path behind an element', { path: ['a', 'b'], after: 'c' }],
  ['moves a boundary event to the other side of its host', { ids: ['event'], side: 'top' }],
  ['needs something to move', { rowOf: 'c' }, 'give "ids" and / or a selector'],
  ['needs a target', { ids: ['a'] }, 'nothing to do'],
  ['refuses two row keys', { ids: ['a'], rowOf: 'c', below: 'd' }, '"rowOf" and "below" cannot be combined'],
  ['refuses a path of three ids', { path: ['a', 'b', 'c'], rowOf: 'd' }, '"path" takes exactly two ids'],
  ['refuses a side with a row', { ids: ['a'], side: 'top', rowOf: 'b' }, 'it cannot be combined with "rowOf"'],
  ['refuses a side for two shapes', { ids: ['a', 'b'], side: 'top' }, '"side" takes exactly one id'],
  ['refuses a side for a branch', { branch: 'flow', side: 'bottom' }, '"side" takes exactly one id'],
  ['refuses a side a boundary event cannot take', { ids: ['a'], side: 'left' }, '"side" must be one of "top", "bottom"'],
  ['refuses via', { path: ['a', 'b'], via: ['flow'], rowOf: 'c' }, 'unknown key "via"'],
  ['refuses kind', { kind: 'endEvent', rowOf: 'c' }, 'unknown key "kind"'],
];

describe('PlaceOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new PlaceOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});
