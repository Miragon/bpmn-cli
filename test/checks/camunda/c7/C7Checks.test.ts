import { describe, expect, it } from 'vitest';
import { C7Checks } from '../../../../src/checks/camunda/c7/C7Checks.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('C7Checks', () => {
  it('stops at an executable ad-hoc sub-process, as the engines skip its content', async () => {
    const document = await Fixtures.read('engine/parity/c7/c7-ad-hoc-sub-process-no-flows/00-an-ad-hoc-sub-process-that-nothing-connects-its-content-is-s.bpmn');

    expect(new C7Checks(document, false).findings().filter(({ code }) => code === 'W_C7_DEPLOY_AD_HOC_SUBPROCESS')).toEqual([]);
  });

  it('checks a non-executable process only for what the schema refuses', async () => {
    const document = await Fixtures.read('engine/verdicts/c7-schema-rules/007-conditional-without-condition-in-a-non-executable-process.bpmn');

    expect(new C7Checks(document, false).findings().map(({ code }) => code)).toEqual(['W_C7_DEPLOY_EVENT_DEFINITION']);
  });
});
