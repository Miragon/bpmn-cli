import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('GuideCommand', () => {
  it('prints several topics', async () => {
    const { stdout, exit } = await cli.run(['guide', 'colors', 'exit-codes']);

    expect(exit).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });
});
