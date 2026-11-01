import { describe, expect, it } from 'vitest';
import type { LintResolver } from '../src/LintPlugins.js';
import { RuleGuard } from '../src/RuleGuard.js';

const INFO = { pkg: 'bpmnlint-plugin-local', ruleName: 'rule' };
const KEY = 'local/rule';
const node = { $type: 'bpmn:Task' };

function resolverAnswering(answer: unknown): LintResolver {
  return { resolveRule: () => answer, resolveConfig: () => 'config' };
}

const callCheck = (check: unknown) => (check as (...args: unknown[]) => unknown)(node, {});

describe('RuleGuard', () => {
  it('passes a healthy rule and its answers through', () => {
    const rule = new RuleGuard(resolverAnswering(undefined)).guarded({ check: () => 'answer' }, INFO);
    expect(callCheck(rule.check)).toBe('answer');
  });

  it('records a check that throws on a task and stops asking it', () => {
    const guard = new RuleGuard(resolverAnswering(undefined));
    let calls = 0;
    const rule = guard.guarded({ check: () => { calls += 1; throw new Error('broke\nsecond line'); } }, INFO);
    expect(callCheck(rule.check)).toBe(false);
    expect(callCheck(rule.check)).toBe(false);
    expect(calls).toBe(1);
    expect(guard.failures.get(KEY)).toBe('broke');
  });

  it('records a rule without any check', () => {
    const guard = new RuleGuard(resolverAnswering(undefined));
    guard.guarded({ check: { other() {} } }, INFO);
    expect(guard.failures.get(KEY)).toBe('the rule has no check');
  });

  it('guards the enter and leave parts of a check', () => {
    const guard = new RuleGuard(resolverAnswering(undefined));
    const rule = guard.guarded({ check: { enter: () => 'entered', leave: () => { throw new Error('left'); } } }, INFO);
    const { enter, leave } = rule.check as { enter: unknown; leave: unknown };
    expect(callCheck(enter)).toBe('entered');
    expect(callCheck(leave)).toBe(false);
    expect(guard.failures.get(KEY)).toBe('left');
  });

  it('records a check that rejects once the lint has settled', async () => {
    const guard = new RuleGuard(resolverAnswering(undefined));
    const rule = guard.guarded({ check: async () => { throw new Error('async broke'); } }, INFO);
    expect(callCheck(rule.check)).toBeUndefined();
    await guard.settled();
    expect(guard.failures.get(KEY)).toBe('async broke');
  });

  it('does not wait for a check that never settles', async () => {
    const guard = new RuleGuard(resolverAnswering(undefined));
    callCheck(guard.guarded({ check: () => new Promise(() => {}) }, INFO).check);
    await guard.settled();
    expect(guard.failures.size).toBe(0);
  });

  it('records a rule factory that throws or returns a promise, and answers with an empty rule', async () => {
    const guard = new RuleGuard(resolverAnswering(() => { throw new Error('factory broke'); }));
    const factory = (await guard.resolver().resolveRule('bpmnlint', 'broken')) as (options: unknown) => { check(): void };
    expect(factory({}).check()).toBeUndefined();
    expect(guard.failures.get('broken')).toBe('factory broke');
    const promising = new RuleGuard(resolverAnswering(async () => ({ check() {} })));
    await ((await promising.resolver().resolveRule('@acme/bpmnlint-plugin-scoped', 'late')) as (options: unknown) => unknown)({});
    expect(promising.failures.get('@acme/scoped/late')).toContain('returned a promise');
  });

  it('hands healthy factories, odd answers and configs through', async () => {
    const rule = { check() {} };
    const healthy = new RuleGuard(resolverAnswering(() => rule)).resolver();
    expect(((await healthy.resolveRule('bpmnlint', 'fine')) as (options: unknown) => unknown)({})).toBe(rule);
    expect(await new RuleGuard(resolverAnswering('no factory')).resolver().resolveRule('bpmnlint', 'odd')).toBe('no factory');
    expect(healthy.resolveConfig('bpmnlint', 'recommended')).toBe('config');
  });
});
