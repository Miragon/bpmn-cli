import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LintConfig } from '../src/LintConfig.js';
import { LintPlugins } from '../src/LintPlugins.js';

const RULE = `module.exports = () => ({ check() {} });\n`;
const OWN_RULES_PLUGIN = '@miragon/bpmnlint-plugin-rules';
const MANIFEST = (name: string) => JSON.stringify({ name, version: '1.0.0', main: 'index.js' });

function folder(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'lint-plugins-')));
}

function repository(): string {
  const root = folder();
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function place(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function installedPlugin(name: string, index = 'module.exports = {};', files: Record<string, string> = {}): Record<string, string> {
  const entries = { 'package.json': MANIFEST(name), 'index.js': index, ...files };
  return Object.fromEntries(Object.entries(entries).map(([file, text]) => [`node_modules/${name}/${file}`, text]));
}

function pluginsIn(root: string, rc: object = {}): LintPlugins {
  place(root, { '.bpmnlintrc': JSON.stringify(rc) });
  return new LintPlugins(new LintConfig(join(root, '.bpmnlintrc')));
}

const descriptor = (prefix: string) => JSON.stringify({ name: prefix, uri: `http://example.com/${prefix}`, prefix, types: [{ name: 'Free', extends: ['bpmn:Definitions'], properties: [{ name: `${prefix}Free`, isAttr: true, type: 'String' }] }] });

describe('LintPlugins', () => {
  it('runs the project copy of a plugin it also bundles', async () => {
    const root = repository();
    place(root, installedPlugin(OWN_RULES_PLUGIN, `module.exports = { configs: { all: { rules: {} } } };`, { 'rules/only-here.js': RULE }));
    const plugins = pluginsIn(root);
    expect(await plugins.resolveConfig(OWN_RULES_PLUGIN, 'all')).toEqual({ rules: {} });
    expect(await plugins.resolveRule(OWN_RULES_PLUGIN, 'only-here')).toBeTypeOf('function');
  });

  it('never falls back to the bundled copy for what the project copy lacks', async () => {
    const root = repository();
    place(root, installedPlugin(OWN_RULES_PLUGIN));
    await expect(pluginsIn(root).resolveRule(OWN_RULES_PLUGIN, 'no-generated-ids')).rejects.toThrow(`${OWN_RULES_PLUGIN} has no rule no-generated-ids`);
  });

  it('runs the bundled copy when the project has none', async () => {
    const plugins = pluginsIn(repository());
    expect(await plugins.resolveRule(OWN_RULES_PLUGIN, 'no-generated-ids')).toBeTypeOf('function');
    expect(await plugins.resolveRule('bpmnlint-plugin-camunda-compat', 'implementation')).toBeTypeOf('function');
  });

  it('finds a camunda-compat config the bundle left out in the plugin it ships with', async () => {
    expect(await pluginsIn(repository()).resolveConfig('bpmnlint-plugin-camunda-compat', 'camunda-cloud-8-5')).toHaveProperty('rules');
  });

  it("answers bpmnlint's own rules from bpmnlint, whatever the project installs", async () => {
    const root = repository();
    place(root, installedPlugin('bpmnlint', `throw new Error('never');`));
    expect(await pluginsIn(root).resolveRule('bpmnlint', 'start-event-required')).toBeTypeOf('function');
    await expect(pluginsIn(root).resolveConfig('bpmnlint', 'nope')).rejects.toThrow('bpmnlint has no config nope');
  });

  it('keeps project code out of a repository it does not trust and runs the bundled copy', async () => {
    const root = folder();
    place(root, { '.git': 'not a pointer', ...installedPlugin(OWN_RULES_PLUGIN, `throw new Error('never');`), ...installedPlugin('bpmnlint-plugin-local') });
    const plugins = pluginsIn(root);
    expect(await plugins.resolveRule(OWN_RULES_PLUGIN, 'no-generated-ids')).toBeTypeOf('function');
    await expect(plugins.resolveRule('bpmnlint-plugin-local', 'any')).rejects.toThrow('is not bundled with bpmn-cli, and');
    await expect(plugins.resolveRule(OWN_RULES_PLUGIN, 'nope')).rejects.toThrow('(bundled with bpmn-cli) has no rule nope, and');
  });

  it('names a bundled plugin without the asked rule and no copy in the project', async () => {
    await expect(pluginsIn(repository()).resolveRule(OWN_RULES_PLUGIN, 'nope')).rejects.toThrow('(bundled with bpmn-cli) has no rule nope');
  });

  it('tells a plugin that is not installed from one that fails to load or lacks the rule', async () => {
    const root = repository();
    place(root, { ...installedPlugin('bpmnlint-plugin-broken', `throw new Error('cannot start');`), ...installedPlugin('bpmnlint-plugin-empty') });
    const plugins = pluginsIn(root);
    await expect(plugins.resolveRule('bpmnlint-plugin-missing', 'any')).rejects.toThrow('bpmnlint-plugin-missing is not installed');
    await expect(plugins.resolveRule('bpmnlint-plugin-broken', 'any')).rejects.toThrow('fails to load: cannot start');
    await expect(plugins.resolveConfig('bpmnlint-plugin-empty', 'any')).rejects.toThrow('bpmnlint-plugin-empty has no config any');
  });

  it('refuses a plugin that resolves outside the repository', async () => {
    const root = repository();
    const elsewhere = folder();
    place(elsewhere, installedPlugin('bpmnlint-plugin-far', 'module.exports = {};', { 'rules/any.js': RULE }));
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(join(elsewhere, 'node_modules', 'bpmnlint-plugin-far'), join(root, 'node_modules', 'bpmnlint-plugin-far'));
    await expect(pluginsIn(root).resolveRule('bpmnlint-plugin-far', 'any')).rejects.toThrow('resolves outside the repository');
  });

  it("runs a repository's own plugin, which no require finds by name", async () => {
    const root = repository();
    place(root, { 'package.json': MANIFEST('bpmnlint-plugin-self'), 'index.js': 'module.exports = {};', 'rules/any.js': RULE });
    expect(await pluginsIn(root).resolveRule('bpmnlint-plugin-self', 'any')).toBeTypeOf('function');
  });

  it("reads a moddle extension's JSON from inside the repository, with or without its extension", async () => {
    const root = repository();
    place(root, { 'node_modules/descriptors/one.json': descriptor('one'), 'node_modules/descriptors/two.json': descriptor('two'), 'node_modules/descriptors/package.json': '{}' });
    const plugins = pluginsIn(root, { moddleExtensions: { one: 'descriptors/one.json', two: 'descriptors/two', inline: JSON.parse(descriptor('inline')) } });
    expect(plugins.unavailable).toEqual([]);
    const { rootElement, warnings } = await plugins.moddle().fromXML('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:one="http://example.com/one" one:oneFree="1" />');
    expect(rootElement.$type).toBe('bpmn:Definitions');
    expect(warnings).toEqual([]);
  });

  it('brings the camunda and zeebe descriptors when the project has none', async () => {
    expect(pluginsIn(repository(), { moddleExtensions: { zeebe: 'zeebe-bpmn-moddle/resources/zeebe' } }).unavailable).toEqual([]);
    const plugins = pluginsIn(repository(), { moddleExtensions: { camunda: 'camunda-bpmn-moddle/resources/camunda.json' } });
    expect(plugins.unavailable).toEqual([]);
    const { warnings } = await plugins.moddle().fromXML('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"><process id="p" camunda:historyTimeToLive="1" /></definitions>');
    expect(warnings).toEqual([]);
  });

  it('leaves out each moddle extension it cannot use and keeps the others', () => {
    const root = repository();
    place(root, { 'node_modules/descriptors/package.json': '{}', 'node_modules/descriptors/script.js': '', 'node_modules/descriptors/broken.json': '{', 'node_modules/descriptors/rejected.json': JSON.stringify({ name: 'r', uri: 'u', prefix: 'bpmn', types: [] }), 'node_modules/descriptors/good.json': descriptor('good') });
    const plugins = pluginsIn(root, { moddleExtensions: { number: 7, missing: 'nowhere/x.json', script: 'descriptors/script.js', broken: 'descriptors/broken.json', rejected: 'descriptors/rejected.json', good: 'descriptors/good.json' } });
    expect(plugins.unavailable.map(({ name }) => name).sort()).toEqual(['broken', 'missing', 'number', 'rejected', 'script']);
  });

  it('leaves out moddleExtensions written as one string', () => {
    const plugins = pluginsIn(repository(), { moddleExtensions: 'camunda-bpmn-moddle/resources/camunda.json' });
    expect(plugins.unavailable.map(({ name }) => name)).toEqual(['moddleExtensions']);
  });
});
