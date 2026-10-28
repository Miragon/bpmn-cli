/**
 * The effective rules of the project's bpmnlint configuration (issue #33): src/adapters/out/bpmnlint/
 * (browser-safe: BpmnlintConfigResolution), with the real bpmnlint and
 * @miragon/bpmnlint-plugin-rules, offline.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bpmnlintUnavailableFindings } from '../../../../src/adapters/out/bpmnlint/utils/bpmnlint.js';
import { bpmnlintValidator, resolveBpmnlintConfig, type BpmnlintEngine, type BpmnlintResolver } from '../../../../src/index.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import { bpmnlintEngine, loadBpmnlint } from '../../../../src/node.js';
import type { ValidatorFinding } from '../../../../src/domain/validation/validators.js';
import { repo, model, LINE } from '../../../helpers/bpmnlint.js';

describe('resolveBpmnlintConfig: the effective rules', () => {
  it('normalises the names, keeps the options as bpmnlint hands them to the rule, runs any flag but off as a warning', async () => {
    const engine = bpmnlintEngine();
    const resolved = await resolveBpmnlintConfig(engine, {
      extends: 'bpmnlint:recommended',
      rules: {
        'bpmnlint/label-required': 'warn',
        '@miragon/bpmnlint-plugin-rules/element-id-naming': ['error', { case: 'PascalCase' }],
        '@miragon/rules/no-generated-ids': ['warn'],
        'no-disconnected': 0,
        'no-implicit-start': 'OFF',
        'fake-join': 3,
        'superfluous-gateway': 'warning',
        'no-inclusive-gateway': false,
        'single-blank-start-event': 2,
      },
    });
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.rules['label-required']).toEqual({ severity: 'warn', config: {} });
    expect(resolved.rules['@miragon/rules/element-id-naming']).toEqual({ severity: 'error', config: { case: 'PascalCase' } });
    // ["warn"]: the rule gets undefined, like in bpmnlint
    expect(resolved.rules['@miragon/rules/no-generated-ids']).toEqual({ severity: 'warn', config: undefined });
    expect(resolved.rules['no-disconnected']!.severity).toBe('off');
    expect(resolved.rules['no-implicit-start']!.severity).toBe('off');
    expect(resolved.rules['fake-join']!.severity).toBe('info');
    // bpmnlint runs a rule whose flag it does not know
    expect(resolved.rules['superfluous-gateway']!.severity).toBe('warn');
    expect(resolved.rules['no-inclusive-gateway']!.severity).toBe('warn');
    expect(resolved.rules['single-blank-start-event']!.severity).toBe('error');
    // inherited, untouched
    expect(resolved.rules['end-event-required']).toEqual({ severity: 'error', config: {} });
  });

  it('a rule name bpmnlint cannot parse leaves out only that entry (bpmnlint fails on the whole file)', async () => {
    const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { extends: 'bpmnlint:recommended', rules: { 'no-implicit-end': 'off', 'no-disconnected': 'off', 'no-implicit-start': 'off', '@acme/foo': 'warn' } });
    expect(resolved.unavailable).toEqual([expect.objectContaining({ kind: 'rule', name: '@acme/foo', reason: 'unparseable rule name' })]);
    for (const rule of ['no-implicit-end', 'no-disconnected', 'no-implicit-start']) expect(resolved.rules[rule]!.severity, rule).toBe('off');
    expect(resolved.rules['label-required']!.severity).toBe('error');
  });

  it('awaits a resolver that answers with promises; a rejected rule is left out with its reason', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const rc = { extends: 'bpmnlint:recommended' };
    const sync = await resolveBpmnlintConfig({ Linter, resolver }, rc);
    const asyncResolver: BpmnlintResolver = {
      resolveRule: async (pkg, name) => resolver.resolveRule(pkg, name),
      resolveConfig: async (pkg, name) => resolver.resolveConfig(pkg, name),
    };
    const resolved = await resolveBpmnlintConfig({ Linter, resolver: asyncResolver }, rc);
    expect(resolved).toEqual(sync);
    const run = async (engine: BpmnlintEngine, resolvedConfig: typeof sync) => (await bpmnlintValidator(engine, resolvedConfig).validate!(xml, { phase: 'check', platform: 'none', ops: [], doc: () => Doc.fromXml(xml) })) as ValidatorFinding[];
    expect(await run({ Linter, resolver: asyncResolver }, resolved)).toEqual(await run({ Linter, resolver }, sync));
    const rejecting: BpmnlintResolver = { resolveConfig: asyncResolver.resolveConfig, resolveRule: async (pkg, name) => (name === 'label-required' ? Promise.reject(new Error('no label rule here')) : resolver.resolveRule(pkg, name)) };
    const partial = await resolveBpmnlintConfig({ Linter, resolver: rejecting }, rc);
    expect(partial.unavailable).toEqual([{ kind: 'rule', name: 'label-required', pkg: 'bpmnlint', reason: 'no label rule here' }]);
    expect(partial.rules['label-required']).toBeUndefined();
  });

  it('an extends entry that is no string, or a config that extends itself, is left out and named', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const looping: BpmnlintResolver = {
      resolveRule: (pkg, name) => resolver.resolveRule(pkg, name),
      resolveConfig: (pkg, name) => (pkg === 'bpmnlint-plugin-loop' ? { extends: 'plugin:loop/self', rules: { 'bpmnlint/label-required': 'warn' } } : resolver.resolveConfig(pkg, name)),
    };
    const resolved = await resolveBpmnlintConfig({ Linter, resolver: looping }, { extends: ['bpmnlint:recommended', { _: 1 } as unknown as string, 'plugin:loop/self'] });
    expect(resolved.unavailable.map((unavailableEntry) => [unavailableEntry.kind, unavailableEntry.name, unavailableEntry.reason])).toEqual([
      ['config', '{"_":1}', 'extends takes config names (strings)'],
      ['config', 'plugin:loop/self', 'it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once'],
    ]);
    expect(resolved.rules['label-required']!.severity).toBe('warn');
  });

  it('a cycle with fan-out (a config that extends itself twice, configs that extend each other) is walked once: one entry per config that closes it, its rules apply', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const configs: Record<string, unknown> = {
      twice: { extends: ['plugin:cyc/twice', 'plugin:cyc/twice'], rules: { 'bpmnlint/label-required': 'warn' } },
      all: { extends: ['plugin:cyc/recommended', 'plugin:cyc/strict'], rules: { 'bpmnlint/no-gateway-join-fork': 'warn' } },
      recommended: { extends: ['plugin:cyc/all', 'plugin:cyc/strict'], rules: { 'bpmnlint/superfluous-gateway': 'warn' } },
      strict: { extends: ['plugin:cyc/all', 'plugin:cyc/recommended'], rules: { 'bpmnlint/single-blank-start-event': 'error' } },
    };
    const cyclic: BpmnlintResolver = {
      resolveRule: (pkg, name) => resolver.resolveRule(pkg, name),
      resolveConfig: (pkg, name) => (pkg === 'bpmnlint-plugin-cyc' ? configs[name] : resolver.resolveConfig(pkg, name)),
    };
    // before: 2^16 walks and a message of 900 KB (twice; three parents ran out of memory), seconds for the three configs
    const resolved = await resolveBpmnlintConfig({ Linter, resolver: cyclic }, { extends: ['plugin:cyc/twice', 'plugin:cyc/all'] });
    expect(resolved.unavailable.map((unavailableEntry) => unavailableEntry.name)).toEqual(['plugin:cyc/twice', 'plugin:cyc/all', 'plugin:cyc/recommended', 'plugin:cyc/strict']);
    expect(Object.fromEntries(Object.entries(resolved.rules).map(([name, ruleSetting]) => [name, ruleSetting.severity]))).toEqual({ 'label-required': 'warn', 'single-blank-start-event': 'error', 'superfluous-gateway': 'warn', 'no-gateway-join-fork': 'warn' });
    const findings = bpmnlintUnavailableFindings(resolved.unavailable);
    expect(findings.map((finding) => finding.message)).toEqual([
      'plugin:cyc/twice, plugin:cyc/all, plugin:cyc/recommended, plugin:cyc/strict left out: it extends itself, directly or through the configs it extends (a cycle; bpmnlint fails on the whole file with it); its rules apply once',
    ]);
  });

  it('a moddle module path the host resolved nothing for is left out and named, not dropped silently', async () => {
    const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { moddleExtensions: { camunda: 'camunda-bpmn-moddle/resources/camunda.json' } });
    expect(resolved.moddleExtensions).toEqual({});
    expect(resolved.unavailable).toEqual([expect.objectContaining({ kind: 'moddle', name: 'camunda', pkg: 'camunda-bpmn-moddle/resources/camunda.json', reason: 'a module path, which the host resolves' })]);
  });

  it('a moddle value that is neither a descriptor object nor a module path (5, null, true) is left out and named, with or without the host', async () => {
    const reason = 'neither a descriptor object nor a module path (bpmnlint fails on the whole file with it)';
    for (const host of [{ moddleExtensions: {} }, {}]) {
      const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { moddleExtensions: { a: 5, b: null, e: true } }, host);
      expect(resolved.moddleExtensions).toEqual({});
      expect(resolved.unavailable.map((unavailableEntry) => [unavailableEntry.kind, unavailableEntry.name, unavailableEntry.pkg, unavailableEntry.reason])).toEqual([
        ['moddle', 'a', '5', reason],
        ['moddle', 'b', 'null', reason],
        ['moddle', 'e', 'true', reason],
      ]);
    }
  });

  it('a moddleExtensions that is a string is left out as one entry, not one per character', async () => {
    for (const host of [{ moddleExtensions: {} }, {}]) {
      const resolved = await resolveBpmnlintConfig(bpmnlintEngine(), { moddleExtensions: 'camunda' as unknown as Record<string, unknown> }, host);
      expect(resolved.moddleExtensions).toEqual({});
      expect(bpmnlintUnavailableFindings(resolved.unavailable).map((finding) => finding.message)).toEqual([
        'moddleExtensions "camunda" left out: it is not an object of prefix -> descriptor or module path (bpmnlint fails on the whole file with it); rules reading the properties of a moddle extension may report findings that are not there',
      ]);
    }
    // the node layer reads no character as a module path: the validator line counts one
    const dir = repo({ extends: 'bpmnlint:recommended', moddleExtensions: 'camunda-bpmn-moddle/resources/camunda.json' });
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { from: dir });
    expect(loaded.ok && loaded.notes).toEqual([]);
    expect(loaded.detail).toBe('.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)');
  });
});
