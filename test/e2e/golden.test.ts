import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliProgram } from '../../src/cli/CliProgram.js';
import { InProcessCli } from '../support/InProcessCli.js';

interface GoldenCall {
  model?: string;
  args: string[];
  ops?: unknown;
  shared?: boolean;
}

const CALLS: GoldenCall[] = JSON.parse(readFileSync('fixtures/cli/calls.json', 'utf8'));
const MAX_TEXT_BYTES = 1024;
const SHARED_ON_THE_VARIANTS = ['-o', '--dry-run', '--force', '--json'];
const READS = ['show', 'find', 'diagram', 'conventions', 'validate', 'render', 'guide'];

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

function silentProgram(): Command {
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  return new CliProgram({ stdout: silent as never, stderr: silent as never, stdin: Readable.from(['']), env: {} }, '0').commander;
}

function leaves(command: Command, path: string[] = []): { name: string; flags: string[] }[] {
  return command.commands.flatMap((child) => {
    const name = [...path, child.name()];
    return child.commands.length ? leaves(child, name) : [{ name: name.join(' '), flags: child.options.map((option) => option.long ?? option.short!) }];
  });
}

function callsOf(name: string): GoldenCall[] {
  return CALLS.filter(({ args }) => args.join(' ').startsWith(`${name} `) || args.join(' ') === name);
}

async function inFolder({ model, args, ops }: GoldenCall): Promise<string[]> {
  const file = model ? cli.copied(model) : join(cli.folder, 'model.bpmn');
  if (ops) {
    writeFileSync(join(cli.folder, 'ops.json'), JSON.stringify(ops));
  }
  return args.map((word) => (word === 'model.bpmn' ? file : word === 'ops.json' || word === 'out.png' || word === 'out.svg' ? join(cli.folder, word) : word));
}

describe('the golden calls of fixtures/cli', () => {
  it('name every flag of every command', () => {
    const missing = leaves(silentProgram()).flatMap(({ name, flags }) => {
      const calls = callsOf(name);
      const shared = calls.some((call) => call.shared) ? SHARED_ON_THE_VARIANTS : ['--json'];
      const named = (flag: string) => shared.includes(flag) || calls.some(({ args }) => args.includes(flag));
      return [...(calls.length ? [] : [name]), ...flags.filter((flag) => !named(flag)).map((flag) => `${name} ${flag}`)];
    });

    expect(missing).toEqual([]);
  });

  it('answer in at most 1 KB of text', async () => {
    const over: string[] = [];
    for (const call of CALLS.filter(({ args }) => !READS.includes(args[0]!))) {
      const { stdout } = await cli.run(await inFolder(call));
      if (Buffer.byteLength(stdout) > MAX_TEXT_BYTES) {
        over.push(call.args.join(' '));
      }
    }

    expect(over).toEqual([]);
  });
});
