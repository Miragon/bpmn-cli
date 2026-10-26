/**
 * The layout flags of mutating commands, end to end through the CLI
 * (src/cli.ts run with tsx, so no build is needed): --layout
 * <auto|incremental|full>, --relayout, --no-layout, and the layout block of
 * the text and JSON results.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/domain/document/Doc.js';
import { DiagramReader } from '../src/domain/diagram/di/DiagramReader.js';
import type { El } from '../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../src/domain/commands/types.js';
import { mutateDoc } from '../src/index.js';

const ROOT = join(import.meta.dirname, '..');
let dir: string;

function bpmn(...args: string[]): { code: number; out: string; err: string } {
  const spawned = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT, input: '' });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

const OPS: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'task', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'A' },
];

/** An engine drawing moved by 20 px: hand-made as far as `auto` is concerned. */
async function handFile(name: string): Promise<string> {
  const outcome = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  const doc = await Doc.fromXml(outcome.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      const bounds = pe.get<El | undefined>('bounds');
      if (bounds) bounds.set('x', bounds.get<number>('x') + 20);
      const lb = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (lb) lb.set('x', lb.get<number>('x') + 20);
      for (const waypoint of pe.get<El[] | undefined>('waypoint') ?? []) waypoint.set('x', waypoint.get<number>('x') + 20);
    }
  }
  const file = join(dir, name);
  writeFileSync(file, await doc.toXml());
  return file;
}

async function boxOf(file: string, id: string): Promise<unknown> {
  const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
  for (const plane of new DiagramReader(doc.definitions).planes()) if (plane.shapes.has(id)) return plane.shapes.get(id)!.bounds;
  return undefined;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-cli-layout-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bpmn layout modes on the command line', () => {
  it('keeps a hand-made drawing by default and reports what it placed', async () => {
    const file = await handFile('auto.bpmn');
    const before = await boxOf(file, 'S');
    const cliRun = bpmn('add', file, 'userTask', 'Review', '--after', 'A');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^layout: ok - incremental \(hand-made diagram: kept, changes placed locally\)$/m);
    expect(cliRun.out).toMatch(/^ {2}placed: Activity_Review, Flow_ReviewToDone$/m);
    expect(cliRun.out).toMatch(/^layout quality: score 0 -> 0$/m);
    expect(await boxOf(file, 'S')).toEqual(before);
  });

  it('prints the layout block as JSON', async () => {
    const file = await handFile('json.bpmn');
    const cliRun = bpmn('add', file, 'task', 'Second', '--after', 'A', '--json');
    expect(cliRun.code, cliRun.err).toBe(0);
    const json = JSON.parse(cliRun.out);
    expect(json.layout).toMatchObject({ status: 'ok', mode: 'incremental', placed: ['Activity_Second', expect.stringMatching(/^Flow_/)], rerouted: [expect.any(String)], pruned: [] });
    expect(json.layout.metrics).toMatchObject({ before: { score: 0 }, after: { score: 0 }, added: [], resolved: [] });
    expect(json.layout.metrics.after.counts).toHaveProperty('crossings', 0);
  });

  it('redraws with --relayout / --layout full and skips with --no-layout', async () => {
    const file = await handFile('full.bpmn');
    let cliRun = bpmn('set', file, 'A', 'name=Check order', '--relayout');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^layout: ok - full \(full redraw requested\)$/m);
    cliRun = bpmn('set', file, 'A', 'name=Check it', '--layout', 'incremental', '--dry-run');
    expect(cliRun.out).toMatch(/^layout: ok - incremental \(incremental layout requested\)$/m);
    cliRun = bpmn('remove', file, 'E', '--no-layout');
    expect(cliRun.out).toMatch(/^layout: skipped$/m);
    expect(readFileSync(file, 'utf8')).not.toContain('bpmnElement="E"');
  });

  it('refuses contradictory or unknown layout flags as usage errors', () => {
    const file = join(dir, 'auto.bpmn');
    let cliRun = bpmn('set', file, 'A', 'name=x', '--relayout', '--layout', 'incremental');
    expect(cliRun.code).toBe(1);
    expect(cliRun.err).toMatch(/E_USAGE: --relayout cannot be combined with --layout incremental/);
    cliRun = bpmn('set', file, 'A', 'name=x', '--layout', 'sideways', '--json');
    expect(cliRun.code).toBe(1);
    expect(JSON.parse(cliRun.err).error.code).toBe('E_USAGE');
  });

  it('`bpmn layout` still redraws everything', async () => {
    const file = await handFile('layout.bpmn');
    const cliRun = bpmn('layout', file);
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^layout: ok - full/m);
    expect(bpmn('layout', file, '--relayout').code).toBe(1);
  });
});
