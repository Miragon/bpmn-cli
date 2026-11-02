import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('RenderCommand', () => {
  it('writes to the temp directory without -o', async () => {
    const { stdout } = await cli.run(['render', cli.copied('edit/order-check.bpmn')]);

    expect(stdout).toContain('bpmn-cli');
    expect(stdout).toContain('order-check.png');
  });

  it('prints the report as JSON', async () => {
    const svg = join(cli.folder, 'a.svg');

    expect(JSON.parse((await cli.run(['render', cli.copied('edit/order-check.bpmn'), '-o', svg, '--json'])).stdout)).toMatchObject({ out: svg, format: 'svg', tokens: expect.any(Number) });
  });

  it('names an element that does not exist with a code of its own', async () => {
    expect((await cli.run(['render', cli.copied('edit/order-check.bpmn'), 'nope', '-o', join(cli.folder, 'a.svg')])).stderr).toMatch(/^error E_/);
  });
});
