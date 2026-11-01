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

  it.each([
    ['Camunda 8', 'edit/properties-decisions-zeebe.bpmn', 'W_C8_DEPLOY_EXECUTABLE'],
    ['Camunda 7', 'write/c7-not-executable.bpmn', 'W_C7_DEPLOY_SCHEMA'],
  ])('leaves a %s file without an executable process alone on a write', async (_engine, path, code) => {
    const checks = new CamundaChecks(await Fixtures.read(path));

    expect((await checks.all()).map((finding) => finding.code)).toContain(code);
    expect(await checks.onExecutableProcesses()).toEqual([]);
  });

  it('reports on a write only what sits in an executable process', async () => {
    const checks = new CamundaChecks(await Fixtures.read('write/c7-one-process-executable.bpmn'));
    const schemaElements = async (findings: Promise<Array<{ code: string; element?: string }>>) => (await findings).filter(({ code }) => code === 'W_C7_DEPLOY_SCHEMA').map(({ element }) => element);

    expect(await schemaElements(checks.all())).toEqual(['task_runs', 'task_sketch']);
    expect(await schemaElements(checks.onExecutableProcesses())).toEqual(['task_runs']);
  });

  it('reads an Operaton file the way Operaton does', async () => {
    const findings = await new CamundaChecks(await Fixtures.read('model/operaton.bpmn')).all();

    expect(findings.some(({ code }) => code.startsWith('W_C8_'))).toBe(false);
  });
});
