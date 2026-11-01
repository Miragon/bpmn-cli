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

  it('names an unknown kind with its own code', async () => {
    expect(await cli.run(['retype', cli.copied('edit/order-check.bpmn'), 'check', 'nope'])).toMatchObject({ exit: 1, stderr: expect.stringMatching(/^error E_UNKNOWN_KIND: Unknown kind "nope"/) });
  });

  it('offers the choices of a field', async () => {
    expect((await cli.run(['label', cli.copied('edit/order-check.bpmn'), 'gateway_ok', '--side', 'nope'])).stderr).toContain('Allowed choices');
  });
});
