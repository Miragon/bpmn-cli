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
import { Doc } from '../src/document.js';
import { readPlanes } from '../src/diagram/plane.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';

const ROOT = join(import.meta.dirname, '..');
let dir: string;

function bpmn(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT, input: '' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

const OPS: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'task', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'A' },
];

/** An engine drawing moved by 20 px: hand-made as far as `auto` is concerned. */
async function handFile(name: string): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  const doc = await Doc.fromXml(r.xml);
  for (const d of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of d.get<El>('plane').get<El[]>('planeElement')) {
      const b = pe.get<El | undefined>('bounds');
      if (b) b.set('x', b.get<number>('x') + 20);
      const lb = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (lb) lb.set('x', lb.get<number>('x') + 20);
      for (const w of pe.get<El[] | undefined>('waypoint') ?? []) w.set('x', w.get<number>('x') + 20);
    }
  }
  const file = join(dir, name);
  writeFileSync(file, await doc.toXml());
  return file;
}

async function boxOf(file: string, id: string): Promise<unknown> {
  const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
  for (const p of readPlanes(doc.definitions)) if (p.shapes.has(id)) return p.shapes.get(id)!.bounds;
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
    const r = bpmn('add', file, 'userTask', 'Review', '--after', 'A');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^layout: ok - incremental \(hand-made diagram: kept, changes placed locally\)$/m);
    expect(r.out).toMatch(/^ {2}placed: Activity_Review, Flow_\d+$/m);
    expect(r.out).toMatch(/^layout quality: score 0 -> 0$/m);
    expect(await boxOf(file, 'S')).toEqual(before);
  });

  it('prints the layout block as JSON', async () => {
    const file = await handFile('json.bpmn');
    const r = bpmn('add', file, 'task', 'Second', '--after', 'A', '--json');
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.layout).toMatchObject({ status: 'ok', mode: 'incremental', placed: ['Activity_Second', expect.stringMatching(/^Flow_/)], rerouted: [expect.any(String)], pruned: [] });
    expect(j.layout.metrics).toMatchObject({ before: { score: 0 }, after: { score: 0 }, added: [], resolved: [] });
    expect(j.layout.metrics.after.counts).toHaveProperty('crossings', 0);
  });

  it('redraws with --relayout / --layout full and skips with --no-layout', async () => {
    const file = await handFile('full.bpmn');
    let r = bpmn('set', file, 'A', 'name=Check order', '--relayout');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^layout: ok - full \(full redraw requested\)$/m);
    r = bpmn('set', file, 'A', 'name=Check it', '--layout', 'incremental', '--dry-run');
    expect(r.out).toMatch(/^layout: ok - incremental \(incremental layout requested\)$/m);
    r = bpmn('remove', file, 'E', '--no-layout');
    expect(r.out).toMatch(/^layout: skipped$/m);
    expect(readFileSync(file, 'utf8')).not.toContain('bpmnElement="E"');
  });

  it('refuses contradictory or unknown layout flags as usage errors', () => {
    const file = join(dir, 'auto.bpmn');
    let r = bpmn('set', file, 'A', 'name=x', '--relayout', '--layout', 'incremental');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/E_USAGE: --relayout cannot be combined with --layout incremental/);
    r = bpmn('set', file, 'A', 'name=x', '--layout', 'sideways', '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.code).toBe('E_USAGE');
  });

  it('`bpmn layout` still redraws everything', async () => {
    const file = await handFile('layout.bpmn');
    const r = bpmn('layout', file);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^layout: ok - full/m);
    expect(bpmn('layout', file, '--relayout').code).toBe(1);
  });
});
