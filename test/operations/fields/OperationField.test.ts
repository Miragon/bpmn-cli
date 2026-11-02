import { describe, expect, it } from 'vitest';
import { FieldValues } from '../../../src/operations/fields/FieldValues.js';
import { OperationField } from '../../../src/operations/fields/OperationField.js';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { SplitBranchDefinition } from '../../../src/operations/model/SplitBranchDefinition.js';

const LOCATION = new OperationLocation(0, 'ops[0]');

describe('OperationField', () => {
  it('reads a value through its schema', () => {
    expect(OperationField.optional(FieldValues.keys, 'help').read('set', { retries: 3 }, LOCATION)).toEqual({ retries: '3' });
  });

  it('reads the items of a nested list through their definition', () => {
    const branches = OperationField.items(new SplitBranchDefinition(), 1, 'help');
    expect(branches.read('branches', [{ nodes: [] }], LOCATION)).toEqual([{ nodes: [] }]);
    expect(() => branches.read('branches', [{}], LOCATION)).toThrow('ops[0].branches[0]: missing required key "nodes"');
  });

  it('writes its help as the description of its schema', () => {
    expect(OperationField.required(FieldValues.flag, 'yes or no').jsonSchema()).toEqual({ type: 'boolean', description: 'yes or no' });
  });

  it('writes a nested list as a reference to its item', () => {
    expect(OperationField.items(new SplitBranchDefinition(), 1, 'help').jsonSchema()).toEqual({ type: 'array', minItems: 1, items: { $ref: '#/$defs/branch' }, description: 'help' });
  });

  it('marks what only a batch takes, so that no flag comes of it', () => {
    expect(OperationField.alias('help').jsonSchema()['x-batch-only']).toBe(true);
    expect(OperationField.batchOnly(FieldValues.index, 'help').jsonSchema()['x-batch-only']).toBe(true);
    expect(OperationField.optional(FieldValues.text, 'help').jsonSchema()).not.toHaveProperty('x-batch-only');
  });

  it('defines an alias and tells how later operations use it', () => {
    const alias = OperationField.alias('The alias.');
    expect(alias.traits.definesAlias).toBe(true);
    expect(alias.help).toContain('Later ops of the batch use it');
  });
});
