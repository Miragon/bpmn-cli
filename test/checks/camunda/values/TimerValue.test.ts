import { describe, expect, it } from 'vitest';
import { TimerValue } from '../../../../src/checks/camunda/values/TimerValue.js';

describe('TimerValue', () => {
  it.each(['PT1H', 'P2D', 'PT1.5S'])('takes %s as a duration Camunda 8 reads', (value) => {
    expect(new TimerValue(value).isDuration()).toBe(true);
  });

  it('refuses words and a decimal hour as a duration', () => {
    expect(new TimerValue('1 hour').isDuration()).toBe(false);
    expect(new TimerValue('PT1.5H').isDuration()).toBe(false);
  });

  it('takes a date-time with an offset and names the field out of range', () => {
    expect(new TimerValue('2030-12-31T10:00:00Z').isDateTime()).toBe(true);
    expect(new TimerValue('2030-02-30T10:00:00Z').isDateTime()).toBe(false);
    expect(new TimerValue('2030-13-01T10:00:00Z').dateTimeRangeProblem()).toContain('month 13');
  });

  it('takes a repeating interval and a 6-field cron as a cycle', () => {
    expect(new TimerValue('R5/2030-01-01T08:00:00Z/P1D').isCycle()).toBe(true);
    expect(new TimerValue('0 0 9 * * MON').isCycle()).toBe(true);
    expect(new TimerValue('every day').isCycle()).toBe(false);
  });

  it('names the cron field out of range', () => {
    expect(new TimerValue('0 0 25 * * *').cronProblem()).toContain('hour');
    expect(new TimerValue('0 0 25 * * *').cycleRangeProblem()).toContain('hour');
    expect(new TimerValue('0 0 9 * * MON').cronProblem()).toBeUndefined();
  });
});
