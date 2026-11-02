import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('ShowCommand', () => {
  it('cuts the outline to a container', async () => {
    const { stdout } = await cli.run(['show', cli.copied('edit/containers-lanes.bpmn'), '--in', 'lane_inbound']);

    expect(stdout).toContain('pack');
    expect(stdout).not.toContain('task sub_task');
  });

  it('refuses an element it does not know', async () => {
    expect((await cli.run(['show', cli.copied('edit/order-check.bpmn'), 'nope'])).exit).toBe(2);
  });
});
