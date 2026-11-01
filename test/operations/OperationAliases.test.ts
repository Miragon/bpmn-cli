import { describe, expect, it } from 'vitest';
import type { Operation } from '../../src/operations/OperationCatalog.js';
import { OperationAliases } from '../../src/operations/OperationAliases.js';

const SPLIT: Operation = { op: 'split', after: '$start', as: '$gateway', joinAs: '$join', branches: [{ nodes: [{ kind: 'task', as: '$node', lane: '$lane', set: { default: '$flow' } }] }] };
const ADD: Operation = { op: 'add', kind: 'task', after: '$start', members: ['$a', 'b'], set: { lane: '$lane' }, as: '$new' };

describe('OperationAliases', () => {
  it('tells an alias from an expression', () => {
    expect(OperationAliases.isAlias('$check')).toBe(true);
    expect(OperationAliases.isAlias('${ok}')).toBe(false);
    expect(OperationAliases.isAlias(1)).toBe(false);
  });

  it('lists the aliases an operation defines, those of split nodes too', () => {
    expect(new OperationAliases(SPLIT).defined()).toEqual(['$gateway', '$join', '$node']);
  });

  it('lists the ids an operation refers to', () => {
    expect(new OperationAliases(ADD).referencedIds()).toEqual(['$start', '$a', 'b', '$lane']);
  });

  it('finds the aliases an operation uses, in lists, under set and in split nodes', () => {
    expect(new OperationAliases(ADD).references()).toEqual([{ key: 'after', alias: '$start' }, { key: 'members[0]', alias: '$a' }, { key: 'set.lane', alias: '$lane' }]);
    expect(new OperationAliases(SPLIT).references()).toEqual([{ key: 'after', alias: '$start' }, { key: 'branches[0].nodes[0].lane', alias: '$lane' }, { key: 'branches[0].nodes[0].set.default', alias: '$flow' }]);
  });

  it('resolves aliases in a copy and leaves the operation as it is', () => {
    const resolved = new OperationAliases(ADD).resolve((alias) => `id_${alias.slice(1)}`);
    expect(resolved).toEqual({ op: 'add', kind: 'task', after: 'id_start', members: ['id_a', 'b'], set: { lane: 'id_lane' }, as: '$new' });
    expect(ADD).toMatchObject({ after: '$start' });
  });

  it('leaves the id keys an operation does not give out of the resolved copy', () => {
    const operation: Operation = { op: 'set', id: '$task', set: { name: 'Review', lane: '$lane' } };

    const resolved = new OperationAliases(operation).resolve((alias) => `id_${alias.slice(1)}`);

    expect(resolved).toStrictEqual({ op: 'set', id: 'id_task', set: { name: 'Review', lane: 'id_lane' } });
  });

  it('hands back an operation without aliases', () => {
    const operation: Operation = { op: 'tidy' };
    expect(new OperationAliases(operation).resolve(() => 'never')).toBe(operation);
  });

  it.each<[string, Operation[], string, string]>([
    ['an unknown alias with the ones defined so far', [{ op: 'add', kind: 'task', as: '$a' }, { op: 'tidy', ids: ['$b'] }], 'E_UNKNOWN_ALIAS', 'alias $b is not defined (did you mean $a?); defined so far: $a (ops[0])'],
    ['an alias no operation defines', [{ op: 'tidy', ids: ['$longername'] }], 'E_UNKNOWN_ALIAS', 'no op before it defines one'],
    ['an alias a later operation defines', [{ op: 'add', kind: 'task', after: '$a' }, { op: 'add', kind: 'task', as: '$a' }], 'E_UNKNOWN_ALIAS', 'alias $a is not defined before this op (ops[1] defines it)'],
    ['an alias the operation itself defines', [{ op: 'add', kind: 'task', as: '$a', after: '$a' }], 'E_UNKNOWN_ALIAS', 'this op defines it'],
    ['an alias defined twice', [{ op: 'add', kind: 'task', as: '$a' }, { op: 'add', kind: 'task', as: '$a' }], 'E_DUPLICATE_ALIAS', 'alias $a is already defined by ops[0]'],
    ['an alias in the place of a new id', [{ op: 'add', kind: 'task', id: '$a' }], 'E_USAGE', '"id" is the id of the new element, not an alias; give the alias with "as": "$a"'],
  ])('refuses %s', (_case, operations, code, message) => {
    expect(() => OperationAliases.assertBatch(operations)).toThrow(expect.objectContaining({ code, message: expect.stringContaining(message) }));
  });

  it('takes a batch that uses each alias after the operation that defines it', () => {
    expect(() => OperationAliases.assertBatch([{ op: 'add', kind: 'task', as: '$a' }, { op: 'color', ids: ['$a'], color: 'red' }])).not.toThrow();
  });

  it('answers an alias a running batch lacks with what the batch has', () => {
    const refusal = OperationAliases.unknown(1, { op: 'tidy' }, 'ids[0]', '$zzzzzz', new Map([['$a', 0]]), 0);
    expect(refusal.code).toBe('E_UNKNOWN_ALIAS');
    expect(refusal.details.candidates).toEqual(['$a']);
    expect(refusal.message).not.toContain('did you mean');
  });
});
