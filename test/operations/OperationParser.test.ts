import { describe, expect, it } from 'vitest';
import { OperationParser } from '../../src/operations/OperationParser.js';

const TIDY = { op: 'tidy' };
const ADD = { op: 'add', kind: 'userTask', after: 'start' };

const parse = (input: unknown) => new OperationParser().parse(input);

describe('OperationParser', () => {
  it.each([
    ['a list', [ADD, TIDY]],
    ['an object with ops', { ops: [ADD, TIDY] }],
    ['an object with ops and $schema', { $schema: 'x', ops: [ADD, TIDY] }],
    ['JSON text of a list', JSON.stringify([ADD, TIDY])],
    ['JSON text of an object', JSON.stringify({ ops: [ADD, TIDY] })],
  ])('reads %s and splits it into model and drawing operations', (_form, input) => {
    expect(parse(input)).toEqual({ model: [ADD], drawing: [TIDY] });
  });

  it.each([
    ['text that is no JSON', '{oops', 'Ops are not valid JSON'],
    ['a number', 1, 'Expected an array of ops or an object {"ops": [...]}, got number 1'],
    ['null', null, 'got null'],
    ['an object without ops', {}, 'Expected an array of ops'],
    ['another top-level key', { ops: [TIDY], layout: true }, 'Unknown top-level key "layout"'],
    ['two other top-level keys', { ops: [TIDY], a: 1, b: 2 }, 'Unknown top-level keys "a", "b"'],
    ['an empty list', [], 'The ops list is empty'],
    ['an entry that is no object', ['add'], 'ops[0]: expected an op object, got string "add"'],
    ['an entry without op', [{ kind: 'task' }], 'ops[0]: missing "op"; one of: add, connect'],
    ['an op that is no text', [{ op: 1 }], 'ops[0]: unknown op 1;'],
    ['a misspelt op', [{ op: 'colour' }], 'ops[0]: unknown op "colour" (did you mean "color"?)'],
    ['the retired align', [{ op: 'align', ids: ['a', 'b'], axis: 'row' }], 'ops[0]: unknown op "align"'],
    ['an old key on add', [{ op: 'add', kind: 'boundaryEvent:timer', on: 'a', timer: 'P2D' }], 'ops[0] (add): unknown key "timer"'],
  ])('refuses %s with E_USAGE', (_form, input, message) => {
    expect(() => parse(input)).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(message) }));
  });

  it('refuses a model operation after a drawing operation and asks for two batches', () => {
    expect(() => parse([TIDY, ADD])).toThrow(expect.objectContaining({ code: 'E_USAGE', message: 'ops[1] (add): a model operation cannot follow the drawing operation ops[0] (tidy) in one batch', details: { op: 1, hint: 'Send two batches: the model operations first, then the drawing operations.' } }));
  });

  it('refuses the order of a batch before its aliases', () => {
    expect(() => parse([{ op: 'color', ids: ['$a'], color: 'red' }, { ...ADD, as: '$a' }])).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
  });

  it('checks the aliases of the whole batch before anything runs', () => {
    expect(() => parse([{ op: 'color', ids: ['$a'], color: 'red' }])).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_ALIAS' }));
  });
});
