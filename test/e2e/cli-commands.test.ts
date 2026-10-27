/**
 * The command classes (src/adapters/in/cli/) run in-process: a Cli with streams of
 * the test's own, no spawned binary, no build.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { Cli, type CliIo } from '../../src/adapters/in/cli/Cli.js';
import { FILE_USE_CASES } from '../helpers/helpers.js';
import { guideShort } from '../../src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'bpmn-cli-commands-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function bpmn(args: string[], stdin = ''): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (chunk: string | Uint8Array) => ((out += String(chunk)), true) },
    stderr: { write: (chunk: string | Uint8Array) => ((err += String(chunk)), true) },
    stdin: Readable.from([Buffer.from(stdin)]),
    env: {},
  };
  const cli = new Cli('9.9.9', FILE_USE_CASES, io);
  await cli.run(['node', 'bpmn', ...args]);
  return { code: cli.exitCode ?? 0, out, err };
}

describe('Cli in-process', () => {
  it('prints the guide and the version on its own streams', async () => {
    expect(await bpmn(['guide', '--short'])).toEqual({ code: 0, out: guideShort(), err: '' });
    expect(await bpmn(['--version'])).toEqual({ code: 0, out: '9.9.9\n', err: '' });
  });

  it('creates, changes and reads a model, also from stdin', async () => {
    const file = join(dir, 'order.bpmn');
    expect((await bpmn(['new', file, '--name', 'Order', '--no-lint-config'])).code).toBe(0);
    expect((await bpmn(['add', file, 'startEvent', 'Start', '--no-lint-config'])).code).toBe(0);
    const added = await bpmn(['add', file, 'userTask', 'Check invoice', '--after', 'Event_Start', '--summary', '--json', '--no-lint-config']);
    expect(added.code).toBe(0);
    expect(JSON.parse(added.out).created).toEqual({ userTask: ['Activity_CheckInvoice'], sequenceFlow: [expect.any(String)] });
    const shown = await bpmn(['show', '-', '--json'], readFileSync(file, 'utf8'));
    expect(JSON.stringify(JSON.parse(shown.out))).toContain('Activity_CheckInvoice');
    const twice = await bpmn(['apply', '-', '-'], readFileSync(file, 'utf8'));
    expect(twice.code).toBe(1);
    expect(twice.err).toContain('error E_USAGE: the model and the ops cannot both come from stdin');
  });

  it('prints parser errors like every other error, with the positional hint and the exit code', async () => {
    const outcome = await bpmn(['set', 'f.bpmn', 'Activity_A', '--name', 'X']);
    expect(outcome.code).toBe(1);
    expect(outcome.err).toContain('error E_USAGE: unknown option');
    expect(outcome.err).toContain('`bpmn set f.bpmn Activity_A name=X`');
    const json = await bpmn(['kinds', '--section', 'nope', '--json']);
    expect(JSON.parse(json.err)).toMatchObject({ ok: false, error: { code: 'E_USAGE' } });
  });

  it('reads the environment it is given, not the process environment', async () => {
    const io = { env: { BPMN_KEEP_FLOW_IDS: 'maybe' } };
    let err = '';
    const cli = new Cli('9.9.9', FILE_USE_CASES, { stdout: { write: () => true }, stderr: { write: (chunk: string | Uint8Array) => ((err += String(chunk)), true) }, stdin: Readable.from([]), ...io });
    await cli.run(['node', 'bpmn', 'add', join(dir, 'order.bpmn'), 'userTask', 'K']);
    expect(cli.exitCode).toBe(1);
    expect(err).toContain('BPMN_KEEP_FLOW_IDS=maybe is not a switch value');
  });
});
