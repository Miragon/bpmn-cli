import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LintConfig } from '../src/LintConfig.js';
import { LintPlugins } from '../src/LintPlugins.js';
import { LintRules } from '../src/LintRules.js';

function rulesOf(content: Record<string, unknown>, pluginIndex?: string): LintRules {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lint-rules-')));
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, '.bpmnlintrc'), '{}');
  if (pluginIndex) {
    const plugin = join(root, 'node_modules', 'bpmnlint-plugin-chain');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'bpmnlint-plugin-chain', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(plugin, 'index.js'), pluginIndex);
  }
  return new LintRules(new LintPlugins(new LintConfig(join(root, '.bpmnlintrc'))), content);
}

function deepChain(levels: number): string {
  const configs: Record<string, object> = { [`level${levels}`]: { rules: { 'no-disconnected': 'error' } } };
  for (let level = 0; level < levels; level++) {
    configs[`level${level}`] = { extends: `plugin:chain/level${level + 1}` };
  }
  return `module.exports = { configs: ${JSON.stringify(configs)} };`;
}

describe('LintRules', () => {
  it('lets the rules of a .bpmnlintrc override those it extends', async () => {
    const rules = await rulesOf({ extends: 'bpmnlint:recommended', rules: { 'label-required': 'off', 'start-event-required': 'warn' } }).enabled();
    expect(rules['label-required']).toBeUndefined();
    expect(rules['start-event-required']?.[0]).toBe('warn');
    expect(rules['no-disconnected']?.[0]).toBe('error');
  });

  it('keeps error and info, reads every other severity as warn', async () => {
    const rules = await rulesOf({ rules: { 'start-event-required': 2, 'end-event-required': 'INFO', 'no-disconnected': ['unheard-of', { any: 'option' }] } }).enabled();
    expect(rules).toEqual({ 'start-event-required': ['error', {}], 'end-event-required': ['info', {}], 'no-disconnected': ['warn', { any: 'option' }] });
  });

  it('leaves out only the configs and rules it cannot resolve', async () => {
    const rules = rulesOf({ extends: ['plugin:missing/recommended', 42, 'not a config'], rules: { 'a/b/c/d': 'error', 'no-such-rule': 'error', 'start-event-required': 'error' } });
    expect(Object.keys(await rules.enabled())).toEqual(['start-event-required']);
    expect(rules.unavailable.map(({ name }) => name).sort()).toEqual(['42', 'a/b/c/d', 'no-such-rule', 'not a config', 'plugin:missing/recommended']);
  });

  it('applies the rules of a config cycle once and names the cycle once', async () => {
    const plugin = `module.exports = { configs: { first: { extends: 'plugin:chain/second', rules: { 'bpmnlint/end-event-required': 'warn' } }, second: { extends: 'plugin:chain/first' } } };`;
    const rules = rulesOf({ extends: ['plugin:chain/first', 'plugin:chain/second'] }, plugin);
    expect(Object.keys(await rules.enabled())).toEqual(['end-event-required']);
    expect(rules.unavailable.map(({ reason }) => reason.slice(0, 15))).toEqual(['it extends itse', 'it extends itse']);
  });

  it('stops at 16 levels of extends', async () => {
    const rules = rulesOf({ extends: 'plugin:chain/level0' }, deepChain(17));
    expect(await rules.enabled()).toEqual({});
    expect(rules.unavailable.map(({ reason }) => reason)).toEqual(['extends nests deeper than 16 levels']);
  });

  it('reports the module a config name resolves to when it has no such rule', async () => {
    const rules = rulesOf({ rules: { 'chain/nope': 'error' } }, 'module.exports = { rules: {} };');
    await rules.enabled();
    expect(rules.unavailable).toMatchObject([{ kind: 'rule', pkg: 'bpmnlint-plugin-chain' }]);
  });
});
