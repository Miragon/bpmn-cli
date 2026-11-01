import { describe, expect, it } from 'vitest';
import { ValidationText } from '../../../src/cli/output/ValidationText.js';

const REPORT = { findings: [], state: { errors: 0, warnings: 0 }, platform: { platform: 'c8', detail: 'namespace', counts: { deploy: 1, runtime: 2, practice: 3 } }, validators: [], layout: { status: 'ok' }, importWarnings: [] };

const textOf = (changes: object) => new ValidationText({ ...REPORT, ...changes } as never, 'f.bpmn').text();

describe('ValidationText', () => {
  it('ends with the verdict graders match', () => {
    expect(textOf({}).split('\n').at(-1)).toBe('valid, 0 warning(s)');
    expect(textOf({ state: { errors: 2, warnings: 1 }, importWarnings: ['x'] }).split('\n').at(-1)).toBe('2 error(s), 1 warning(s), 1 import warning(s)');
  });

  it('counts what an engine refuses, and says nothing of it without an engine', () => {
    expect(textOf({})).toContain('platform: c8 (namespace) - 1 refused at deploy, 2 runtime, 3 practice finding(s)');
    expect(textOf({ platform: { platform: 'none', detail: 'no engine', counts: {} } })).toContain('platform: none (no engine)\n');
  });

  it('prints errors before warnings, the validators and a failed layout', () => {
    const findings = [{ code: 'W_A', message: 'a' }, { code: 'E_B', message: 'b', severity: 'error' }];
    const text = textOf({ findings, validators: [{ name: 'bpmnlint', detail: 'here', errors: 1, warnings: 0, blocks: false }], layout: { status: 'failed', error: { code: 'E_LAYOUT' } } });

    expect(text.indexOf('E_B')).toBeLessThan(text.indexOf('W_A'));
    expect(text).toContain('validator bpmnlint (here): 1 error(s), 0 warning(s) in the file');
    expect(text).toContain('layout: failed (E_LAYOUT)');
  });
});
