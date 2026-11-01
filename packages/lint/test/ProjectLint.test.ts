import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectLint } from '../src/ProjectLint.js';

const REPORTS_PROCESS = `module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') { reporter.report(node.id, 'project copy'); } } });\n`;

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function projectWith(rc: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-lint-')));
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, '.bpmnlintrc'), rc);
  return root;
}

function install(root: string, name: string, files: Record<string, string>): void {
  const folder = join(root, 'node_modules', name);
  mkdirSync(join(folder, 'rules'), { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
  for (const [file, text] of Object.entries({ 'index.js': 'module.exports = {};', ...files })) {
    writeFileSync(join(folder, file), text);
  }
}

function lint(root: string, xml: string, importWarnings: { message: string }[] = []) {
  return ProjectLint.at(join(root, '.bpmnlintrc')).run({ xml, platform: 'none', importWarnings });
}

const codesAt = (findings: { code: string; element?: string }[]) => findings.map(({ code, element }) => `${code} ${element ?? '-'}`).sort();

describe('ProjectLint', () => {
  it('reports what the rules of the .bpmnlintrc find in a process', async () => {
    const root = projectWith('{ "rules": { "no-disconnected": "error", "end-event-required": "warn" } }');
    const findings = await lint(root, fixture('disconnected-task.bpmn'));
    expect(codesAt(findings)).toEqual(['end-event-required Process_1', 'no-disconnected alone']);
    expect(findings.find(({ code }) => code === 'no-disconnected')?.severity).toBe('error');
  });

  it("runs the project's copy of a plugin and reports its rule", async () => {
    const root = projectWith('{ "rules": { "@miragon/rules/project-only": "error" } }');
    install(root, '@miragon/bpmnlint-plugin-rules', { 'rules/project-only.js': REPORTS_PROCESS });
    expect(codesAt(await lint(root, fixture('disconnected-task.bpmn')))).toEqual(['@miragon/rules/project-only Process_1']);
  });

  it('gives the same findings on a second run, since each run takes a new linter', async () => {
    const root = projectWith('{ "rules": { "no-duplicate-sequence-flows": "error", "no-disconnected": "error" } }');
    const lintOnce = ProjectLint.at(join(root, '.bpmnlintrc'));
    const input = { xml: fixture('disconnected-task.bpmn'), platform: 'none', importWarnings: [] } as const;
    expect(await lintOnce.run(input)).toEqual(await lintOnce.run(input));
  });

  it('reports import warnings of its own parse beside the rule findings', async () => {
    const root = projectWith('{ "rules": { "start-event-required": "error" } }');
    expect(codesAt(await lint(root, fixture('import-warnings.bpmn')))).toEqual(expect.arrayContaining(['import-warning decide', 'import-warning start']));
  });

  it('runs no parse without a rule, so a model with unknown content stays silent', async () => {
    expect(await lint(projectWith('{}'), fixture('import-warnings.bpmn'))).toEqual([]);
  });

  it('turns a model that is no XML into W_LINT_FAILED', async () => {
    const root = projectWith('{ "extends": "bpmnlint:recommended" }');
    expect(codesAt(await lint(root, 'this is no XML'))).toEqual(['W_LINT_FAILED -']);
  });

  it('runs the rules it can and names what it left out', async () => {
    const root = projectWith('{ "extends": ["plugin:missing/recommended"], "rules": { "no-disconnected": "error" }, "moddleExtensions": { "gone": "nowhere/x.json" } }');
    expect(codesAt(await lint(root, fixture('disconnected-task.bpmn')))).toEqual(['W_LINT_UNAVAILABLE -', 'W_LINT_UNAVAILABLE -', 'no-disconnected alone']);
  });

  it('reports one W_LINT_UNAVAILABLE for a .bpmnlintrc that is no JSON', async () => {
    expect(codesAt(await lint(projectWith('{ nope'), fixture('disconnected-task.bpmn')))).toEqual(['W_LINT_UNAVAILABLE -']);
  });

  it('leaves a throwing rule out as W_LINT_FAILED and keeps the others', async () => {
    const root = projectWith('{ "rules": { "local/broken": "error", "no-disconnected": "error" } }');
    install(root, 'bpmnlint-plugin-local', { 'rules/broken.js': `module.exports = () => ({ check() { throw new Error('broke'); } });\n` });
    expect(codesAt(await lint(root, fixture('disconnected-task.bpmn')))).toEqual(['W_LINT_FAILED -', 'no-disconnected alone']);
  });
});
