import { describe, expect, it } from 'vitest';
import { HostValidators, type Validator } from '../../src/write/HostValidators.js';
import { BpmnError } from '../support/ModelValues.js';

const context = { platform: 'c8' as const, file: 'order.bpmn', operations: [{ op: 'tidy' }], importWarnings: [{ message: 'unknown attribute' }] };

const failureOf = async (attempt: () => Promise<unknown>): Promise<BpmnError> => {
  const failure = await attempt().then(() => undefined, (error: unknown) => error);
  expect(failure).toBeInstanceOf(BpmnError);
  return failure as BpmnError;
};

describe('HostValidators', () => {
  it('hands each validator the text and the context of its phase', async () => {
    const seen: unknown[] = [];
    const validator: Validator = {
      name: 'gate',
      validate: (xml, given) => {
        seen.push(xml, given);
        return [];
      },
    };

    await new HostValidators([validator], context).run('<xml/>', 'before');

    expect(seen).toEqual(['<xml/>', { ...context, phase: 'before' }]);
  });

  it('turns a finding into an issue with its validator, a code from ruleId and a plain severity', async () => {
    const gate: Validator = { name: 'gate', detail: 'the save gate', validate: () => [{ severity: ' ERROR ', ruleId: 'bpmn/flow', message: 'dead end', element: 'task', related: ['flow'], hint: 'connect it', key: 'dead-end' }] };

    const [run] = await new HostValidators([gate], context).run('<xml/>', 'after');

    expect(run).toEqual({ name: 'gate', detail: 'the save gate', issues: [{ code: 'bpmn/flow', message: 'dead end', validator: 'gate', severity: 'error', element: 'task', related: ['flow'], hint: 'connect it' }] });
    expect(run?.issues[0]?.key).toBe('dead-end');
  });

  it('marks an advisory validator and reads an unknown severity as a warning', async () => {
    const advice: Validator = { name: 'advice', blocks: false, validate: async () => [{ severity: 'note', message: 'consider it' }] };

    const [run] = await new HostValidators([advice], context).run('<xml/>', 'after');

    expect(run).toEqual({ name: 'advice', blocks: false, issues: [{ code: 'FINDING', message: 'consider it', validator: 'advice', severity: 'warning' }] });
  });

  it('refuses a validator that throws, naming what it read', async () => {
    const broken: Validator = {
      name: 'broken',
      validate: () => {
        throw new Error('no parser\nstack');
      },
    };

    const failure = await failureOf(() => new HostValidators([broken], context).run('<xml/>', 'before'));

    expect(failure.code).toBe('E_VALIDATOR_FAILED');
    expect(failure.message).toBe('Validator broken failed on the document before the change: no parser; nothing was written');
  });

  it('refuses a validator that answers no list', async () => {
    const odd = { name: 'odd', validate: () => 'fine' } as unknown as Validator;

    expect((await failureOf(() => new HostValidators([odd], context).run('<xml/>', 'check'))).details['validator']).toBe('odd');
  });

  it('refuses a validator without a validate function before anything runs', () => {
    expect(() => new HostValidators([{ name: 'empty' } as Validator], context)).toThrow('Validator 1 is no object with a validate function');
  });

  it('runs nothing without validators', async () => {
    expect(await new HostValidators(undefined, context).run('<xml/>', 'check')).toEqual([]);
  });
});
