import { describe, expect, it } from 'vitest';
import { C8Checks } from '../../../../src/checks/camunda/c8/C8Checks.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('C8Checks', () => {
  it('leaves a process that is not executable out', async () => {
    const document = await Fixtures.read('engine/verdicts/c8-profile/002-a-non-executable-process-next-to-an-executable-one-is-not-ch.bpmn');

    expect(new C8Checks(document).findings()).toEqual([]);
  });

  it('checks the attributes of a message the process catches', async () => {
    const document = await Fixtures.read('engine/verdicts/c8-values/000-timedate-2030-02-30.bpmn');

    expect(new C8Checks(document).findings().map(({ code }) => code)).toContain('W_C8_DEPLOY_TIMER');
  });
});
