import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../support/InProcessCli.js';

const PNG_SIGNATURE = '89504e47';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('bpmn render', () => {
  it('writes a PNG or an SVG by the extension of -o and prints what it did', async () => {
    const file = cli.copied('edit/order-check.bpmn');
    const [png, svg] = [join(cli.folder, 'a.png'), join(cli.folder, 'a.svg')];

    expect((await cli.run(['render', file, '-o', png])).stdout).toMatch(/^wrote .*a\.png {2}\d+x\d+ px {2}~\d+ image tokens {2}scale 1\.00 {2}plane /);
    expect(readFileSync(png).subarray(0, 4).toString('hex')).toBe(PNG_SIGNATURE);
    await cli.run(['render', file, '-o', svg]);
    expect(readFileSync(svg, 'utf8')).toContain('<svg');
  });

  it('crops to an id, a neighbourhood and a path, and lists the problems', async () => {
    const file = cli.copied('edit/order-check.bpmn');
    const svg = join(cli.folder, 'a.svg');

    expect((await cli.run(['render', file, 'check', '-o', svg])).stdout).toContain('crop: 1 id: ');
    expect((await cli.run(['render', file, '--around', 'check', '--depth', '1', '-o', svg])).stdout).toContain('crop: around check (depth 1): ');
    expect((await cli.run(['render', file, '--path', 'check', 'ship', '-o', svg])).stdout).toContain('crop: path check -> ship: ');
    await cli.run(['layout', file]);
    expect((await cli.run(['render', file, '--problems', '-o', svg])).stdout).toContain('problems: none');
  });

  it('refuses a name it cannot tell the format of, a path of one id, and a PNG for a terminal', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    expect(await cli.run(['render', file, '-o', 'a.gif'])).toMatchObject({ exit: 1, stderr: expect.stringContaining('.png or .svg') });
    expect((await cli.run(['render', file, '--path', 'check'])).stderr).toContain('exactly two ids');
    expect((await cli.run(['render', file, '-o', '-'], { isTTY: true })).stderr).toContain('does not go to a terminal');
  });

  it('writes the image to stdout with -o - and the report to stderr', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    const { stdout, stderr } = await cli.run(['render', file, '-o', '-', '--json']);

    expect(stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(stderr)).toMatchObject({ out: '-', format: 'png' });
  });
});
