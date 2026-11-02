import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('ValidateCommand', () => {
  it('prints the report as JSON with the file', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    expect(JSON.parse((await cli.run(['validate', file, '--json'])).stdout)).toMatchObject({ ok: true, file, findings: [] });
  });

  it('counts an import warning under --strict', async () => {
    const stdin = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="x"><process id="p" nope="1"/></definitions>';

    expect((await cli.run(['validate', '-', '--strict'], { stdin })).exit).toBe(5);
  });
});
