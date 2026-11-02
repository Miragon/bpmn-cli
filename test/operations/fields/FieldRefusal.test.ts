import { describe, expect, it } from 'vitest';
import type * as z from 'zod/mini';
import type { BpmnError } from '../../../src/model/index.js';
import { FieldRefusal } from '../../../src/operations/fields/FieldRefusal.js';
import { FieldValues } from '../../../src/operations/fields/FieldValues.js';
import { OperationField } from '../../../src/operations/fields/OperationField.js';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';

function refusalOf(field: OperationField, key: string, input: unknown): BpmnError {
  try {
    field.read(key, input, new OperationLocation(0, 'ops[0]'));
  } catch (error) {
    return error as BpmnError;
  }
  throw new Error('expected a refusal');
}

describe('FieldRefusal', () => {
  it.each([
    [null, 'null'],
    [[1], 'an array'],
    [{ a: 1 }, 'an object'],
    ['text', 'string "text"'],
    [1, 'number 1'],
  ])('describes %j as %s', (input, words) => {
    expect(FieldRefusal.describe(input)).toBe(words);
  });

  it.each<[z.ZodMiniType, string, unknown, string, string | undefined]>([
    [FieldValues.text, 'name', 1, '"name" must be a string, got number 1', 'Write it as a JSON string, e.g. "name": "...".'],
    [FieldValues.flag, 'ifAbsent', 'true', '"ifAbsent" must be a boolean, got string "true"', 'Use the JSON literal true, not the string "true".'],
    [FieldValues.flag, 'ifAbsent', 1, '"ifAbsent" must be a boolean, got number 1', 'Write "ifAbsent": true or false.'],
    [FieldValues.references(1), 'ids', 'a', '"ids" must be an array, got string "a"', 'Write "ids" as a JSON array, e.g. "ids": [...].'],
    [FieldValues.keys, 'set', [], '"set" must be an object of key/value pairs, got an array', 'Write "set": {"name": "..."}.'],
    [FieldValues.alias, 'as', 'check', '"as" must be an alias like "$check" ($ and a letter, then letters, digits, _ or -), got string "check"', 'Example: "as": "$check", then "after": "$check" in a later op.'],
    [FieldValues.reference, 'after', ' ', '"after" must not be empty, got string " "', undefined],
  ])('names the field and how to write it', (schema, key, input, message, hint) => {
    const refusal = refusalOf(OperationField.optional(schema, 'help'), key, input);
    expect(refusal.message).toBe(`ops[0]: ${message}`);
    expect(refusal.details.hint).toBe(hint);
  });

  it.each<[z.ZodMiniType, string, unknown, string]>([
    [FieldValues.references(1), 'ids', ['a', 1], '"ids[1]" must be a string, got number 1'],
    [FieldValues.keys, 'set', { name: null }, '"set.name" must be a string (numbers and booleans are converted); "" removes a property, got null'],
    [FieldValues.keys, 'set', { ' ': 'x' }, '"set. " contains an empty key'],
  ])('points into a list and into the keys', (schema, key, input, message) => {
    expect(refusalOf(OperationField.optional(schema, 'help'), key, input).message).toContain(message);
  });
});
