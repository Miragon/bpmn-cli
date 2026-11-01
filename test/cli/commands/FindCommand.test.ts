import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('FindCommand', () => {
  it('lists every element without a text', async () => {
    const { stdout } = await cli.run(['find', cli.copied('edit/order-check.bpmn')]);

    expect(stdout.split('\n')[0]).toMatch(/^\S+\t/);
  });

  it('prints the hits as JSON', async () => {
    const { total, hits } = JSON.parse((await cli.run(['find', cli.copied('edit/order-check.bpmn'), 'zzz', '--json'])).stdout);

    expect([total, hits]).toEqual([0, []]);
  });
});
