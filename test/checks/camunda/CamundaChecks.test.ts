import { describe, expect, it } from 'vitest';
import { CamundaChecks } from '../../../src/checks/camunda/CamundaChecks.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('CamundaChecks', () => {
  const c7Model = 'model/c7-vendor.bpmn';

  it('takes the engine from the file', async () => {
    const findings = await new CamundaChecks(await Fixtures.read('engine/verdicts/c8-values/000-timedate-2030-02-30.bpmn')).all();

    expect(findings.map(({ code }) => code)).toContain('W_C8_DEPLOY_TIMER');
  });

  it('checks a file for the engine it is asked for', async () => {
    const findings = await new CamundaChecks(await Fixtures.read('engine/verdicts/c8-values/000-timedate-2030-02-30.bpmn'), 'c7').all();

    expect(findings.every(({ code }) => code.startsWith('W_C7_'))).toBe(true);
  });

  it('has nothing to say about a file for no engine', async () => {
    expect(await new CamundaChecks(await Fixtures.read(c7Model), 'none').all()).toEqual([]);
  });

  it('reads an Operaton file the way Operaton does', async () => {
    const findings = await new CamundaChecks(await Fixtures.read('model/operaton.bpmn')).all();

    expect(findings.some(({ code }) => code.startsWith('W_C8_'))).toBe(false);
  });
});
