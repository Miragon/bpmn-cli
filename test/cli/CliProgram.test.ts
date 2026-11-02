import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliProgram } from '../../src/cli/CliProgram.js';
import { Fixtures } from '../support/Fixtures.js';
import { InProcessCli } from '../support/InProcessCli.js';

async function failingOutput(words: string[], env: NodeJS.ProcessEnv = {}): Promise<{ exit: number; stderr: string }> {
  const chunks: string[] = [];
  const process = { stdout: { write: () => { throw new Error('boom'); } }, stderr: { write: (text: string) => chunks.push(text) > 0 }, stdin: Readable.from([Fixtures.text('edit/order-check.bpmn')]), env };
  const exit = await new CliProgram(process, '0').run(words);
  return { exit, stderr: chunks.join('') };
}

describe('CliProgram', () => {
  it('prints an unknown command like every other error', async () => {
    expect(await new InProcessCli().run(['nope'])).toMatchObject({ exit: 1, stderr: expect.stringMatching(/^error E_USAGE: unknown command 'nope'.*\n {2}hint: /) });
  });

  it('prints an error as JSON on stderr with --json', async () => {
    const { stderr } = await new InProcessCli().run(['show', '/does/not/exist.bpmn', '--json']);

    expect(JSON.parse(stderr)).toMatchObject({ ok: false, error: { code: 'E_FILE_NOT_FOUND' } });
  });

  it('prints a failure it does not know as E_INTERNAL with exit 70', async () => {
    expect(await failingOutput(['show', '-'])).toEqual({ exit: 70, stderr: 'error E_INTERNAL: boom\n' });
    expect(JSON.parse((await failingOutput(['show', '-', '--json'])).stderr)).toEqual({ ok: false, error: { code: 'E_INTERNAL', message: 'boom' } });
    expect((await failingOutput(['show', '-'], { BPMN_DEBUG: '1' })).stderr).toContain('at ');
  });

  it('lets a bare bpmn print the help and exit 1', async () => {
    expect((await new InProcessCli().run([])).exit).toBe(1);
  });
});
