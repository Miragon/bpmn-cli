import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cli } from '../../src/cli/index.js';
import { HelpTopics } from '../../src/cli/help/HelpTopics.js';

const SEEDS = join(import.meta.dirname, '..', '..', 'fixtures', 'guide');
const PATTERN_LINE = /<[a-zA-Z]|\s\[/;
const SHELL_WORD = /(?:[^\s'"]+|'[^']*'|"[^"]*")+/g;

function fencedLines(text: string): string[] {
  return text.split(/^```.*$/m).filter((_part, index) => index % 2 === 1).flatMap((block) => block.split('\n'));
}

function examples(): string[] {
  const guide = HelpTopics.text([]) + HelpTopics.text(HelpTopics.names());
  return [...new Set(fencedLines(guide).filter((line) => line.startsWith('bpmn ') && !PATTERN_LINE.test(line.replace(/'[^']*'/g, ''))))];
}

function wordsOf(example: string): string[] {
  return example.match(SHELL_WORD)!.slice(1).map((word) => word.replace(/'([^']*)'|"([^"]*)"/g, '$1$2'));
}

async function run(example: string): Promise<{ code: number; errors: string }> {
  let errors = '';
  const output = { write: (text: string) => { errors += text; return true; } };
  const silent = { write: () => true };
  const code = await new Cli({ stdout: silent, stderr: output, stdin: process.stdin, env: {} }).run(wordsOf(example));
  return { code, errors };
}

describe('the examples of the guide', () => {
  const start = process.cwd();
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'bpmn-guide-'));
    for (const seed of readdirSync(SEEDS)) {
      cpSync(join(SEEDS, seed), join(folder, seed));
    }
    process.chdir(folder);
  });

  afterEach(() => {
    process.chdir(start);
    rmSync(folder, { recursive: true, force: true });
  });

  it('holds examples in the guide', () => {
    expect(examples().length).toBeGreaterThan(40);
  });

  it('holds in ops.json what the workflow topic prints', () => {
    const printed = HelpTopics.text(['workflow']).match(/`ops\.json`: `(.*)`\./)![1]!;

    expect(JSON.parse(printed.split('`')[0]!)).toEqual(JSON.parse(readFileSync('ops.json', 'utf8')));
  });

  it.each(examples())('%s', async (example) => {
    expect(await run(example)).toEqual({ code: 0, errors: '' });
  });
});
