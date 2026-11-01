import { describe, expect, it } from 'vitest';
import { OperationCheck } from '../../../src/operations/fields/OperationCheck.js';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';

const checkOf = (fields: Record<string, unknown>): OperationCheck => new OperationCheck(new OperationLocation(0, 'ops[0]'), fields);

describe('OperationCheck', () => {
  it('quotes keys for a message', () => {
    expect(OperationCheck.quoted(['a', 'b'])).toBe('"a", "b"');
    expect(OperationCheck.quoted(['a', 'b'], ' and ')).toBe('"a" and "b"');
  });

  it('lists the keys that are given', () => {
    expect(checkOf({ a: 1, b: undefined }).present(['a', 'b', 'c'])).toEqual(['a']);
  });

  it.each([[{ after: 'a' }], [{ before: 'a' }], [{ after: 'a', before: 'b' }], [{}]])('takes the placement %j', (fields) => {
    expect(() => checkOf(fields).placement()).not.toThrow();
  });

  it.each([[{ after: 'a', flow: 'b' }], [{ in: 'a', on: 'b' }], [{ after: 'a', before: 'b', on: 'c' }]])('refuses the placement %j', (fields) => {
    expect(() => checkOf(fields).placement()).toThrow('cannot be combined');
  });

  it('reads the default marker as a flag and as text', () => {
    expect(() => checkOf({ default: true, condition: 'a' }).defaultFlow()).toThrow('mutually exclusive');
    expect(() => checkOf({}).defaultFlow({ default: 'true', condition: 'a' })).toThrow('mutually exclusive');
    expect(() => checkOf({ default: false, condition: 'a' }).defaultFlow()).not.toThrow();
  });

  it('wants a placement that makes the flow into a node', () => {
    expect(() => checkOf({ flowAs: '$in', on: 'a' }).flowIntoNode()).toThrow('"flowAs" describe the flow into the node');
    expect(() => checkOf({ flowName: 'yes', flow: 'a' }).flowIntoNode()).not.toThrow();
  });

  it('tells the family of a kind, and nothing without a kind', () => {
    expect(checkOf({ kind: 'userTask' }).kind()).toBe('task');
    expect(checkOf({ kind: 'eventSubProcess:message' }).kind()).toBe('subProcess');
    expect(checkOf({}).kind()).toBeUndefined();
  });

  it('holds a kind to the family asked for', () => {
    expect(() => checkOf({ kind: 'userTask' }).kind('gateway')).toThrow('"kind" must be a gateway kind');
    expect(checkOf({ kind: 'xor' }).kind('gateway')).toBe('gateway');
  });

  it('refuses an unknown kind as usage, with the candidates and the guide', () => {
    expect(() => checkOf({ kind: 'usertsk' }).kind()).toThrow(expect.objectContaining({ code: 'E_USAGE', details: expect.objectContaining({ candidates: expect.arrayContaining(['userTask']), hint: 'Run `bpmn guide kinds` for the list of kinds and triggers.' }) }));
  });

  it('takes at most one key per group and at least one key', () => {
    expect(() => checkOf({ a: 1, c: 1 }).groups([['a', 'b'], ['c']], 'none')).not.toThrow();
    expect(() => checkOf({ a: 1, b: 1 }).groups([['a', 'b']], 'none')).toThrow('"a" and "b" cannot be combined');
    expect(() => checkOf({}).groups([['a', 'b']], 'none given')).toThrow('none given');
  });

  it('needs ids or a selector, and a path of two', () => {
    expect(checkOf({ branch: 'a' }).hasSelector()).toBe(true);
    expect(checkOf({ ids: ['a'] }).hasSelector()).toBe(false);
    expect(() => checkOf({ ids: ['a'] }).selection()).not.toThrow();
    expect(() => checkOf({}).selection()).toThrow('give "ids"');
    expect(() => checkOf({ path: ['a'] }).selection()).toThrow('"path" takes exactly two ids (from and to), got 1');
  });
});
