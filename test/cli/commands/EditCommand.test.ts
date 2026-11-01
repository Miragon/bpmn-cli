import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('EditCommand', () => {
  it('registers ext add and ext remove under one group', async () => {
    expect((await cli.run(['ext', '--help'])).stdout).toContain('vendor extension elements');
  });

  it('adds a raw snippet to an element without a type', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    expect((await cli.run(['ext', 'add', file, 'check', '--xml', '<camunda:properties xmlns:camunda="http://camunda.org/schema/1.0/bpmn"/>', '--dry-run'])).exit).toBe(0);
    expect((await cli.run(['ext', 'add', file, 'check'])).stderr).toMatch(/^error E_USAGE: ext add needs "type"/);
  });

  it('names an unknown kind with its own code', async () => {
    expect(await cli.run(['retype', cli.copied('edit/order-check.bpmn'), 'check', 'nope'])).toMatchObject({ exit: 1, stderr: expect.stringMatching(/^error E_UNKNOWN_KIND: Unknown kind "nope"/) });
  });

  it('words a refusal as the command was typed, without the index of a batch', async () => {
    const { stderr } = await cli.run(['add', cli.copied('edit/order-check.bpmn'), 'task', 'A', '--flow-name', 'yes', '--in', 'check']);

    expect(stderr).toMatch(/^error E_USAGE: --flow-name describe the flow into the node and need --after, --before or --flow/);
    expect(stderr).not.toMatch(/ops\[|op: #|"flowName"/);
  });

  it('leaves out the index of a refusal the model makes', async () => {
    expect((await cli.run(['remove', cli.copied('edit/order-check.bpmn'), 'nope'])).stderr).not.toContain('op: #');
  });

  it('leaves out a hint that shows JSON', async () => {
    expect((await cli.run(['color', cli.copied('edit/order-check.bpmn'), '--color', 'red'])).stderr).not.toContain('hint');
  });

  it('offers the choices of a field', async () => {
    expect((await cli.run(['label', cli.copied('edit/order-check.bpmn'), 'gateway_ok', '--side', 'nope'])).stderr).toContain('Allowed choices');
  });
});
