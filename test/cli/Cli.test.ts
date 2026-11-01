import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Cli } from '../../src/cli/Cli.js';
import { InProcessCli } from '../support/InProcessCli.js';

const sink = () => new Writable({ write: (_chunk, _encoding, done) => done() });

function processOf(exit: (code: number) => void) {
  return { stdout: sink(), stderr: sink(), stdin: Readable.from(['']), env: {}, exit: exit as (code: number) => never } as never;
}

describe('Cli', () => {
  it('prints the version of the package', async () => {
    expect(await new InProcessCli().run(['--version'])).toMatchObject({ exit: 0, stdout: expect.stringMatching(/^\d+\.\d+\.\d+/) });
  });

  it('ends the process once what it wrote is out, whatever a plugin left running', async () => {
    const code = await new Promise((done) => {
      void new Cli(processOf(done)).run(['--version']);
    });

    expect(code).toBe(0);
  });

  it('ends quietly when the reader of its output has gone, and fails on any other stream error', async () => {
    const stdout = sink();
    await new Cli({ stdout, stderr: sink(), stdin: Readable.from(['']), env: {} } as never).run(['--version']);

    expect(() => stdout.emit('error', Object.assign(new Error('gone'), { code: 'EPIPE' }))).not.toThrow();
    expect(() => stdout.emit('error', new Error('broken'))).toThrow('broken');
  });

  it('prints the help of the program and exits 0', async () => {
    const { stdout, exit } = await new InProcessCli().run(['--help']);

    expect(exit).toBe(0);
    expect(stdout).toContain('Usage: bpmn');
  });
});
