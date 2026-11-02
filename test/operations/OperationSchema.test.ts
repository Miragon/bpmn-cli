import { describe, expect, it } from 'vitest';
import { OperationCatalog } from '../../src/operations/OperationCatalog.js';
import { OPS_SCHEMA } from '../../src/operations/OperationSchema.js';

interface Entry {
  title?: string;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
  allOf?: unknown[];
}

const FLAGS: [string, string[], number][] = [
  ['add', ['kind', 'name', 'set'], 17],
  ['move', ['ids'], 6],
  ['remove', ['ids'], 3],
  ['connect', ['source', 'target', 'set'], 2],
  ['place', ['ids'], 9],
  ['color', ['ids'], 3],
  ['space', [], 3],
  ['route', ['id'], 2],
  ['label', ['id'], 1],
];

const schema = OPS_SCHEMA as { $defs: Record<string, Entry & { oneOf: { $ref: string }[] }> };
const entryOf = (name: string): Entry => schema.$defs[name]!;
const namesIn = (union: string): string[] => schema.$defs[union]!.oneOf.map(({ $ref }) => $ref.split('/').at(-1)!);

describe('OperationSchema', () => {
  it('lists the 17 operations in the order of the catalogue', () => {
    expect(namesIn('op')).toEqual(OperationCatalog.names());
  });

  it('closes every entry and names its operation', () => {
    for (const definition of OperationCatalog.ALL) {
      expect(entryOf(definition.name)).toMatchObject({ title: definition.name, additionalProperties: false });
      expect(entryOf(definition.name).properties['op']).toEqual({ const: definition.name });
    }
  });

  it('describes the nested branch and node without op, and points split at them', () => {
    expect(entryOf('branch').required).toEqual(['nodes']);
    expect(entryOf('node').properties).not.toHaveProperty('op');
    expect(entryOf('split').properties['branches']).toMatchObject({ type: 'array', items: { $ref: '#/$defs/branch' } });
    expect(entryOf('branch').properties['nodes']).toMatchObject({ items: { $ref: '#/$defs/node' } });
  });

  it.each(FLAGS)('leaves the flags of the plan on %s once positionals, set and batch-only fields are out', (name, positionals, flags) => {
    const fields = Object.entries(entryOf(name).properties).filter(([key, field]) => key !== 'op' && !positionals.includes(key) && field['x-batch-only'] !== true);
    expect(fields).toHaveLength(flags);
  });

  it('carries the rules of an operation as allOf', () => {
    expect(entryOf('add').allOf).toHaveLength(11);
    expect(entryOf('label').allOf).toBeUndefined();
  });
});
