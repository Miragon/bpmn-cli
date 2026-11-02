import { describe, expect, it } from 'vitest';
import { OperationCatalog } from '../../src/operations/OperationCatalog.js';
import { OPS_SCHEMA } from '../../src/operations/OperationSchema.js';
import { Fixtures } from '../support/Fixtures.js';

interface Read {
  read: 'read' | 'keys';
  path: string[];
  keys?: string[];
  value?: string;
}

interface Entry {
  title?: string;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
  allOf?: unknown[];
}

const TRIGGER_KEYS = ['timer', 'message', 'error', 'errorCode', 'signal', 'escalation', 'escalationCode', 'when', 'link', 'nonInterrupting'];
const GONE_FROM: Record<string, string[]> = {
  add: [...TRIGGER_KEYS, 'timerKind', 'doc', 'text', 'collapsed'],
  retype: [...TRIGGER_KEYS, 'timerKind'],
  connect: ['name', 'condition', 'language', 'default', 'message'],
  set: ['values', 'unset'],
  remove: ['bridgeAll'],
  move: ['flowName', 'flowId', 'condition', 'language', 'default'],
  tidy: ['path', 'via', 'kind', 'branch'],
  place: ['via', 'kind'],
  color: ['via', 'kind'],
};
const NEW_IN: Record<string, string[]> = { connect: ['set'], retype: ['set'], set: ['set'] };
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
const recorded = JSON.parse(Fixtures.text('design-iq/schema-reads.json')) as { formatOperations: string[]; reads: Read[] };
const entryOf = (name: string): Entry => schema.$defs[name]!;
const namesIn = (union: string): string[] => schema.$defs[union]!.oneOf.map(({ $ref }) => $ref.split('/').at(-1)!);
const alongThePlan = (name: string, keys: string[]): string[] => [...keys.filter((key) => !GONE_FROM[name]?.includes(key)), ...(NEW_IN[name] ?? [])];
const recordedKeys = recorded.reads.filter(({ read, path }) => read === 'keys' && path[0] === '$defs' && path[2] === 'properties' && path[1] !== 'align');
const recordedFields = recorded.reads.filter(({ read, path }) => read === 'read' && path[2] === 'properties' && path.length === 4 && path[1] !== 'align');
const keysOnMain = (name: string): string[] => recordedKeys.find(({ path }) => path[1] === name)!.keys!;
const requiredOnMain = (name: string): string[] => recorded.reads.filter(({ path }) => path[1] === name && path[2] === 'required' && /^\d+$/.test(path[3] ?? '')).map(({ value }) => value!);

describe('OperationSchema', () => {
  it('lists the 17 operations in the order of the catalogue', () => {
    expect(namesIn('op')).toEqual(OperationCatalog.names());
  });

  it("writes drawingOp, which design-iq reads for main's format operations without align and with layout", () => {
    expect(namesIn('drawingOp').sort()).toEqual([...recorded.formatOperations.filter((name) => name !== 'align'), 'layout'].sort());
  });

  it.each(recordedKeys.map(({ path, keys }) => [path[1]!, keys!] as const))("finds the properties design-iq reads of %s, but for the plan's keys", (name, keys) => {
    expect(Object.keys(entryOf(name).properties).sort()).toEqual(alongThePlan(name, keys).sort());
  });

  it.each(recordedFields.map(({ path }) => [path[1]!, path[3]!] as const))('answers the read of %s.%s, unless the plan moved the key', (name, key) => {
    expect(key in entryOf(name).properties).toBe(alongThePlan(name, keysOnMain(name)).includes(key));
  });

  it.each(recordedKeys.map(({ path }) => path[1]!))('finds the required keys design-iq reads of %s, with set on the set operation', (name) => {
    const required = requiredOnMain(name);
    expect(required).toContain('op');
    expect(entryOf(name).required).toEqual(name === 'set' ? [...required, 'set'] : required);
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
