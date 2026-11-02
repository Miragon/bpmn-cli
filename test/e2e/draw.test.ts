import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('bpmn with its drawing commands', () => {
  it('tidies and compacts a whole drawing when no ids are named', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    for (const command of ['tidy', 'compact']) {
      const { exit, stderr } = await cli.run([command, file]);

      expect(stderr).toBe('');
      expect(exit).toBe(0);
    }
  });

  it('colours and places what a selector names, without ids', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    const colored = await cli.run(['color', file, '--path', 'check', 'ship', '--color', 'green']);
    const placed = await cli.run(['place', file, '--branch', 'flow_okToReject', '--below', 'ship']);

    expect([colored.stderr, colored.exit]).toEqual(['', 0]);
    expect([placed.stderr, placed.exit]).toEqual(['', 0]);
  });
});
