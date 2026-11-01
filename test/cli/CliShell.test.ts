import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('CliShell', () => {
  it('prints exactly one line end after a read', async () => {
    const { stdout } = await cli.run(['show', cli.copied('edit/order-check.bpmn')]);

    expect(stdout.endsWith('\n')).toBe(true);
    expect(stdout.endsWith('\n\n')).toBe(false);
  });

  it('puts the file into the command of a refusal that names <file>', async () => {
    const file = cli.copied('models/incremental/orders.bpmn');
    const { stdout: ids } = await cli.run(['find', file, '--kind', 'task']);
    const [first, second] = ids.trim().split('\n').map((line) => line.split('\t')[0]!);

    const { stderr } = await cli.run(['place', file, first!, '--row-of', second!, '--after', first!, '--json']);

    expect(stderr).not.toContain('<file>"');
  });
});
