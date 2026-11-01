import { describe, expect, it } from 'vitest';
import { type Finding, Findings } from '../../../src/model/findings/Findings.js';

describe('Findings', () => {
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
