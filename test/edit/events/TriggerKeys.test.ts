import { describe, expect, it } from 'vitest';
import { TriggerKeys } from '../../../src/edit/events/TriggerKeys.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('TriggerKeys', () => {
  it.each([
    [{ timer: 'PT1H' }, 'timer'],
    [{ errorCode: 'E1' }, 'error'],
    [{ escalationCode: 'E1' }, 'escalation'],
    [{ when: '${ok}' }, 'conditional'],
    [{ name: 'Wait' }, undefined],
  ])('reads from %j the trigger %s', (keys, trigger) => {
    expect(TriggerKeys.impliedTrigger(keys)).toBe(trigger);
  });

  it('reads the options of an event with nonInterrupting as a boolean', async () => {
    const element = Fixtures.element(await Fixtures.read('edit/events-triggers.bpmn'), 'boundary_timer');

    expect(TriggerKeys.optionsOf({ timer: 'PT1H', nonInterrupting: 'true', name: 'Wait' }, element)).toEqual({ timer: 'PT1H', nonInterrupting: true });
  });

  it('refuses a nonInterrupting that is no boolean', async () => {
    const element = Fixtures.element(await Fixtures.read('edit/events-triggers.bpmn'), 'boundary_timer');

    expect(() => TriggerKeys.optionsOf({ nonInterrupting: 'maybe' }, element)).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE' }));
  });

  it('splits the keys of an operation into those of the trigger and the rest', () => {
    const keys = { message: 'Paid', nonInterrupting: 'true', name: 'Wait' };

    expect(TriggerKeys.present(keys)).toEqual({ message: 'Paid', nonInterrupting: 'true' });
    expect(TriggerKeys.remainingKeys(keys)).toEqual({ name: 'Wait' });
    expect(TriggerKeys.remainingKeys(keys, ['name'])).toEqual({ message: 'Paid', nonInterrupting: 'true' });
  });
});
