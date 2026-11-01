import { describe, expect, it } from 'vitest';
import { ModelChecks } from '../../src/checks/ModelChecks.js';
import { Fixtures } from '../support/Fixtures.js';

describe('ModelChecks', () => {
  const codesOf = async (path: string) => (await new ModelChecks(await Fixtures.read(path)).all()).map(({ code }) => code);

  it('holds the structure and the Camunda findings of a model', async () => {
    const codes = await codesOf('engine/verdicts/c7-profile/065-boundary-event-on-a-compensation-handler.bpmn');

    expect(codes).toContain('E_INVALID_HOST');
    expect(codes).not.toContain('W_C7_DEPLOY_BOUNDARY_HOST');
  });

  it('drops the structure warning about an event gateway branch Camunda already refuses', async () => {
    const document = await Fixtures.read('engine/parity/c7/c7-event-gateway-branches-unique/08-a-camunda-8-diagram.bpmn');

    expect((await new ModelChecks(document, 'none').all()).map(({ code }) => code)).toContain('W_EVENT_GATEWAY_TARGET');
    expect((await new ModelChecks(document, 'c7').all()).map(({ code }) => code)).not.toContain('W_EVENT_GATEWAY_TARGET');
  });

  it('drops the missing start the Camunda finding repeats', async () => {
    const codes = await codesOf('engine/parity/c7/c7-scope-needs-start-event/10-empty-sub-process.bpmn');

    expect(codes).toContain('W_C7_DEPLOY_START_EVENT');
    expect(codes).not.toContain('W_NO_START');
  });

  it('holds on a write the structure of a process no engine runs, without its Camunda findings', async () => {
    const document = await Fixtures.read('write/c7-not-executable.bpmn');

    const codes = (await new ModelChecks(document).onWrite()).map(({ code }) => code);

    expect(codes).toContain('W_NO_START');
    expect(codes.filter((code) => code.startsWith('W_C7_'))).toEqual([]);
  });

  it('runs no Camunda checks on a platform of none', async () => {
    const document = await Fixtures.read('engine/verdicts/c7-profile/065-boundary-event-on-a-compensation-handler.bpmn');

    expect((await new ModelChecks(document, 'none').all()).every(({ code }) => /^[EW]_(?!C[78]_)/.test(code))).toBe(true);
  });
});
