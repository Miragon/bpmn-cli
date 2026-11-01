import { describe, expect, it } from 'vitest';
import { type Finding, Findings } from '../../../src/model/findings/Findings.js';

describe('Findings', () => {
  it('turns a warning of the layout into a finding at its element', () => {
    expect(Findings.ofLayout({ code: 'DI_NOT_CREATED', elementId: 'flow', message: 'no shape' })).toEqual({ code: 'W_LAYOUT_DI_NOT_CREATED', message: 'no shape', element: 'flow', severity: 'warning' });
  });

  it('counts errors and everything else as warnings', () => {
    const findings: Finding[] = [{ code: 'E_X', message: '', severity: 'error' }, { code: 'W_C8_X', message: '', severity: 'deploy' }, { code: 'W_X', message: '' }];

    expect(Findings.countOf(findings)).toEqual({ errors: 1, warnings: 2 });
  });

  it('makes a finding with only the fields it has', () => {
    expect(Findings.make('deploy', 'W_C8_X', 'Refused', undefined)).toEqual({ code: 'W_C8_X', message: 'Refused', severity: 'deploy' });
  });

  it('holds the element, the related ids and the hint', () => {
    const finding = Findings.make('runtime', 'W_C7_X', 'Ignored', 'task', { related: ['flow'], hint: 'Change it' });

    expect(finding).toEqual({ code: 'W_C7_X', message: 'Ignored', severity: 'runtime', element: 'task', related: ['flow'], hint: 'Change it' });
  });

  it('keeps what is wrong on the element out of the JSON', () => {
    const finding = Findings.make('practice', 'W_X', 'Fragile', 'task', { subject: 'timer' });

    expect(finding.subject).toBe('timer');
    expect(JSON.parse(JSON.stringify(finding))).not.toHaveProperty('subject');
  });

  it('adds a key that does not show in JSON and skips undefined fields', () => {
    const finding: Finding = Findings.withUnserialised({ code: 'W_X', message: 'M' }, { key: 'k' });

    expect(finding.key).toBe('k');
    expect(Object.keys(finding)).toEqual(['code', 'message']);
    expect(Object.getOwnPropertyDescriptor(Findings.withUnserialised({ code: 'W', message: 'M' }, { key: undefined }), 'key')).toBeUndefined();
  });
});
