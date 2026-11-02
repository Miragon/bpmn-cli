import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LintConfig } from '../src/LintConfig.js';
import { LintFindings, type ModdleNode, type ParseWarning } from '../src/LintFindings.js';
import { LintPlugins } from '../src/LintPlugins.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

async function parsed(name: string): Promise<{ rootElement: ModdleNode; warnings: ParseWarning[] }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lint-findings-')));
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, '.bpmnlintrc'), '{}');
  const { rootElement, warnings = [] } = await new LintPlugins(new LintConfig(join(root, '.bpmnlintrc'))).moddle().fromXML(fixture(name));
  return { rootElement, warnings };
}

describe('LintFindings', () => {
  it('turns a report at an element into a finding named after its rule', async () => {
    const { rootElement } = await parsed('disconnected-task.bpmn');
    const findings = new LintFindings('none', []).ofReports({ 'no-disconnected': [{ id: 'alone', message: 'Element is not connected', category: 'error' }], '@miragon/rules/style': [{ message: 'Whole file', category: 'info' }] }, rootElement, new Map());
    expect(findings).toEqual([
      { severity: 'error', code: 'no-disconnected', message: 'Element is not connected', element: 'alone' },
      { severity: 'warning', code: '@miragon/rules/style', message: 'Whole file' },
    ]);
  });

  it('explains a finding about flows the file does not list under incoming or outgoing', async () => {
    const { rootElement } = await parsed('flows-without-lists.bpmn');
    const reports = { 'no-implicit-end': [{ id: 'start', message: 'implicit end', category: 'error' }], 'no-implicit-start': [{ id: 'end', message: 'implicit start', category: 'error' }], 'event-based-gateway': [{ id: 'choice', message: 'too few', category: 'error' }], 'no-disconnected': [{ id: 'wait_a', message: 'alone', category: 'error' }] };
    const findings = new LintFindings('none', []).ofReports(reports, rootElement, new Map());
    expect(findings.every(({ hint }) => hint?.includes('does not list under incoming / outgoing'))).toBe(true);
  });

  it('gives no such hint when the element has no flow at that end', async () => {
    const { rootElement } = await parsed('disconnected-task.bpmn');
    const [finding] = new LintFindings('none', []).ofReports({ 'no-implicit-end': [{ id: 'alone', message: 'implicit end', category: 'error' }] }, rootElement, new Map());
    expect(finding?.hint).toBeUndefined();
  });

  it('replaces the reports of a failed rule by one W_LINT_FAILED', async () => {
    const { rootElement } = await parsed('disconnected-task.bpmn');
    const failures = new Map([['local/broken', 'it broke']]);
    const results = { 'local/broken': [{ id: 'alone', message: 'never shown', category: 'error' }], 'local/throwing': [{ message: 'thrown\nsecond line', category: 'rule-error' }] };
    const findings = new LintFindings('none', []).ofReports(results, rootElement, failures);
    expect(findings.map(({ code, message }) => [code, message])).toEqual([
      ['W_LINT_FAILED', 'bpmnlint rule local/broken failed: it broke; its findings are left out'],
      ['W_LINT_FAILED', 'bpmnlint rule local/throwing failed: thrown; its findings are left out'],
    ]);
  });

  it('reports only the import warnings the core has not reported, as errors at their element', async () => {
    const { warnings } = await parsed('import-warnings.bpmn');
    const [known, ...others] = warnings as [ParseWarning, ...ParseWarning[]];
    const findings = new LintFindings('c7', [{ message: known.message }]).ofImportWarnings(warnings);
    expect(findings).toHaveLength(others.length);
    expect(findings.every(({ code, severity }) => code === 'import-warning' && severity === 'error')).toBe(true);
    expect(findings[0]?.element).toBe('decide');
  });

  it("keeps bpmn-cli's decision link apart only in a model without an engine", async () => {
    const { warnings } = await parsed('import-warnings.bpmn');
    const hintOf = (platform: 'none' | 'c7') => new LintFindings(platform, []).ofImportWarnings(warnings).find(({ element }) => element === 'decide')?.hint;
    expect(hintOf('none')).toContain("bpmn-cli's decision link");
    expect(hintOf('c7')).not.toContain("bpmn-cli's decision link");
  });

  it('says that no rule ran when the model cannot be parsed', () => {
    const finding = new LintFindings('none', []).ofFailure(new Error('unparsable content\nat line 1'));
    expect(finding).toMatchObject({ code: 'W_LINT_FAILED', severity: 'warning', message: 'bpmnlint could not lint the model: unparsable content' });
  });

  it('groups what is left out per package and reason', () => {
    const shared = { kind: 'rule', pkg: 'bpmnlint-plugin-x', reason: 'not installed', hint: 'install it' } as const;
    const findings = LintFindings.ofUnavailable([{ ...shared, name: 'x/one' }, { ...shared, kind: 'config', name: 'plugin:x/all' }, { kind: 'moddle', name: 'camunda', pkg: 'path', reason: 'gone' }, { kind: 'file', name: 'rc', pkg: 'rc', reason: 'rc is not JSON' }]);
    expect(findings.map(({ message }) => message)).toEqual([
      'x/one, plugin:x/all left out: not installed',
      'moddle extension camunda (path) left out: gone; rules reading its properties may report findings that are not there',
      'rc is not JSON; bpmnlint did not run',
    ]);
    expect(findings[0]).toMatchObject({ code: 'W_LINT_UNAVAILABLE', severity: 'warning', hint: 'install it' });
  });

  it('takes the first line of anything thrown', () => {
    expect(LintFindings.firstLine('plain\ntext')).toBe('plain');
  });
});
