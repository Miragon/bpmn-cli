import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('bpmn with its read commands', () => {
  it('shows the outline, one element and its neighbourhood, each with the state line', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    expect((await cli.run(['show', file])).stdout).toContain('exclusiveGateway gateway_ok "Order ok?"');
    expect((await cli.run(['show', file, 'check'])).stdout).toMatch(/^userTask check "Check order"/);
    expect((await cli.run(['show', file, '--around', 'check', '--depth', '1'])).stdout).toMatch(/state: 0 errors, 0 warnings/);
  });

  it('prints a read as one line of JSON without its text', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    const shown = JSON.parse((await cli.run(['show', file, 'check', '--json'])).stdout);

    expect(shown.text).toBeUndefined();
    expect(shown.view.kind).toBeDefined();
    expect(shown.state).toEqual({ errors: 0, warnings: 0 });
  });

  it('reads a model from stdin', async () => {
    const stdin = readFileSync('corpus/edit/order-check.bpmn', 'utf8');

    expect((await cli.run(['show', '-', 'check'], { stdin })).stdout).toContain('Check order');
  });

  it('finds tab-separated when piped, aligned on a terminal, and prints nothing for no hit', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    expect((await cli.run(['find', file, 'check', '--kind', 'userTask'])).stdout).toBe('check\tuserTask\tCheck order\tProcess_orderCheck\n');
    expect((await cli.run(['find', file, 'check', '--kind', 'userTask'], { isTTY: true })).stdout).not.toContain('\t');
    expect(await cli.run(['find', file, 'zzz'])).toEqual({ exit: 0, stdout: '', stderr: '' });
  });

  it('judges the drawing and gives graders the score', async () => {
    const file = cli.copied('models/incremental/orders.bpmn');

    expect((await cli.run(['diagram', file])).stdout).toMatch(/^score \d+/);
    expect(JSON.parse((await cli.run(['diagram', file, '--json'])).stdout).score).toEqual(expect.any(Number));
  });

  it('lists the conventions of a file that does not exist yet', async () => {
    const { stdout, exit } = await cli.run(['conventions', `${cli.folder}/later.bpmn`]);

    expect(exit).toBe(0);
    expect(stdout).toContain('no .bpmnlintrc applies here');
    expect(stdout).toContain('userTask_{name:camel}');
  });

  it('validates, with exit 2 on errors and exit 5 with --strict on warnings', async () => {
    const clean = cli.copied('edit/order-check.bpmn');
    const warned = cli.copied('edit/two-pools.bpmn');
    const broken = cli.copied('edit/properties-flows.bpmn');

    expect(await cli.run(['validate', clean])).toMatchObject({ exit: 0, stdout: expect.stringContaining('valid, 0 warning(s)') });
    expect((await cli.run(['validate', warned])).exit).toBe(0);
    expect((await cli.run(['validate', warned, '--strict'])).exit).toBe(5);
    expect(await cli.run(['validate', broken])).toMatchObject({ exit: 2, stdout: expect.stringContaining('2 error(s), ') });
  });

  it('says what the guide holds and what it does not', async () => {
    expect((await cli.run(['guide'])).exit).toBe(0);
    expect(await cli.run(['guide', 'nope'])).toMatchObject({ exit: 1, stderr: expect.stringContaining('E_USAGE') });
  });
});
