import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SOURCE_ENTRY = 'src/cli/index.ts';

let folder: string;
let script: string;

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'bpmn-cli-spawn-'));
  script = join(folder, 'bpmn.mts');
  writeFileSync(script, `import { Cli } from ${JSON.stringify(join(process.cwd(), SOURCE_ENTRY))};\nprocess.exitCode = await new Cli(process).run(process.argv.slice(2));\n`);
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

function bpmn(...words: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...words], { encoding: 'utf8' });
}

describe('the bpmn process', () => {
  it('creates a model, changes it and exits with the code of the result', () => {
    const file = join(folder, 'smoke.bpmn');

    expect(bpmn('new', file, 'Smoke').status).toBe(0);
    expect(bpmn('add', file, 'startEvent', 'Go').stdout).toContain('created startEvent: startEvent_go');
    expect(bpmn('show', join(folder, 'missing.bpmn')).status).toBe(4);
  });
});
