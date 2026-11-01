import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('ConventionsCommand', () => {
  it('prints the patterns new ids follow', async () => {
    const { stdout } = await cli.run(['conventions', cli.copied('edit/order-check.bpmn')]);

    expect(stdout).toContain('gateway_{name:camel}');
  });

  it('says what validate says of a .bpmnlintrc that does not load', async () => {
    const model = cli.copied('edit/order-check.bpmn');
    writeFileSync(join(dirname(model), '.bpmnlintrc'), '{ nope');

    expect((await cli.run(['conventions', model])).stdout).toMatch(/warning W_LINT_UNAVAILABLE: .*is not JSON/);
  });

  it('says as JSON why nothing is declared', async () => {
    const { undeclared, rows } = JSON.parse((await cli.run(['conventions', '-', '--json'])).stdout);

    expect(undeclared).toBe('no config');
    expect(rows.length).toBeGreaterThan(1);
  });
});
