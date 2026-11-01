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

describe('NewCommand', () => {
  it('prints JSON and takes a process id', async () => {
    const file = join(cli.folder, 'a.bpmn');

    expect(JSON.parse((await cli.run(['new', file, '--id', 'Process_a', '--json'])).stdout)).toEqual({ ok: true, file, written: true });
    expect((await cli.run(['show', file])).stdout).toContain('Process_a');
  });

  it('refuses a target it does not know', async () => {
    expect((await cli.run(['new', join(cli.folder, 'a.bpmn'), '--target', 'camunda9'])).exit).toBe(1);
  });
});
