import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectLintValidator } from '../../../src/cli/files/ProjectLintValidator.js';
import { Fixtures } from '../../support/Fixtures.js';

const NOTE = { severity: 'warning', code: 'W_CONFIG_IGNORED', message: 'a value' };

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'lint-validator-'));
  mkdirSync(join(folder, '.git'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('ProjectLintValidator', () => {
  it('names where the configuration comes from and how many values it ignores', () => {
    expect(new ProjectLintValidator('rc', 'here', []).detail).toBe('here');
    expect(new ProjectLintValidator('rc', 'here', [NOTE]).detail).toContain('1 element-id-naming value ignored');
  });

  it('runs without the file of the context, and adds its notes', async () => {
    const path = join(folder, '.bpmnlintrc');
    writeFileSync(path, '{"rules":{"label-required":"error"}}');

    const findings = await new ProjectLintValidator(path, 'here', [NOTE]).validate(Fixtures.text('edit/flows-bridge.bpmn'), { phase: 'check', platform: 'none', operations: [], importWarnings: [] });

    expect(findings.map(({ code }) => code)).toContain('label-required');
    expect(findings.at(-1)).toBe(NOTE);
  });

  it('refuses a file that cannot be read or is no JSON object', () => {
    const path = join(folder, 'broken.json');
    writeFileSync(path, '[]');

    expect(() => ProjectLintValidator.assertReadable(path)).toThrow(expect.objectContaining({ code: 'E_LINT_CONFIG' }));
    expect(() => ProjectLintValidator.assertReadable(join(folder, 'gone.json'))).toThrow(expect.objectContaining({ code: 'E_LINT_CONFIG' }));
  });

  it('drops a warning of ours that a rule says again about the same element', () => {
    const findings = [{ code: 'W_NO_END', message: 'a', element: 'p', severity: 'warning' as const }, { code: 'W_DEAD_END', message: 'b', element: 'q', severity: 'warning' as const }, { code: 'end-event-required', message: 'c', element: 'p', severity: 'warning' as const, validator: 'bpmnlint' }];
    const report = { findings, state: { errors: 0, warnings: 3 } } as never;

    const { findings: left, state } = ProjectLintValidator.withoutRepeats(report);

    expect(left.map(({ code }) => code)).toEqual(['W_DEAD_END', 'end-event-required']);
    expect(state.warnings).toBe(2);
  });
});
