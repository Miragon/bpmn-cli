import { describe, expect, it } from 'vitest';
import { FieldValues } from '../../../src/operations/fields/FieldValues.js';
import { OperationDefinition } from '../../../src/operations/fields/OperationDefinition.js';
import { OperationField } from '../../../src/operations/fields/OperationField.js';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';

class RenameDefinition extends OperationDefinition {
  readonly name = 'rename';
  readonly description = 'Renames an element.';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Element id.'),
    title: OperationField.optional(FieldValues.text, 'The title.'),
  };
}

class TagDefinition extends OperationDefinition {
  readonly name = 'tag';
  readonly description = 'Tags an element.';
  readonly fields = {
    label: OperationField.optional(FieldValues.text, 'The label.'),
    set: OperationField.optional(FieldValues.keys, 'The keys.'),
  };
}

const LOCATION = new OperationLocation(3, 'ops[3] (rename)');

describe('OperationDefinition', () => {
  it('reads the fields it defines, without op, and drops a key that is null', () => {
    expect(new RenameDefinition().read({ op: 'rename', id: 'a', title: null }, LOCATION)).toEqual({ id: 'a' });
  });

  it.each([[1, 'number 1'], [null, 'null'], [[], 'an array']])('refuses %j as no object', (input, words) => {
    expect(() => new RenameDefinition().read(input, LOCATION)).toThrow(`ops[3] (rename): expected an object, got ${words}`);
  });

  it('refuses a missing required key with its help', () => {
    expect(() => new RenameDefinition().read({ title: 'x' }, LOCATION)).toThrow('missing required key "id" (Element id.)');
  });

  it('refuses a key it lacks, never drops it, and lists the keys it takes', () => {
    expect(() => new RenameDefinition().read({ id: 'a', titel: 'x' }, LOCATION)).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining('unknown key "titel" (did you mean "title"?); allowed keys: id, title'), details: expect.objectContaining({ candidates: ['title'] }) }));
  });

  it('shows the operation with id where a key names the element', () => {
    expect(() => new RenameDefinition().read({ element: 'a' }, LOCATION)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: 'rename names its element with "id": {"id":"a"}.', candidates: ['id'] }) }));
  });

  it('shows the operation with the value under set where it has a set', () => {
    expect(() => new TagDefinition().read({ op: 'tag', timer: 'P2D', set: { name: 'a' } }, LOCATION)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: 'What the element holds goes under "set": {"op":"tag","set":{"name":"a","timer":"P2D"}}.' }) }));
  });

  it('offers the nearest key, not set, for a typo of a key it takes', () => {
    expect(() => new TagDefinition().read({ labl: 'a' }, LOCATION)).toThrow(expect.objectContaining({ message: expect.stringContaining('unknown key "labl" (did you mean "label"?)'), details: expect.objectContaining({ hint: expect.stringContaining('`bpmn guide ops`'), candidates: ['label'] }) }));
  });

  it('gives the general hint for an object under an unknown key', () => {
    expect(() => new TagDefinition().read({ values: { name: 'a' } }, LOCATION)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: expect.stringContaining('`bpmn guide ops`') }) }));
  });
});
