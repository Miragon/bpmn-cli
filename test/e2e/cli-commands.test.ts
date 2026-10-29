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

  it('keeps lane membership in step with the drawn lanes when lanes are added and removed', async () => {
    const file = join(dir, 'lanes.bpmn');
    await bpmn(['new', file, '--name', 'Shop', '--no-lint-config']);
    await bpmn(['add', file, 'start', 'S']);
    await bpmn(['add', file, 'userTask', 'A', '--after', 'startEvent_s']);
    await bpmn(['add', file, 'participant', 'Shop']);
    await bpmn(['add', file, 'lane', 'Sales', '--in', 'participant_shop']);
    expect((await bpmn(['validate', file])).out).not.toContain('W_NOT_IN_LANE');
    await bpmn(['add', file, 'lane', 'Billing', '--in', 'participant_shop']);
    await bpmn(['set', file, 'startEvent_s', 'lane=lane_sales']);
    await bpmn(['set', file, 'userTask_a', 'lane=lane_billing']);
    await bpmn(['remove', file, 'lane_billing']);
    expect((await bpmn(['validate', file])).out).not.toContain('W_NOT_IN_LANE');
    expect(readFileSync(file, 'utf8')).toMatch(/<bpmn:lane id="lane_sales" name="Sales">\s*<bpmn:flowNodeRef>startEvent_s<\/bpmn:flowNodeRef>\s*<bpmn:flowNodeRef>userTask_a<\/bpmn:flowNodeRef>/);
  });

  it('creates, changes and reads a model, also from stdin', async () => {
    const file = join(dir, 'order.bpmn');
    expect((await bpmn(['new', file, '--name', 'Order', '--no-lint-config'])).code).toBe(0);
    expect((await bpmn(['add', file, 'startEvent', 'Start', '--no-lint-config'])).code).toBe(0);
    const added = await bpmn(['add', file, 'userTask', 'Check invoice', '--after', 'startEvent_start', '--summary', '--json', '--no-lint-config']);
    expect(added.code).toBe(0);
    expect(JSON.parse(added.out).created).toEqual({ userTask: ['userTask_checkInvoice'], sequenceFlow: [expect.any(String)] });
    const shown = await bpmn(['show', '-', '--json'], readFileSync(file, 'utf8'));
    expect(JSON.stringify(JSON.parse(shown.out))).toContain('userTask_checkInvoice');
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

});
